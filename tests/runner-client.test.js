import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchRunnerHealth,
  fetchRunnerProjects,
  fetchRunnerRunEvents,
  fetchRunnerRuns,
  fetchMemoryMirrorIndex,
  fetchMemoryMirrorStatus,
  syncMemoryMirror,
  registerRunnerProject,
  selectRunnerProjectDirectory,
  applyRunnerRunCommit,
  startRunnerCodexRun
} from "../src/runner-client.js";

test("runner client health endpointini okur", async () => {
  const calls = [];
  const health = await fetchRunnerHealth({
    baseUrl: "http://runner.test",
    fetch: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(200, { ok: true, service: "ctx-lab-runner" });
    }
  });

  assert.equal(calls[0].url, "http://runner.test/health");
  assert.equal(health.service, "ctx-lab-runner");
});

test("runner client HTTP token headerini gonderir", async () => {
  const calls = [];
  await fetchRunnerHealth({
    baseUrl: "http://runner.test",
    runnerToken: "secret-token",
    fetch: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(200, { ok: true, service: "ctx-lab-runner" });
    }
  });

  assert.equal(calls[0].options.headers["x-ctxlab-runner-token"], "secret-token");
});

test("runner client proje registry endpointini okur", async () => {
  const registry = await fetchRunnerProjects({
    baseUrl: "http://runner.test",
    fetch: async () => jsonResponse(200, { version: 1, projects: [{ name: "ctx-lab" }] })
  });

  assert.equal(registry.projects[0].name, "ctx-lab");
});

test("runner client proje kaydini JSON olarak gonderir", async () => {
  let requestBody = "";
  const result = await registerRunnerProject({ name: "ctx-lab", path: "C:\\repo" }, {
    baseUrl: "http://runner.test",
    fetch: async (url, options) => {
      requestBody = options.body;
      return jsonResponse(201, { ok: true, project: { name: "ctx-lab" } });
    }
  });

  assert.equal(JSON.parse(requestBody).path, "C:\\repo");
  assert.equal(result.project.name, "ctx-lab");
});

test("runner client run listesi, olay gunlugu ve codex run endpointini kullanir", async () => {
  const calls = [];
  const runs = await fetchRunnerRuns({
    baseUrl: "http://runner.test",
    limit: 5,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(200, { runs: [{ id: "run_1" }] });
    }
  });
  const events = await fetchRunnerRunEvents("run_1", {
    baseUrl: "http://runner.test",
    limit: 12,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(200, { runId: "run_1", events: [{ event: "finish" }] });
    }
  });
  const started = await startRunnerCodexRun({ projectId: "project_1", prompt: "Brif" }, {
    baseUrl: "http://runner.test",
    fetch: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(201, { id: "run_2", status: "dry_run" });
    }
  });
  const committed = await applyRunnerRunCommit({ runId: "run_2", confirmCommit: true }, {
    baseUrl: "http://runner.test",
    fetch: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(201, { id: "run_2", commitApplication: { status: "committed" } });
    }
  });

  assert.equal(calls[0].url, "http://runner.test/runs?limit=5");
  assert.equal(calls[1].url, "http://runner.test/runs/events?runId=run_1&limit=12");
  assert.equal(JSON.parse(calls[2].options.body).projectId, "project_1");
  assert.equal(calls[3].url, "http://runner.test/runs/commit");
  assert.equal(JSON.parse(calls[3].options.body).confirmCommit, true);
  assert.equal(runs.runs[0].id, "run_1");
  assert.equal(events.events[0].event, "finish");
  assert.equal(started.status, "dry_run");
  assert.equal(committed.commitApplication.status, "committed");
});

test("runner client memory mirror durumunu, indexini okur ve sync istegi yollar", async () => {
  const calls = [];
  const status = await fetchMemoryMirrorStatus({
    owner: "cagrisahin58",
    repo: "work-memory",
    branch: "main"
  }, {
    baseUrl: "http://runner.test",
    fetch: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(200, { indexed: true, recordCount: 2 });
    }
  });
  const index = await fetchMemoryMirrorIndex({
    owner: "cagrisahin58",
    repo: "work-memory",
    branch: "main"
  }, {
    baseUrl: "http://runner.test",
    fetch: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(200, { records: [{ id: "sess_1" }] });
    }
  });
  const sync = await syncMemoryMirror({
    owner: "cagrisahin58",
    repo: "work-memory",
    branch: "main"
  }, {
    baseUrl: "http://runner.test",
    fetch: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(201, { recordCount: 2 });
    }
  });

  assert.equal(calls[0].url, "http://runner.test/memory/status?owner=cagrisahin58&repo=work-memory&branch=main");
  assert.equal(calls[1].url, "http://runner.test/memory/index?owner=cagrisahin58&repo=work-memory&branch=main");
  assert.equal(calls[2].url, "http://runner.test/memory/sync");
  assert.equal(JSON.parse(calls[2].options.body).repo, "work-memory");
  assert.equal(status.recordCount, 2);
  assert.equal(index.records[0].id, "sess_1");
  assert.equal(sync.recordCount, 2);
});

test("runner client masaustu IPC varsa HTTP yerine onu kullanir", async () => {
  const desktopApi = {
    runnerHealth: async () => ({ service: "desktop" }),
    runnerProjects: async () => ({ projects: [{ name: "ctx-lab" }] }),
    registerProject: async (project) => ({ project }),
    selectProjectDirectory: async () => ({ path: "C:\\repo" }),
    runnerRuns: async () => ({ runs: [{ id: "run_desktop" }] }),
    runnerRunEvents: async (input) => ({ runId: input.runId, events: [{ event: "stdout" }] }),
    startCodexRun: async (run) => ({ ...run, status: "dry_run" }),
    applyRunCommit: async (input) => ({ id: input.runId, commitApplication: { status: "committed" } }),
    memoryStatus: async () => ({ indexed: true }),
    memoryIndex: async () => ({ records: [{ id: "sess_desktop" }] }),
    syncMemory: async () => ({ recordCount: 3 })
  };

  assert.equal((await fetchRunnerHealth({ desktopApi })).service, "desktop");
  assert.equal((await fetchRunnerProjects({ desktopApi })).projects[0].name, "ctx-lab");
  assert.equal((await registerRunnerProject({ name: "x" }, { desktopApi })).project.name, "x");
  assert.equal((await selectRunnerProjectDirectory({ desktopApi })).path, "C:\\repo");
  assert.equal((await fetchRunnerRuns({ desktopApi })).runs[0].id, "run_desktop");
  assert.equal((await fetchRunnerRunEvents("run_desktop", { desktopApi })).events[0].event, "stdout");
  assert.equal((await startRunnerCodexRun({ prompt: "x" }, { desktopApi })).status, "dry_run");
  assert.equal((await applyRunnerRunCommit({ runId: "run_desktop" }, { desktopApi })).commitApplication.status, "committed");
  assert.equal((await fetchMemoryMirrorStatus({}, { desktopApi })).indexed, true);
  assert.equal((await fetchMemoryMirrorIndex({}, { desktopApi })).records[0].id, "sess_desktop");
  assert.equal((await syncMemoryMirror({}, { desktopApi })).recordCount, 3);
});

test("runner client hata govdesini kullaniciya tasir", async () => {
  await assert.rejects(
    () => fetchRunnerHealth({
      baseUrl: "http://runner.test",
      fetch: async () => jsonResponse(500, { error: "runner kapali" })
    }),
    /runner kapali/
  );
});

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  };
}
