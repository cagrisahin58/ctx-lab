import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildHealthPayload,
  buildMemoryMirrorPaths,
  buildRunnerPaths,
  codexCandidates,
  createRunnerServer,
  detectCodex,
  ensureRunnerHome,
  getMemoryMirrorStatus,
  indexMemoryMirror,
  listCodexRunEvents,
  listCodexRuns,
  normalizeProjectDraft,
  normalizeMemoryMirrorConfig,
  readProjectRegistry,
  registerProject,
  resolveAppDataDir,
  syncMemoryMirror,
  applyCodexRunCommit,
  startCodexRun
} from "../scripts/ctxlab-runner.mjs";

test("runner app-data yollarını platforma göre üretir", () => {
  assert.equal(
    resolveAppDataDir({ CTX_LAB_HOME: "C:\\ctxlab-test" }, "win32"),
    "C:\\ctxlab-test"
  );
  assert.match(resolveAppDataDir({ APPDATA: "C:\\Users\\x\\AppData\\Roaming" }, "win32"), /ctx-lab$/);
  assert.match(resolveAppDataDir({ HOME: "/tmp/home" }, "linux"), /\/tmp\/home\/\.ctx-lab$/);
});

test("runner home dizinlerini ve boş proje kayıt dosyasını hazırlar", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ctxlab-runner-"));
  const paths = buildRunnerPaths(dir);

  try {
    await ensureRunnerHome(paths);
    const registry = await readProjectRegistry(paths);

    assert.equal(registry.version, 1);
    assert.deepEqual(registry.projects, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("codex adayları Windows için codex.cmd önceliklidir", () => {
  assert.deepEqual(codexCandidates({}, "win32").slice(0, 2), ["codex.cmd", "codex.exe"]);
  assert.deepEqual(codexCandidates({ CTX_LAB_CODEX_PATH: "C:\\bin\\codex.cmd" }, "win32").slice(0, 2), [
    "C:\\bin\\codex.cmd",
    "codex.cmd"
  ]);
});

test("detectCodex çalışan ilk adayı döndürür", async () => {
  const result = await detectCodex({
    candidates: ["missing", "codex.cmd"],
    runCommand: async (command) => ({
      ok: command === "codex.cmd",
      stdout: command === "codex.cmd" ? "codex-cli 0.test\n" : "",
      stderr: ""
    })
  });

  assert.equal(result.available, true);
  assert.equal(result.command, "codex.cmd");
  assert.equal(result.version, "codex-cli 0.test");
});

test("detectCodex aday komutlarini kisa timeout ile cagirir", async () => {
  const seen = [];
  const result = await detectCodex({
    candidates: ["codex.cmd"],
    timeoutMs: 123,
    runCommand: async (_command, _args, options) => {
      seen.push(options.timeoutMs);
      return { ok: false, stdout: "", stderr: "timeout" };
    }
  });

  assert.equal(result.available, false);
  assert.deepEqual(seen, [123]);
});

test("runner health payload app-data, proje sayısı ve codex durumunu döndürür", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ctxlab-runner-"));
  const paths = buildRunnerPaths(dir);

  try {
    const health = await buildHealthPayload(paths, {
      candidates: ["codex.cmd"],
      runCommand: async () => ({ ok: true, stdout: "codex-cli test\n", stderr: "" })
    });

    assert.equal(health.ok, true);
    assert.equal(health.service, "ctx-lab-runner");
    assert.equal(health.projectCount, 0);
    assert.equal(health.codex.available, true);
    assert.equal(health.codex.command, "codex.cmd");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runner proje taslagini deterministik id ile normalize eder", () => {
  const draft = normalizeProjectDraft({
    name: "ctx-lab",
    path: process.cwd(),
    repo: "cagrisahin58/ctx-lab"
  });

  assert.equal(draft.name, "ctx-lab");
  assert.equal(draft.repo, "cagrisahin58/ctx-lab");
  assert.match(draft.id, /^project_[a-f0-9]{12}$/);
});

test("runner proje taslagi guvensiz branch adini reddeder", () => {
  assert.throws(
    () => normalizeProjectDraft({
      name: "ctx-lab",
      path: process.cwd(),
      repo: "cagrisahin58/ctx-lab",
      branch: "feature sync"
    }),
    /Proje dal adi gecersiz/
  );
});

test("runner proje kaydini allowlist registry dosyasina ekler ve gunceller", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ctxlab-runner-"));
  const projectDir = await mkdtemp(join(tmpdir(), "ctxlab-project-"));
  const paths = buildRunnerPaths(dir);

  try {
    const first = await registerProject(paths, {
      name: "ctx-lab",
      path: projectDir,
      repo: "cagrisahin58/ctx-lab"
    }, { now: new Date("2026-05-14T12:00:00.000Z") });
    const second = await registerProject(paths, {
      name: "ctx-lab yeni",
      path: projectDir,
      repo: "cagrisahin58/ctx-lab",
      branch: "main"
    }, { now: new Date("2026-05-14T12:05:00.000Z") });
    const registry = await readProjectRegistry(paths);

    assert.equal(first.id, second.id);
    assert.equal(registry.projects.length, 1);
    assert.equal(registry.projects[0].name, "ctx-lab yeni");
    assert.equal(registry.projects[0].createdAt, "2026-05-14T12:00:00.000Z");
    assert.equal(registry.projects[0].updatedAt, "2026-05-14T12:05:00.000Z");
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("runner credential ve sistem konfigurasyon klasorlerini proje koku olarak reddeder", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ctxlab-runner-"));
  const homeLikeDir = await mkdtemp(join(tmpdir(), "ctxlab-home-"));
  const credentialDir = join(homeLikeDir, ".ssh");

  try {
    await mkdir(credentialDir, { recursive: true });
    await assert.rejects(
      () => registerProject(buildRunnerPaths(dir), {
        name: "credential-root",
        path: credentialDir
      }),
      /Kimlik bilgisi/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(homeLikeDir, { recursive: true, force: true });
  }
});

test("memory mirror config ve path bilgisi owner repo branch ile normalize edilir", () => {
  const config = normalizeMemoryMirrorConfig({
    repoInput: "https://github.com/cagrisahin58/work-memory.git",
    branch: "main"
  });
  const paths = buildMemoryMirrorPaths(buildRunnerPaths("C:\\ctxlab"), config);

  assert.deepEqual(config, {
    owner: "cagrisahin58",
    repo: "work-memory",
    branch: "main",
    remoteUrl: "https://github.com/cagrisahin58/work-memory.git"
  });
  assert.match(paths.cloneDir, /cagrisahin58__work-memory__main$/);
  assert.match(paths.indexFile, /cagrisahin58__work-memory__main\.json$/);
});

test("memory mirror slash iceren branch icin ayri scope uretir", () => {
  const slashBranch = buildMemoryMirrorPaths(buildRunnerPaths("C:\\ctxlab"), {
    owner: "cagrisahin58",
    repo: "work-memory",
    branch: "feature/sync"
  });
  const hyphenBranch = buildMemoryMirrorPaths(buildRunnerPaths("C:\\ctxlab"), {
    owner: "cagrisahin58",
    repo: "work-memory",
    branch: "feature-sync"
  });

  assert.match(slashBranch.scope, /^cagrisahin58__work-memory__feature-sync--[a-f0-9]{8}$/);
  assert.match(hyphenBranch.scope, /^cagrisahin58__work-memory__feature-sync$/);
  assert.notEqual(slashBranch.cloneDir, hyphenBranch.cloneDir);
  assert.notEqual(slashBranch.indexFile, hyphenBranch.indexFile);
});

test("memory mirror guvensiz branch adlarini reddeder", () => {
  for (const branch of ["-main", "feature..sync", "feature sync", "feature@{1", "release.lock", "feature\\sync", "main;rm", "main\"quote"]) {
    assert.throws(
      () => normalizeMemoryMirrorConfig({
        owner: "cagrisahin58",
        repo: "work-memory",
        branch
      }),
      /dal adi gecersiz/
    );
  }
});

test("memory mirror yerel markdown kayitlarini indeksler", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ctxlab-runner-"));
  const paths = buildRunnerPaths(dir);
  const mirror = buildMemoryMirrorPaths(paths, { owner: "cagrisahin58", repo: "work-memory", branch: "main" });

  try {
    await mkdir(join(mirror.cloneDir, ".git"), { recursive: true });
    await mkdir(join(mirror.cloneDir, "work-memory", "inbox"), { recursive: true });
    await writeFile(join(mirror.cloneDir, "work-memory", "inbox", "test.md"), `---
id: sess_test
project: ctx-lab
repo: cagrisahin58/ctx-lab
status: needs_triage
created_at: 2026-05-14T12:00:00.000Z
---

# Session Summary

## Amaç
Mirror index denemesi.
`, "utf8");
    const index = await indexMemoryMirror(paths, {
      owner: "cagrisahin58",
      repo: "work-memory",
      branch: "main"
    }, {
      now: new Date("2026-05-14T12:10:00.000Z"),
      runCommand: async () => ({ ok: true, stdout: "abc123\n", stderr: "", code: 0 })
    });
    const status = await getMemoryMirrorStatus(paths, { owner: "cagrisahin58", repo: "work-memory", branch: "main" }, {
      runCommand: async (command, args) => {
        if (args.includes("remote")) return { ok: true, stdout: "https://github.com/cagrisahin58/work-memory.git\n", stderr: "", code: 0 };
        return { ok: true, stdout: "", stderr: "", code: 0 };
      }
    });

    assert.equal(index.recordCount, 1);
    assert.equal(index.records[0].id, "sess_test");
    assert.equal(index.records[0].path, "inbox/test.md");
    assert.equal(index.lastCommit, "abc123");
    assert.equal(status.indexed, true);
    assert.equal(status.recordCount, 1);
    assert.equal(status.remoteCheck.status, "ok");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("memory mirror status mevcut clone remote uyumsuzlugunu gosterir", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ctxlab-runner-"));
  const paths = buildRunnerPaths(dir);
  const mirror = buildMemoryMirrorPaths(paths, { owner: "cagrisahin58", repo: "work-memory", branch: "main" });

  try {
    await mkdir(join(mirror.cloneDir, ".git"), { recursive: true });
    await mkdir(join(mirror.cloneDir, "inbox"), { recursive: true });
    await writeFile(join(mirror.cloneDir, "inbox", "stale.md"), `---
id: sess_stale
project: ctx-lab
status: needs_triage
---

# Session Summary
`, "utf8");
    await indexMemoryMirror(paths, {
      owner: "cagrisahin58",
      repo: "work-memory",
      branch: "main"
    }, {
      now: new Date("2026-05-14T12:12:00.000Z"),
      runCommand: async () => ({ ok: true, stdout: "stale-head\n", stderr: "", code: 0 })
    });

    const status = await getMemoryMirrorStatus(paths, {
      owner: "cagrisahin58",
      repo: "work-memory",
      branch: "main"
    }, {
      runCommand: async (command, args) => {
        if (args.includes("remote")) return { ok: true, stdout: "https://github.com/baska/work-memory.git\n", stderr: "", code: 0 };
        return { ok: true, stdout: "", stderr: "", code: 0 };
      }
    });

    assert.equal(status.cloneExists, true);
    assert.equal(status.indexed, false);
    assert.equal(status.recordCount, 1);
    assert.equal(status.remoteCheck.status, "mismatch");
    assert.match(status.error, /baska GitHub reposuna bagli/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("memory mirror clone yoksa git clone sonrasi index uretir", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ctxlab-runner-"));
  const paths = buildRunnerPaths(dir);
  const mirror = buildMemoryMirrorPaths(paths, { owner: "cagrisahin58", repo: "work-memory", branch: "main" });
  const calls = [];

  try {
    const index = await syncMemoryMirror(paths, {
      owner: "cagrisahin58",
      repo: "work-memory",
      branch: "main"
    }, {
      now: new Date("2026-05-14T12:15:00.000Z"),
      runCommand: async (command, args) => {
        calls.push({ command, args });
        if (args.includes("clone")) {
          await mkdir(join(mirror.cloneDir, ".git"), { recursive: true });
          await mkdir(join(mirror.cloneDir, "inbox"), { recursive: true });
          await writeFile(join(mirror.cloneDir, "inbox", "test.md"), `---
id: sess_clone
project: ctx-lab
status: needs_triage
---

# Session Summary
`, "utf8");
        }
        if (args.includes("rev-parse")) return { ok: true, stdout: "def456\n", stderr: "", code: 0 };
        return { ok: true, stdout: "", stderr: "", code: 0 };
      }
    });

    assert.ok(calls.some((call) => call.args.includes("clone")));
    assert.equal(index.recordCount, 1);
    assert.equal(index.records[0].id, "sess_clone");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("memory mirror mevcut clone icin ayni GitHub reposunu dogrular", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ctxlab-runner-"));
  const paths = buildRunnerPaths(dir);
  const mirror = buildMemoryMirrorPaths(paths, { owner: "cagrisahin58", repo: "work-memory", branch: "main" });
  const calls = [];

  try {
    await mkdir(join(mirror.cloneDir, ".git"), { recursive: true });
    await mkdir(join(mirror.cloneDir, "inbox"), { recursive: true });
    await writeFile(join(mirror.cloneDir, "inbox", "ssh.md"), `---
id: sess_ssh_remote
project: ctx-lab
status: needs_triage
---

# Session Summary
`, "utf8");

    const index = await syncMemoryMirror(paths, {
      owner: "cagrisahin58",
      repo: "work-memory",
      branch: "main"
    }, {
      now: new Date("2026-05-14T12:20:00.000Z"),
      runCommand: async (command, args) => {
        calls.push({ command, args });
        if (args.includes("remote")) return { ok: true, stdout: "git@github.com:cagrisahin58/work-memory.git\n", stderr: "", code: 0 };
        if (args.includes("rev-parse")) return { ok: true, stdout: "abc999\n", stderr: "", code: 0 };
        return { ok: true, stdout: "", stderr: "", code: 0 };
      }
    });

    assert.ok(calls.some((call) => call.args.includes("remote")));
    assert.ok(calls.some((call) => call.args.includes("fetch")));
    assert.equal(index.recordCount, 1);
    assert.equal(index.records[0].id, "sess_ssh_remote");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("memory mirror mevcut clone baska GitHub reposuna bagliysa sync yapmaz", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ctxlab-runner-"));
  const paths = buildRunnerPaths(dir);
  const mirror = buildMemoryMirrorPaths(paths, { owner: "cagrisahin58", repo: "work-memory", branch: "main" });
  const calls = [];

  try {
    await mkdir(join(mirror.cloneDir, ".git"), { recursive: true });

    await assert.rejects(
      () => syncMemoryMirror(paths, {
        owner: "cagrisahin58",
        repo: "work-memory",
        branch: "main"
      }, {
        runCommand: async (command, args) => {
          calls.push({ command, args });
          if (args.includes("remote")) return { ok: true, stdout: "https://github.com/baska/work-memory.git\n", stderr: "", code: 0 };
          return { ok: true, stdout: "", stderr: "", code: 0 };
        }
      }),
      /baska GitHub reposuna bagli/
    );

    assert.ok(calls.some((call) => call.args.includes("remote")));
    assert.equal(calls.some((call) => call.args.includes("fetch") || call.args.includes("pull")), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("codex deneme kaydi yalnizca kayitli proje kokunde calistirma gunlugu olusturur", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ctxlab-runner-"));
  const projectDir = await mkdtemp(join(tmpdir(), "ctxlab-project-"));
  const paths = buildRunnerPaths(dir);

  try {
    const project = await registerProject(paths, {
      name: "ctx-lab",
      path: projectDir,
      repo: "cagrisahin58/ctx-lab"
    }, { now: new Date("2026-05-14T12:00:00.000Z") });
    const run = await startCodexRun(paths, {
      projectId: project.id,
      automationLevel: "brief",
      template: "continue_work",
      prompt: "Devam brifi uret.",
      dryRun: true,
      sourceRecordId: "work_ctx-lab",
      sourceWorkItemId: "work_ctx-lab"
    }, { now: new Date("2026-05-14T12:10:00.000Z") });
    const log = JSON.parse(await readFile(run.logPath, "utf8"));
    const runs = await listCodexRuns(paths);

    assert.equal(run.status, "dry_run");
    assert.equal(log.project.id, project.id);
    assert.equal(log.sourceRecordId, "work_ctx-lab");
    assert.equal(log.sourceWorkItemId, "work_ctx-lab");
    assert.equal(runs[0].id, run.id);
    assert.match(log.prompt, /Yasak islemler/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("codex run kayitsiz proje kokunu reddeder", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ctxlab-runner-"));
  const paths = buildRunnerPaths(dir);

  try {
    await assert.rejects(
      () => startCodexRun(paths, {
        projectPath: process.cwd(),
        automationLevel: "brief",
        prompt: "Brif uret."
      }),
      /kayitli proje/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("codex run destructive git promptunu reddeder", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ctxlab-runner-"));
  const projectDir = await mkdtemp(join(tmpdir(), "ctxlab-project-"));
  const paths = buildRunnerPaths(dir);

  try {
    const project = await registerProject(paths, {
      name: "ctx-lab",
      path: projectDir
    });
    const destructivePrompts = [
      "git reset --hard calistir",
      "git clean -fdx ile temizle",
      "git checkout -- src/main.js",
      "git restore .",
      "git branch -D eski-dal",
      "git push --force origin main",
      "git push -f origin main",
      "git push --delete origin eski-dal",
      "git push origin :main",
      "git push origin +main"
    ];
    for (const prompt of destructivePrompts) {
      await assert.rejects(
        () => startCodexRun(paths, {
          projectId: project.id,
          prompt,
          dryRun: true
        }),
        /Destructive git/
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("codex run git commit veya push isteyen promptu reddeder", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ctxlab-runner-"));
  const projectDir = await mkdtemp(join(tmpdir(), "ctxlab-project-"));
  const paths = buildRunnerPaths(dir);

  try {
    const project = await registerProject(paths, {
      name: "ctx-lab",
      path: projectDir
    });
    for (const prompt of ["git commit -am test", "git push origin main"]) {
      await assert.rejects(
        () => startCodexRun(paths, {
          projectId: project.id,
          prompt,
          dryRun: true
        }),
        /Git commit veya push/
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("codex run credential ve sistem konfigurasyon path isteyen promptu reddeder", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ctxlab-runner-"));
  const projectDir = await mkdtemp(join(tmpdir(), "ctxlab-project-"));
  const paths = buildRunnerPaths(dir);

  try {
    const project = await registerProject(paths, {
      name: "ctx-lab",
      path: projectDir
    });
    const sensitivePrompts = [
      "C:\\Users\\cagri\\.ssh\\id_rsa dosyasini oku",
      "~/.aws/credentials iceriğini ozetle",
      ".git/config dosyasini incele",
      "id_ed25519 private key dosyasini bul"
    ];
    for (const prompt of sensitivePrompts) {
      await assert.rejects(
        () => startCodexRun(paths, {
          projectId: project.id,
          prompt,
          dryRun: true
        }),
        /Kimlik bilgisi/
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("codex run gercek calisma icin codex exec json komutunu kullanir", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ctxlab-runner-"));
  const projectDir = await mkdtemp(join(tmpdir(), "ctxlab-project-"));
  const paths = buildRunnerPaths(dir);
  const calls = [];

  try {
    const project = await registerProject(paths, {
      name: "ctx-lab",
      path: projectDir
    });
    const run = await startCodexRun(paths, {
      projectId: project.id,
      automationLevel: "suggest",
      prompt: "Sadece oner.",
      dryRun: false
    }, {
      now: new Date("2026-05-14T12:20:00.000Z"),
      finishedAt: new Date("2026-05-14T12:21:00.000Z"),
      candidates: ["codex.cmd"],
      runCommand: async (command, args, options = {}) => {
        calls.push({ command, args, options });
        if (args.includes("--version")) return { ok: true, stdout: "codex-cli test\n", stderr: "", code: 0 };
        await options.onStdout?.("{\"event\":\"progress\"}\n");
        await options.onStderr?.("uyarı satırı\n");
        return { ok: true, stdout: "{\"event\":\"done\"}\n", stderr: "", code: 0 };
      }
    });
    const events = (await readFile(run.eventLogPath, "utf8"))
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));

    assert.equal(run.status, "succeeded");
    assert.equal(run.sandbox, "read-only");
    assert.equal(run.testResult, "not_detected");
    assert.ok(calls.some((call) => call.args.includes("exec") && call.args.includes("--json")));
    assert.match(calls.at(-1).options.input, /Sadece oner/);
    assert.ok(run.eventPreview.some((event) => event.event === "stdout" && event.text.includes("progress")));
    assert.equal(events[0].event, "start");
    assert.ok(events.some((event) => event.event === "stdout" && event.text.includes("progress")));
    assert.ok(events.some((event) => event.event === "stderr" && event.text.includes("uyarı")));
    assert.equal(events.at(-1).event, "finish");
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("codex run olay gunlugu son olaylari guvenli sekilde listeler", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ctxlab-runner-"));
  const paths = buildRunnerPaths(dir);

  try {
    await ensureRunnerHome(paths);
    const runId = "run_2026-05-14T12-40-00-000Z_ctx-lab";
    await writeFile(join(paths.runsDir, `${runId}.json`), `${JSON.stringify({
      id: runId,
      status: "succeeded",
      eventLogPath: join(paths.runsDir, `${runId}.events.jsonl`)
    })}\n`, "utf8");
    await writeFile(join(paths.runsDir, `${runId}.events.jsonl`), [
      JSON.stringify({ event: "start", at: "2026-05-14T12:40:00.000Z", runId, command: "codex.cmd", sandbox: "read-only" }),
      JSON.stringify({ event: "stdout", at: "2026-05-14T12:40:10.000Z", runId, text: "ilk satır" }),
      JSON.stringify({ event: "stderr", at: "2026-05-14T12:40:11.000Z", runId, text: "uyarı" }),
      JSON.stringify({ event: "finish", at: "2026-05-14T12:41:00.000Z", runId, status: "succeeded", exitCode: 0, testResult: "passed" })
    ].join("\n"), "utf8");

    const events = await listCodexRunEvents(paths, { runId, limit: 2 });
    const runs = await listCodexRuns(paths, 1);

    assert.equal(events.status, "ok");
    assert.deepEqual(events.events.map((event) => event.event), ["stderr", "finish"]);
    assert.equal(runs[0].eventPreviewStatus, "ok");
    assert.ok(runs[0].eventPreview.some((event) => event.event === "finish" && event.testResult === "passed"));
    await assert.rejects(
      () => listCodexRunEvents(paths, { runId: "../run_1" }),
      /Geçersiz çalıştırma kimliği/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("codex run test sonucunu ve commit kapisini loglar", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ctxlab-runner-"));
  const projectDir = await mkdtemp(join(tmpdir(), "ctxlab-project-"));
  const paths = buildRunnerPaths(dir);
  let statusCalls = 0;

  try {
    const project = await registerProject(paths, {
      name: "ctx-lab",
      path: projectDir
    });
    const run = await startCodexRun(paths, {
      projectId: project.id,
      automationLevel: "commit_push",
      prompt: "Testleri calistir ve commit oncesi ozet hazirla.",
      dryRun: false,
      confirmCommitPush: true
    }, {
      now: new Date("2026-05-14T12:30:00.000Z"),
      finishedAt: new Date("2026-05-14T12:31:00.000Z"),
      candidates: ["codex.cmd"],
      runCommand: async (_command, args) => {
        if (args.includes("--version")) return { ok: true, stdout: "codex-cli test\n", stderr: "", code: 0 };
        return { ok: true, stdout: "npm test\n69 tests passed\n", stderr: "", code: 0 };
      },
      gitCommand: async (_command, args) => {
        if (args.includes("--is-inside-work-tree")) return { ok: true, stdout: "true\n", stderr: "", code: 0 };
        if (args.includes("--abbrev-ref")) return { ok: true, stdout: "main\n", stderr: "", code: 0 };
        if (args.includes("HEAD")) return { ok: true, stdout: "abcdef1234567890\n", stderr: "", code: 0 };
        if (args.includes("status")) {
          statusCalls += 1;
          return { ok: true, stdout: statusCalls === 1 ? "" : " M src/main.js\n", stderr: "", code: 0 };
        }
        return { ok: false, stdout: "", stderr: "beklenmeyen git komutu", code: 1 };
      }
    });
    const log = JSON.parse(await readFile(run.logPath, "utf8"));

    assert.equal(run.testResult, "passed");
    assert.match(run.summary, /test çıktısı başarılı/);
    assert.match(run.commitGate, /Commit\/push/);
    assert.equal(run.commitReadiness.ready, true);
    assert.equal(run.commitReadiness.status, "ready_for_review");
    assert.equal(run.commitDraft.ready, true);
    assert.equal(run.commitDraft.pushAllowed, true);
    assert.equal(run.commitDraft.message, "Testleri calistir ve commit oncesi ozet hazirla");
    assert.equal(log.testResult, "passed");
    assert.equal(log.commitReadiness.ready, true);
    assert.equal(log.commitDraft.ready, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("codex run TAP not ok ciktisini basarisiz test sinyali sayar", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ctxlab-runner-"));
  const projectDir = await mkdtemp(join(tmpdir(), "ctxlab-project-"));
  const paths = buildRunnerPaths(dir);
  let statusCalls = 0;

  try {
    const project = await registerProject(paths, {
      name: "ctx-lab",
      path: projectDir
    });
    const run = await startCodexRun(paths, {
      projectId: project.id,
      automationLevel: "commit_prepare",
      prompt: "Testleri calistir ve commit taslagini hazirla.",
      dryRun: false
    }, {
      now: new Date("2026-05-14T12:30:30.000Z"),
      finishedAt: new Date("2026-05-14T12:31:30.000Z"),
      candidates: ["codex.cmd"],
      runCommand: async (_command, args) => {
        if (args.includes("--version")) return { ok: true, stdout: "codex-cli test\n", stderr: "", code: 0 };
        return { ok: true, stdout: "TAP version 13\nnot ok 1 - runner smoke\n", stderr: "", code: 0 };
      },
      gitCommand: async (_command, args) => {
        if (args.includes("--is-inside-work-tree")) return { ok: true, stdout: "true\n", stderr: "", code: 0 };
        if (args.includes("--abbrev-ref")) return { ok: true, stdout: "main\n", stderr: "", code: 0 };
        if (args.includes("HEAD")) return { ok: true, stdout: "abcdef1234567890\n", stderr: "", code: 0 };
        if (args.includes("status")) {
          statusCalls += 1;
          return { ok: true, stdout: statusCalls === 1 ? "" : " M src/main.js\n", stderr: "", code: 0 };
        }
        return { ok: false, stdout: "", stderr: "beklenmeyen git komutu", code: 1 };
      }
    });
    const testCheck = run.commitReadiness.checks.find((check) => check.id === "test");

    assert.equal(run.status, "succeeded");
    assert.equal(run.testResult, "failed");
    assert.equal(testCheck.ok, false);
    assert.match(run.summary, /hata sinyali/);
    assert.equal(run.commitReadiness.ready, false);
    assert.equal(run.commitDraft.ready, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("codex run sifir failed sayacini basarili test sinyaliyle karistirmaz", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ctxlab-runner-"));
  const projectDir = await mkdtemp(join(tmpdir(), "ctxlab-project-"));
  const paths = buildRunnerPaths(dir);
  let statusCalls = 0;

  try {
    const project = await registerProject(paths, {
      name: "ctx-lab",
      path: projectDir
    });
    const run = await startCodexRun(paths, {
      projectId: project.id,
      automationLevel: "commit_prepare",
      prompt: "Testleri calistir ve commit taslagini hazirla.",
      dryRun: false
    }, {
      now: new Date("2026-05-14T12:30:45.000Z"),
      finishedAt: new Date("2026-05-14T12:31:45.000Z"),
      candidates: ["codex.cmd"],
      runCommand: async (_command, args) => {
        if (args.includes("--version")) return { ok: true, stdout: "codex-cli test\n", stderr: "", code: 0 };
        return { ok: true, stdout: "Tests: 12 passed, 0 failed\n", stderr: "", code: 0 };
      },
      gitCommand: async (_command, args) => {
        if (args.includes("--is-inside-work-tree")) return { ok: true, stdout: "true\n", stderr: "", code: 0 };
        if (args.includes("--abbrev-ref")) return { ok: true, stdout: "main\n", stderr: "", code: 0 };
        if (args.includes("HEAD")) return { ok: true, stdout: "abcdef1234567890\n", stderr: "", code: 0 };
        if (args.includes("status")) {
          statusCalls += 1;
          return { ok: true, stdout: statusCalls === 1 ? "" : " M src/main.js\n", stderr: "", code: 0 };
        }
        return { ok: false, stdout: "", stderr: "beklenmeyen git komutu", code: 1 };
      }
    });
    const testCheck = run.commitReadiness.checks.find((check) => check.id === "test");

    assert.equal(run.testResult, "passed");
    assert.equal(testCheck.ok, true);
    assert.equal(run.commitReadiness.ready, true);
    assert.equal(run.commitDraft.ready, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("codex run commit seviyesinde HEAD degisirse commit taslagini hazir saymaz", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ctxlab-runner-"));
  const projectDir = await mkdtemp(join(tmpdir(), "ctxlab-project-"));
  const paths = buildRunnerPaths(dir);
  let statusCalls = 0;
  let headCalls = 0;

  try {
    const project = await registerProject(paths, {
      name: "ctx-lab",
      path: projectDir
    });
    const run = await startCodexRun(paths, {
      projectId: project.id,
      automationLevel: "commit_prepare",
      prompt: "Testleri calistir ve commit taslagini hazirla.",
      dryRun: false
    }, {
      now: new Date("2026-05-14T12:31:00.000Z"),
      finishedAt: new Date("2026-05-14T12:32:00.000Z"),
      candidates: ["codex.cmd"],
      runCommand: async (_command, args) => {
        if (args.includes("--version")) return { ok: true, stdout: "codex-cli test\n", stderr: "", code: 0 };
        return { ok: true, stdout: "npm test\nall tests passed\n", stderr: "", code: 0 };
      },
      gitCommand: async (_command, args) => {
        if (args.includes("--is-inside-work-tree")) return { ok: true, stdout: "true\n", stderr: "", code: 0 };
        if (args.includes("--abbrev-ref")) return { ok: true, stdout: "main\n", stderr: "", code: 0 };
        if (args.includes("HEAD")) {
          headCalls += 1;
          return { ok: true, stdout: headCalls === 1 ? "abcdef1234567890\n" : "fedcba0987654321\n", stderr: "", code: 0 };
        }
        if (args.includes("status")) {
          statusCalls += 1;
          return { ok: true, stdout: statusCalls === 1 ? "" : " M src/main.js\n", stderr: "", code: 0 };
        }
        return { ok: false, stdout: "", stderr: "beklenmeyen git komutu", code: 1 };
      }
    });
    const headCheck = run.commitReadiness.checks.find((check) => check.id === "head");

    assert.equal(run.status, "succeeded");
    assert.equal(run.testResult, "passed");
    assert.equal(headCheck.ok, false);
    assert.match(headCheck.detail, /Git HEAD değişti/);
    assert.equal(run.commitReadiness.ready, false);
    assert.equal(run.commitDraft.ready, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("codex run git baslangic ve sonuc snapshotlarini loglar", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ctxlab-runner-"));
  const projectDir = await mkdtemp(join(tmpdir(), "ctxlab-project-"));
  const paths = buildRunnerPaths(dir);
  let statusCalls = 0;

  try {
    const project = await registerProject(paths, {
      name: "ctx-lab",
      path: projectDir
    });
    const run = await startCodexRun(paths, {
      projectId: project.id,
      automationLevel: "edit_no_commit",
      prompt: "Kucuk bir dosya degisikligi hazirla.",
      dryRun: false
    }, {
      now: new Date("2026-05-14T12:32:00.000Z"),
      finishedAt: new Date("2026-05-14T12:33:00.000Z"),
      candidates: ["codex.cmd"],
      runCommand: async (_command, args) => {
        if (args.includes("--version")) return { ok: true, stdout: "codex-cli test\n", stderr: "", code: 0 };
        return { ok: true, stdout: "{\"event\":\"done\"}\n", stderr: "", code: 0 };
      },
      gitCommand: async (_command, args) => {
        if (args.includes("--is-inside-work-tree")) return { ok: true, stdout: "true\n", stderr: "", code: 0 };
        if (args.includes("--abbrev-ref")) return { ok: true, stdout: "main\n", stderr: "", code: 0 };
        if (args.includes("HEAD")) return { ok: true, stdout: "abcdef1234567890\n", stderr: "", code: 0 };
        if (args.includes("status")) {
          statusCalls += 1;
          return { ok: true, stdout: statusCalls === 1 ? "" : " M src/main.js\n", stderr: "", code: 0 };
        }
        return { ok: false, stdout: "", stderr: "beklenmeyen git komutu", code: 1 };
      }
    });
    const log = JSON.parse(await readFile(run.logPath, "utf8"));

    assert.equal(run.gitBefore.available, true);
    assert.equal(run.gitBefore.dirty, false);
    assert.equal(run.gitAfter.dirty, true);
    assert.deepEqual(run.gitAfter.changedFiles, ["M src/main.js"]);
    assert.equal(log.gitAfter.changedCount, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("codex commit push gercek calisma icin ayrica onay ister", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ctxlab-runner-"));
  const projectDir = await mkdtemp(join(tmpdir(), "ctxlab-project-"));
  const paths = buildRunnerPaths(dir);
  const calls = [];

  try {
    const project = await registerProject(paths, {
      name: "ctx-lab",
      path: projectDir
    });
    const run = await startCodexRun(paths, {
      projectId: project.id,
      automationLevel: "commit_push",
      prompt: "Commit ve push hazirla.",
      dryRun: false
    }, {
      now: new Date("2026-05-14T12:35:00.000Z"),
      runCommand: async (command, args) => {
        calls.push({ command, args });
        return { ok: true, stdout: "", stderr: "", code: 0 };
      }
    });
    const log = JSON.parse(await readFile(run.logPath, "utf8"));

    assert.equal(run.status, "blocked");
    assert.equal(run.testResult, "not_run");
    assert.equal(run.commitReadiness.ready, false);
    assert.equal(run.commitDraft.ready, false);
    assert.equal(run.commitDraft.pushAllowed, false);
    assert.match(run.error, /onayı verilmedi/);
    assert.equal(log.status, "blocked");
    assert.deepEqual(calls, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("codex run commit taslagini onayla uygular ve push eder", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ctxlab-runner-"));
  const projectDir = await mkdtemp(join(tmpdir(), "ctxlab-project-"));
  const paths = buildRunnerPaths(dir);
  const calls = [];
  let statusCalls = 0;
  let headCalls = 0;

  const gitCommand = async (_command, args) => {
    calls.push(args);
    if (args.includes("--is-inside-work-tree")) return { ok: true, stdout: "true\n", stderr: "", code: 0 };
    if (args.includes("--abbrev-ref")) return { ok: true, stdout: "main\n", stderr: "", code: 0 };
    if (args.includes("status")) {
      statusCalls += 1;
      return { ok: true, stdout: statusCalls === 1 ? "" : " M src/main.js\n", stderr: "", code: 0 };
    }
    if (args.includes("add")) return { ok: true, stdout: "", stderr: "", code: 0 };
    if (args.includes("commit")) return { ok: true, stdout: "[main commitsha] test\n", stderr: "", code: 0 };
    if (args.includes("push")) return { ok: true, stdout: "pushed\n", stderr: "", code: 0 };
    if (args.includes("HEAD")) {
      headCalls += 1;
      return { ok: true, stdout: headCalls >= 4 ? "commitsha123\n" : "abcdef1234567890\n", stderr: "", code: 0 };
    }
    return { ok: false, stdout: "", stderr: "beklenmeyen git komutu", code: 1 };
  };

  try {
    const project = await registerProject(paths, {
      name: "ctx-lab",
      path: projectDir
    });
    const run = await startCodexRun(paths, {
      projectId: project.id,
      automationLevel: "commit_push",
      prompt: "Commit taslagini uygula.",
      dryRun: false,
      confirmCommitPush: true
    }, {
      now: new Date("2026-05-14T12:40:00.000Z"),
      finishedAt: new Date("2026-05-14T12:41:00.000Z"),
      candidates: ["codex.cmd"],
      runCommand: async (_command, args) => {
        if (args.includes("--version")) return { ok: true, stdout: "codex-cli test\n", stderr: "", code: 0 };
        return { ok: true, stdout: "all tests passed\n", stderr: "", code: 0 };
      },
      gitCommand
    });
    const updated = await applyCodexRunCommit(paths, {
      runId: run.id,
      confirmCommit: true,
      confirmPush: true
    }, {
      now: new Date("2026-05-14T12:42:00.000Z"),
      gitCommand
    });

    assert.equal(updated.commitApplication.status, "pushed");
    assert.equal(updated.commitApplication.commitSha, "commitsha123");
    assert.ok(calls.some((args) => args.includes("add") && args.includes("src/main.js")));
    assert.ok(calls.some((args) => args.includes("commit") && args.includes(run.commitDraft.message)));
    assert.ok(calls.some((args) => args.includes("push")));
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("codex run commit uygulamasi git durumu degistiyse reddeder", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ctxlab-runner-"));
  const projectDir = await mkdtemp(join(tmpdir(), "ctxlab-project-"));
  const paths = buildRunnerPaths(dir);
  const calls = [];
  let statusCalls = 0;

  const gitCommand = async (_command, args) => {
    calls.push(args);
    if (args.includes("--is-inside-work-tree")) return { ok: true, stdout: "true\n", stderr: "", code: 0 };
    if (args.includes("--abbrev-ref")) return { ok: true, stdout: "main\n", stderr: "", code: 0 };
    if (args.includes("HEAD")) return { ok: true, stdout: "abcdef1234567890\n", stderr: "", code: 0 };
    if (args.includes("status")) {
      statusCalls += 1;
      const stdout = statusCalls === 1 ? "" : (statusCalls === 2 ? " M src/main.js\n" : " M src/other.js\n");
      return { ok: true, stdout, stderr: "", code: 0 };
    }
    if (args.includes("add")) return { ok: true, stdout: "", stderr: "", code: 0 };
    return { ok: false, stdout: "", stderr: "beklenmeyen git komutu", code: 1 };
  };

  try {
    const project = await registerProject(paths, {
      name: "ctx-lab",
      path: projectDir
    });
    const run = await startCodexRun(paths, {
      projectId: project.id,
      automationLevel: "commit_prepare",
      prompt: "Commit taslagini hazirla.",
      dryRun: false
    }, {
      now: new Date("2026-05-14T12:45:00.000Z"),
      candidates: ["codex.cmd"],
      runCommand: async (_command, args) => {
        if (args.includes("--version")) return { ok: true, stdout: "codex-cli test\n", stderr: "", code: 0 };
        return { ok: true, stdout: "tests passed\n", stderr: "", code: 0 };
      },
      gitCommand
    });

    await assert.rejects(
      () => applyCodexRunCommit(paths, {
        runId: run.id,
        confirmCommit: true
      }, { gitCommand }),
      /Git durumu Codex run sonrası değişmiş/
    );
    assert.equal(calls.some((args) => args.includes("add")), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("runner server /health endpointini sunar", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ctxlab-runner-"));
  const paths = buildRunnerPaths(dir);
  const server = createRunnerServer({
    paths,
    runCommand: async () => ({ ok: true, stdout: "codex-cli test\n", stderr: "" })
  });

  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.service, "ctx-lab-runner");
    assert.equal(body.codex.available, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test("runner server kok endpointinde saglik ve endpoint listesini sunar", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ctxlab-runner-"));
  const paths = buildRunnerPaths(dir);
  const server = createRunnerServer({
    paths,
    runCommand: async () => ({ ok: true, stdout: "codex-cli test\n", stderr: "" })
  });

  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.service, "ctx-lab-runner");
    assert.deepEqual(body.endpoints, ["/health", "/projects", "/runs", "/runs/events", "/runs/codex", "/runs/commit", "/memory/status", "/memory/index", "/memory/sync"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test("runner server token korumasi varsa HTTP isteklerini dogrular", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ctxlab-runner-"));
  const paths = buildRunnerPaths(dir);
  const server = createRunnerServer({
    paths,
    runnerToken: "secret-token",
    runCommand: async () => ({ ok: true, stdout: "codex-cli test\n", stderr: "" })
  });

  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const rejected = await fetch(`http://127.0.0.1:${port}/health`);
    const rejectedBody = await rejected.json();
    const accepted = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { "x-ctxlab-runner-token": "secret-token" }
    });
    const acceptedBody = await accepted.json();

    assert.equal(rejected.status, 401);
    assert.match(rejectedBody.error, /token/);
    assert.equal(accepted.status, 200);
    assert.equal(acceptedBody.service, "ctx-lab-runner");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test("runner server /runs/events endpointinden olay gunlugunu sunar", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ctxlab-runner-"));
  const paths = buildRunnerPaths(dir);
  const server = createRunnerServer({ paths });
  const runId = "run_2026-05-14T13-10-00-000Z_ctx-lab";

  try {
    await ensureRunnerHome(paths);
    await writeFile(join(paths.runsDir, `${runId}.events.jsonl`), [
      JSON.stringify({ event: "stdout", at: "2026-05-14T13:10:01.000Z", runId, text: "ilerleme" }),
      JSON.stringify({ event: "finish", at: "2026-05-14T13:10:02.000Z", runId, status: "succeeded", exitCode: 0 })
    ].join("\n"), "utf8");
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/runs/events?runId=${runId}&limit=1`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");
    assert.equal(body.events.length, 1);
    assert.equal(body.events[0].event, "finish");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test("runner server /projects endpointinden proje kaydeder", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ctxlab-runner-"));
  const projectDir = await mkdtemp(join(tmpdir(), "ctxlab-project-"));
  const paths = buildRunnerPaths(dir);
  const server = createRunnerServer({
    paths,
    now: new Date("2026-05-14T12:00:00.000Z"),
    runCommand: async () => ({ ok: true, stdout: "codex-cli test\n", stderr: "" })
  });

  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "ctx-lab", path: projectDir, repo: "cagrisahin58/ctx-lab" })
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.ok, true);
    assert.equal(body.registry.projects.length, 1);
    assert.equal(body.project.name, "ctx-lab");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  }
});
