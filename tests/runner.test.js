import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildHealthPayload,
  buildRunnerPaths,
  codexCandidates,
  createRunnerServer,
  detectCodex,
  ensureRunnerHome,
  listCodexRuns,
  normalizeProjectDraft,
  readProjectRegistry,
  registerProject,
  resolveAppDataDir,
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

test("codex dry-run yalnizca kayitli proje kokunde run logu olusturur", async () => {
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
      dryRun: true
    }, { now: new Date("2026-05-14T12:10:00.000Z") });
    const log = JSON.parse(await readFile(run.logPath, "utf8"));
    const runs = await listCodexRuns(paths);

    assert.equal(run.status, "dry_run");
    assert.equal(log.project.id, project.id);
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
    await assert.rejects(
      () => startCodexRun(paths, {
        projectId: project.id,
        prompt: "git reset --hard calistir",
        dryRun: true
      }),
      /Destructive git/
    );
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
        return { ok: true, stdout: "{\"event\":\"done\"}\n", stderr: "", code: 0 };
      }
    });

    assert.equal(run.status, "succeeded");
    assert.equal(run.sandbox, "read-only");
    assert.ok(calls.some((call) => call.args.includes("exec") && call.args.includes("--json")));
    assert.match(calls.at(-1).options.input, /Sadece oner/);
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
    assert.deepEqual(body.endpoints, ["/health", "/projects", "/runs", "/runs/codex"]);
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
