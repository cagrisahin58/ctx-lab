import test from "node:test";
import assert from "node:assert/strict";
import { deleteFile, diagnoseMemoryRepo, ensureMemoryRepo, getBranchHead, loadMemoryRepo, putFile } from "../src/github.js";

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
    assert.match(body.message, /ctx-lab hafıza reposu|klasörünü hazırla/);
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

test("diagnoseMemoryRepo repo, branch, config ve klasörleri raporlar", async () => {
  const mock = installFetchMock((url) => {
    if (url.endsWith("/repos/cagrisahin58/work-memory")) {
      return { json: { private: true, default_branch: "main", permissions: { push: true } } };
    }
    if (url.endsWith("/repos/cagrisahin58/work-memory/branches/main")) {
      return { json: { name: "main" } };
    }
    if (url.endsWith("/contents/config.yaml?ref=main")) {
      return { json: { sha: "config-sha", content: encode("schema_version: 1") } };
    }
    if (/\/contents\/(inbox|work_items|decisions|handoffs|archive)\?ref=main$/.test(url)) {
      return { json: [] };
    }
    if (url.endsWith("/contents/archive/.ctxlab-write-test")) {
      return { json: { content: { sha: "write-sha" } } };
    }
    throw new Error(`Beklenmeyen URL: ${url}`);
  });

  try {
    const result = await diagnoseMemoryRepo(config);
    assert.equal(result.ok, true);
    assert.equal(result.repo.detail.private, true);
    assert.equal(result.repo.detail.writeHint, true);
    assert.equal(result.branch.detail.name, "main");
    assert.equal(result.configFile.detail.sha, "config-sha");
    assert.equal(result.directories.length, 5);
    assert.ok(result.directories.every((item) => item.ok));
    assert.equal(result.writeAccess.ok, true);
    assert.equal(result.writeAccess.detail.path, "archive/.ctxlab-write-test");
    assert.ok(mock.calls.some((call) => call.options.method === "PUT"));
    assert.ok(mock.calls.some((call) => call.options.method === "DELETE"));
  } finally {
    mock.restore();
  }
});

test("diagnoseMemoryRepo eksik klasörü başarısız check olarak döndürür", async () => {
  const mock = installFetchMock((url) => {
    if (url.endsWith("/repos/cagrisahin58/work-memory")) {
      return { json: { private: true, default_branch: "main" } };
    }
    if (url.endsWith("/repos/cagrisahin58/work-memory/branches/main")) {
      return { json: { name: "main" } };
    }
    if (url.endsWith("/contents/config.yaml?ref=main")) {
      return { json: { sha: "config-sha", content: encode("schema_version: 1") } };
    }
    if (url.endsWith("/contents/inbox?ref=main")) {
      return { ok: true, status: 404, json: null };
    }
    if (/\/contents\/(work_items|decisions|handoffs|archive)\?ref=main$/.test(url)) {
      return { json: [] };
    }
    if (url.endsWith("/contents/archive/.ctxlab-write-test")) {
      return { json: { content: { sha: "write-sha" } } };
    }
    throw new Error(`Beklenmeyen URL: ${url}`);
  });

  try {
    const result = await diagnoseMemoryRepo(config);
    assert.equal(result.ok, false);
    assert.equal(result.directories[0].ok, false);
    assert.match(result.directories[0].message, /inbox\/ klasörü bulunamadı/);
  } finally {
    mock.restore();
  }
});

test("diagnoseMemoryRepo yazma izni yoksa yazma testini başarısız gösterir", async () => {
  const mock = installFetchMock((url, options = {}) => {
    if (url.endsWith("/repos/cagrisahin58/work-memory")) {
      return { json: { private: true, default_branch: "main", permissions: { push: true } } };
    }
    if (url.endsWith("/repos/cagrisahin58/work-memory/branches/main")) {
      return { json: { name: "main" } };
    }
    if (url.endsWith("/contents/config.yaml?ref=main")) {
      return { json: { sha: "config-sha", content: encode("schema_version: 1") } };
    }
    if (/\/contents\/(inbox|work_items|decisions|handoffs|archive)\?ref=main$/.test(url)) {
      return { json: [] };
    }
    if (options.method === "PUT" && url.endsWith("/contents/archive/.ctxlab-write-test")) {
      return { ok: false, status: 404, text: "Not Found" };
    }
    throw new Error(`Beklenmeyen URL: ${url}`);
  });

  try {
    const result = await diagnoseMemoryRepo(config);
    assert.equal(result.ok, false);
    assert.equal(result.writeAccess.ok, false);
    assert.match(result.writeAccess.message, /GitHub 404: Repo, branch veya dosya bulunamadı/);
  } finally {
    mock.restore();
  }
});

