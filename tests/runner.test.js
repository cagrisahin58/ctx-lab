import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildHealthPayload,
  buildRunnerPaths,
  codexCandidates,
  createRunnerServer,
  detectCodex,
  ensureRunnerHome,
  readProjectRegistry,
  resolveAppDataDir
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
