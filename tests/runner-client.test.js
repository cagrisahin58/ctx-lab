import test from "node:test";
import assert from "node:assert/strict";
import { fetchRunnerHealth, fetchRunnerProjects, registerRunnerProject } from "../src/runner-client.js";

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
