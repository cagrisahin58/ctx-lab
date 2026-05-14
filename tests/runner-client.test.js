import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchRunnerHealth,
  fetchRunnerProjects,
  fetchRunnerRuns,
  fetchMemoryMirrorStatus,
  syncMemoryMirror,
  registerRunnerProject,
  selectRunnerProjectDirectory,
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

test("runner client run listesi ve codex run endpointini kullanir", async () => {
  const calls = [];
  const runs = await fetchRunnerRuns({
    baseUrl: "http://runner.test",
    limit: 5,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(200, { runs: [{ id: "run_1" }] });
    }
  });
  const started = await startRunnerCodexRun({ projectId: "project_1", prompt: "Brif" }, {
    baseUrl: "http://runner.test",
    fetch: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(201, { id: "run_2", status: "dry_run" });
    }
  });

  assert.equal(calls[0].url, "http://runner.test/runs?limit=5");
  assert.equal(JSON.parse(calls[1].options.body).projectId, "project_1");
  assert.equal(runs.runs[0].id, "run_1");
  assert.equal(started.status, "dry_run");
});

test("runner client memory mirror durumunu okur ve sync istegi yollar", async () => {
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
  assert.equal(calls[1].url, "http://runner.test/memory/sync");
  assert.equal(JSON.parse(calls[1].options.body).repo, "work-memory");
  assert.equal(status.recordCount, 2);
  assert.equal(sync.recordCount, 2);
});

test("runner client masaustu IPC varsa HTTP yerine onu kullanir", async () => {
  const desktopApi = {
    runnerHealth: async () => ({ service: "desktop" }),
    runnerProjects: async () => ({ projects: [{ name: "ctx-lab" }] }),
    registerProject: async (project) => ({ project }),
    selectProjectDirectory: async () => ({ path: "C:\\repo" }),
    runnerRuns: async () => ({ runs: [{ id: "run_desktop" }] }),
    startCodexRun: async (run) => ({ ...run, status: "dry_run" }),
    memoryStatus: async () => ({ indexed: true }),
    syncMemory: async () => ({ recordCount: 3 })
  };

  assert.equal((await fetchRunnerHealth({ desktopApi })).service, "desktop");
  assert.equal((await fetchRunnerProjects({ desktopApi })).projects[0].name, "ctx-lab");
  assert.equal((await registerRunnerProject({ name: "x" }, { desktopApi })).project.name, "x");
  assert.equal((await selectRunnerProjectDirectory({ desktopApi })).path, "C:\\repo");
  assert.equal((await fetchRunnerRuns({ desktopApi })).runs[0].id, "run_desktop");
  assert.equal((await startRunnerCodexRun({ prompt: "x" }, { desktopApi })).status, "dry_run");
  assert.equal((await fetchMemoryMirrorStatus({}, { desktopApi })).indexed, true);
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
