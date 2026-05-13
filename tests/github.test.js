import test from "node:test";
import assert from "node:assert/strict";
import { ensureMemoryRepo, loadMemoryRepo, putFile } from "../src/github.js";

const config = {
  owner: "cagrisahin58",
  repo: "work-memory",
  branch: "main",
  token: "gh_test"
};

function encode(value) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(value)));
}

function installFetchMock(handler) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const result = await handler(String(url), options);
    return {
      ok: result.ok ?? true,
      status: result.status ?? 200,
      json: async () => result.json,
      text: async () => result.text || JSON.stringify(result.json || {})
    };
  };
  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    }
  };
}

test("loadMemoryRepo GitHub klasörlerini okuyup markdown kayıtlarına çevirir", async () => {
  const inboxContent = `---
id: sess_one
source: codex
project: ctx-lab
status: needs_triage
created_at: 2026-05-13T10:00:00.000Z
---

# Session Summary

## Amaç
GitHub okuma akışını test etmek.
`;
  const decisionContent = `---
id: dec_one
title: GitHub test kararı
project: ctx-lab
created_at: 2026-05-13T11:00:00.000Z
---

## Karar
Mock fetch kullanılacak.
`;
  const mock = installFetchMock((url) => {
    if (url.endsWith("/contents/inbox?ref=main")) {
      return { json: [{ type: "file", name: "one.md", path: "inbox/one.md" }] };
    }
    if (url.endsWith("/contents/decisions?ref=main")) {
      return { json: [{ type: "file", name: "one.md", path: "decisions/one.md" }] };
    }
    if (/\/contents\/(work_items|handoffs|archive)\?ref=main$/.test(url)) {
      return { json: [] };
    }
    if (url.endsWith("/contents/inbox/one.md?ref=main")) {
      return { json: { content: encode(inboxContent), sha: "sha-inbox" } };
    }
    if (url.endsWith("/contents/decisions/one.md?ref=main")) {
      return { json: { content: encode(decisionContent), sha: "sha-decision" } };
    }
    throw new Error(`Beklenmeyen URL: ${url}`);
  });

  try {
    const records = await loadMemoryRepo(config);
    assert.deepEqual(records.map((record) => record.id), ["dec_one", "sess_one"]);
    assert.equal(records[0].type, "decisions");
    assert.equal(records[1].sha, "sha-inbox");
    assert.ok(mock.calls.every((call) => call.options.headers.Authorization === "Bearer gh_test"));
  } finally {
    mock.restore();
  }
});

test("ensureMemoryRepo eksik config ve klasör tutucularını oluşturur", async () => {
  const existing = new Set(["inbox/.gitkeep"]);
  const mock = installFetchMock((url, options) => {
    const path = decodeURIComponent(url.split("/contents/")[1].split("?")[0]);
    if (!options.method) {
      if (existing.has(path)) return { json: { path, sha: `sha-${path}` } };
      return { ok: true, status: 404, json: null };
    }
    assert.equal(options.method, "PUT");
    const body = JSON.parse(options.body);
    existing.add(path);
    assert.equal(body.branch, "main");
    assert.match(body.message, /ctx-lab memory repo|klasörünü hazırla/);
    return { json: { content: { path, sha: `new-${path}` } } };
  });

  try {
    const created = await ensureMemoryRepo(config);
    assert.deepEqual(created, [
      "config.yaml",
      "work_items/.gitkeep",
      "decisions/.gitkeep",
      "handoffs/.gitkeep",
      "archive/.gitkeep"
    ]);
  } finally {
    mock.restore();
  }
});

test("putFile içeriği base64 yazar ve sha varsa gönderir", async () => {
  const mock = installFetchMock((url, options) => {
    assert.ok(url.endsWith("/repos/cagrisahin58/work-memory/contents/inbox/test.md"));
    assert.equal(options.method, "PUT");
    const body = JSON.parse(options.body);
    assert.equal(body.message, "test commit");
    assert.equal(body.branch, "main");
    assert.equal(body.sha, "old-sha");
    assert.equal(new TextDecoder().decode(Uint8Array.from(atob(body.content), (char) => char.charCodeAt(0))), "Türkçe içerik");
    return { json: { content: { sha: "new-sha" } } };
  });

  try {
    const result = await putFile(config, "inbox/test.md", "Türkçe içerik", "test commit", "old-sha");
    assert.equal(result.content.sha, "new-sha");
  } finally {
    mock.restore();
  }
});
