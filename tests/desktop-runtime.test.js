import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildRunnerPaths } from "../scripts/ctxlab-runner.mjs";
import { createDesktopRuntime, DESKTOP_IPC_CHANNELS, registerDesktopIpcHandlers } from "../electron/runtime.mjs";

test("desktop runtime runner sagligi, proje kaydi ve klasor secimini tek IPC yuzeyinde sunar", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ctxlab-desktop-"));
  const projectDir = await mkdtemp(join(tmpdir(), "ctxlab-project-"));
  const runtime = createDesktopRuntime({
    paths: buildRunnerPaths(dir),
    dialog: {
      showOpenDialog: async () => ({ canceled: false, filePaths: [projectDir] })
    },
    candidates: ["codex.cmd"],
    runCommand: async () => ({ ok: true, stdout: "codex-cli test\n", stderr: "", code: 0 })
  });

  try {
    const health = await runtime.health();
    const selected = await runtime.selectProjectDirectory();
    const saved = await runtime.registerProject({ name: "ctx-lab", path: projectDir });
    const registry = await runtime.listProjects();

    assert.equal(health.service, "ctx-lab-runner");
    assert.equal(selected.path, projectDir);
    assert.equal(saved.project.name, "ctx-lab");
    assert.equal(registry.projects.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("desktop IPC handlerlari sadece izinli kanallari kaydeder", () => {
  const handled = [];
  const ipcMain = {
    handle(channel, handler) {
      handled.push({ channel, handler });
    }
  };
  const runtime = createDesktopRuntime({
    paths: buildRunnerPaths(join(tmpdir(), "ctxlab-ipc-test"))
  });
  const channels = registerDesktopIpcHandlers(ipcMain, runtime);

  assert.deepEqual(channels.sort(), Object.values(DESKTOP_IPC_CHANNELS).sort());
  assert.ok(handled.every((item) => typeof item.handler === "function"));
});

test("desktop runtime test klasor secimini env kancasi ile dondurur", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ctxlab-desktop-"));
  const projectDir = await mkdtemp(join(tmpdir(), "ctxlab-project-"));
  let dialogCalled = false;
  const runtime = createDesktopRuntime({
    paths: buildRunnerPaths(dir),
    mockProjectDirectory: projectDir,
    dialog: {
      showOpenDialog: async () => {
        dialogCalled = true;
        return { canceled: false, filePaths: ["C:\\yanlis"] };
      }
    }
  });

  try {
    const selected = await runtime.selectProjectDirectory();
    assert.equal(selected.path, projectDir);
    assert.equal(dialogCalled, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("desktop runtime codex run olaylarini IPC yuzeyinden okur", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ctxlab-desktop-"));
  const paths = buildRunnerPaths(dir);
  const runId = "run_2026-05-14T13-00-00-000Z_ctx-lab";
  const runtime = createDesktopRuntime({ paths });

  try {
    await mkdir(paths.runsDir, { recursive: true });
    await writeFile(join(paths.runsDir, `${runId}.events.jsonl`), [
      JSON.stringify({ event: "stdout", at: "2026-05-14T13:00:01.000Z", runId, text: "ilerleme" }),
      JSON.stringify({ event: "finish", at: "2026-05-14T13:00:02.000Z", runId, status: "succeeded", exitCode: 0 })
    ].join("\n"), "utf8");

    const events = await runtime.runEvents({ runId, limit: 5 });

    assert.equal(events.status, "ok");
    assert.equal(events.events[0].event, "stdout");
    assert.equal(events.events[1].status, "succeeded");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
