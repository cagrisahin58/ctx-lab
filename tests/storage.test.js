import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_LOG_STORAGE_KEY,
  CONFIG_STORAGE_KEY,
  RECORD_CACHE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  activityLogScope,
  loadActivityLog,
  loadAppConfig,
  loadRecordCache,
  loadTheme,
  memoryCacheScope,
  saveActivityLog,
  saveAppConfig,
  saveRecordCache,
  saveTheme
} from "../src/storage.js";

class MemoryStorage {
  constructor(seed = {}) {
    this.items = new Map(Object.entries(seed));
  }

  getItem(key) {
    return this.items.has(key) ? this.items.get(key) : null;
  }

  setItem(key, value) {
    this.items.set(key, String(value));
  }
}

test("uygulama ayarları varsayılan branch ile yüklenir ve kaydedilir", () => {
  const storage = new MemoryStorage();
  assert.deepEqual(loadAppConfig(storage), {
    owner: "",
    repo: "",
    branch: "main",
    token: ""
  });

  const saved = saveAppConfig({ owner: "cagrisahin58", repo: "work-memory", token: "x" }, storage);
  assert.equal(saved.branch, "main");
  assert.equal(JSON.parse(storage.getItem(CONFIG_STORAGE_KEY)).repo, "work-memory");
});

test("memory önbelleği owner repo ve branch kapsamıyla ayrılır", () => {
  const config = { owner: "CagriSahin58", repo: "Work-Memory", branch: "main" };
  const otherConfig = { owner: "CagriSahin58", repo: "Work-Memory", branch: "dev" };

  assert.equal(memoryCacheScope(config), "cagrisahin58/work-memory@main");
  assert.equal(memoryCacheScope({}), "");

  const storage = new MemoryStorage();
  const saved = saveRecordCache(config, [{ id: "sess_1", type: "inbox" }], storage, new Date("2026-05-13T12:00:00.000Z"), {
    remoteHead: "abc123"
  });

  assert.equal(saved.syncedAt, "2026-05-13T12:00:00.000Z");
  assert.equal(saved.remoteHead, "abc123");
  assert.equal(JSON.parse(storage.getItem(RECORD_CACHE_STORAGE_KEY)).records.length, 1);
  assert.equal(loadRecordCache(config, storage).records[0].id, "sess_1");
  assert.equal(loadRecordCache(config, storage).remoteHead, "abc123");
  assert.deepEqual(loadRecordCache(otherConfig, storage).records, []);
});

test("bozuk veya eksik önbellek güvenli biçimde boş döner", () => {
  const config = { owner: "cagrisahin58", repo: "work-memory", branch: "main" };
  const storage = new MemoryStorage({
    [RECORD_CACHE_STORAGE_KEY]: "{bozuk-json"
  });

  const cache = loadRecordCache(config, storage);
  assert.equal(cache.scope, "cagrisahin58/work-memory@main");
  assert.equal(cache.syncedAt, "");
  assert.deepEqual(cache.records, []);
});

test("tema tercihi açık ve koyu seçenekleriyle saklanır", () => {
  const storage = new MemoryStorage();

  assert.equal(loadTheme(storage), "dark");
  assert.equal(saveTheme("light", storage), "light");
  assert.equal(storage.getItem(THEME_STORAGE_KEY), "light");
  assert.equal(loadTheme(storage), "light");
  assert.equal(saveTheme("bilinmeyen", storage), "dark");
  assert.equal(loadTheme(storage), "dark");
});

test("çalışma günlüğü repo branch kapsamıyla saklanır ve temizlenir", () => {
  const config = { owner: "CagriSahin58", repo: "Work-Memory", branch: "main" };
  const otherConfig = { owner: "CagriSahin58", repo: "Work-Memory", branch: "dev" };
  const storage = new MemoryStorage();
  const items = Array.from({ length: 26 }, (_, index) => ({
    id: `activity_${index}`,
    at: "2026-05-14T12:00:00.000Z",
    kind: index === 0 ? "success" : "bilinmeyen",
    message: `Olay ${index}`,
    detail: index === 0 ? "Ayrıntı" : ""
  }));

  assert.equal(activityLogScope(config), "cagrisahin58/work-memory@main");
  assert.equal(activityLogScope({}), "local");

  const saved = saveActivityLog(config, items, storage);
  assert.equal(saved.length, 24);
  assert.equal(saved[0].kind, "success");
  assert.equal(saved[1].kind, "info");
  assert.equal(JSON.parse(storage.getItem(ACTIVITY_LOG_STORAGE_KEY)).scope, "cagrisahin58/work-memory@main");
  assert.equal(loadActivityLog(config, storage)[0].message, "Olay 0");
  assert.deepEqual(loadActivityLog(otherConfig, storage), []);
});

test("bozuk çalışma günlüğü güvenli biçimde boş döner", () => {
  const config = { owner: "cagrisahin58", repo: "work-memory", branch: "main" };
  const storage = new MemoryStorage({
    [ACTIVITY_LOG_STORAGE_KEY]: "{bozuk-json"
  });

  assert.deepEqual(loadActivityLog(config, storage), []);
});