test("diagnoseMemoryRepo 403 hatasını Türkçe izin açıklamasıyla raporlar", async () => {
  const mock = installFetchMock((url) => {
    if (url.endsWith("/repos/cagrisahin58/work-memory")) {
      return { ok: false, status: 403, json: { message: "Resource not accessible by personal access token" } };
    }
    throw new Error(`Beklenmeyen URL: ${url}`);
  });

  try {
    const result = await diagnoseMemoryRepo(config);
    assert.equal(result.ok, false);
    assert.equal(result.repo.ok, false);
    assert.match(result.repo.message, /GitHub 403: Erişim reddedildi/);
    assert.match(result.repo.message, /Contents read\/write/);
    assert.match(result.repo.message, /Resource not accessible/);
  } finally {
    mock.restore();
  }
});

test("diagnoseMemoryRepo 404 hatasını owner repo branch kontrolüyle açıklar", async () => {
  const mock = installFetchMock((url) => {
    if (url.endsWith("/repos/cagrisahin58/work-memory")) {
      return { ok: false, status: 404, json: { message: "Not Found" } };
    }
    throw new Error(`Beklenmeyen URL: ${url}`);
  });

  try {
    const result = await diagnoseMemoryRepo(config);
    assert.equal(result.ok, false);
    assert.equal(result.repo.ok, false);
    assert.match(result.repo.message, /GitHub 404: Repo, branch veya dosya bulunamadı/);
    assert.match(result.repo.message, /owner\/repo ve branch/);
  } finally {
    mock.restore();
  }
});

test("getBranchHead seçili branch commit sha değerini okur", async () => {
  const mock = installFetchMock((url) => {
    if (url.endsWith("/repos/cagrisahin58/work-memory/branches/main")) {
      return { json: { commit: { sha: "head-sha" } } };
    }
    throw new Error(`Beklenmeyen URL: ${url}`);
  });

  try {
    assert.equal(await getBranchHead(config), "head-sha");
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

test("putFile stale sha hatasında son sha ile tekrar dener", async () => {
  let putCount = 0;
  const mock = installFetchMock((url, options = {}) => {
    if (options.method === "PUT") {
      putCount += 1;
      const body = JSON.parse(options.body);
      if (putCount === 1) {
        assert.equal(body.sha, "old-sha");
        return { ok: false, status: 409, text: "sha eski" };
      }
      assert.equal(body.sha, "fresh-sha");
      return { json: { content: { sha: "new-sha" } } };
    }
    if (url.endsWith("/contents/inbox/test.md?ref=main")) {
      return { json: { sha: "fresh-sha", content: encode("eski içerik") } };
    }
    throw new Error(`Beklenmeyen URL: ${url}`);
  });

  try {
    const result = await putFile(config, "inbox/test.md", "yeni içerik", "retry commit", "old-sha");
    assert.equal(result.content.sha, "new-sha");
    assert.equal(putCount, 2);
  } finally {
    mock.restore();
  }
});

test("putFile dosya zaten varsa sha okuyup create isteğini update'e çevirir", async () => {
  let putCount = 0;
  const mock = installFetchMock((url, options = {}) => {
    if (options.method === "PUT") {
      putCount += 1;
      const body = JSON.parse(options.body);
      if (putCount === 1) {
        assert.equal(body.sha, undefined);
        return { ok: false, status: 422, text: "sha gerekli" };
      }
      assert.equal(body.sha, "existing-sha");
      return { json: { content: { sha: "updated-sha" } } };
    }
    if (url.endsWith("/contents/inbox/existing.md?ref=main")) {
      return { json: { sha: "existing-sha", content: encode("mevcut") } };
    }
    throw new Error(`Beklenmeyen URL: ${url}`);
  });

  try {
    const result = await putFile(config, "inbox/existing.md", "güncel", "upsert commit");
    assert.equal(result.content.sha, "updated-sha");
    assert.equal(putCount, 2);
  } finally {
    mock.restore();
  }
});

test("deleteFile stale sha hatasında son sha ile tekrar dener", async () => {
  let deleteCount = 0;
  const mock = installFetchMock((url, options = {}) => {
    if (options.method === "DELETE") {
      deleteCount += 1;
      const body = JSON.parse(options.body);
      if (deleteCount === 1) {
        assert.equal(body.sha, "old-sha");
        return { ok: false, status: 409, text: "sha eski" };
      }
      assert.equal(body.sha, "fresh-sha");
      return { json: { commit: { sha: "delete-commit" } } };
    }
    if (url.endsWith("/contents/inbox/test.md?ref=main")) {
      return { json: { sha: "fresh-sha", content: encode("silinecek") } };
    }
    throw new Error(`Beklenmeyen URL: ${url}`);
  });

  try {
    const result = await deleteFile(config, "inbox/test.md", "old-sha", "delete retry");
    assert.equal(result.commit.sha, "delete-commit");
    assert.equal(deleteCount, 2);
  } finally {
    mock.restore();
  }
});
