export const CONFIG_STORAGE_KEY = "ctxlab.config.v1";
export const RECORD_CACHE_STORAGE_KEY = "ctxlab.records.cache.v1";
export const THEME_STORAGE_KEY = "ctxlab.theme.v1";

export const DEFAULT_CONFIG = {
  owner: "",
  repo: "",
  branch: "main",
  token: ""
};

export function loadAppConfig(storage = localStorage) {
  try {
    return { ...DEFAULT_CONFIG, ...(JSON.parse(storage.getItem(CONFIG_STORAGE_KEY)) || {}) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveAppConfig(config, storage = localStorage) {
  const normalized = { ...DEFAULT_CONFIG, ...config };
  storage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function loadTheme(storage = localStorage) {
  const value = storage.getItem(THEME_STORAGE_KEY);
  return value === "light" ? "light" : "dark";
}

export function saveTheme(theme, storage = localStorage) {
  const normalized = theme === "light" ? "light" : "dark";
  storage.setItem(THEME_STORAGE_KEY, normalized);
  return normalized;
}

export function memoryCacheScope(config) {
  if (!config?.owner || !config?.repo) return "";
  return `${config.owner}/${config.repo}@${config.branch || "main"}`.toLowerCase();
}

export function loadRecordCache(config, storage = localStorage) {
  const scope = memoryCacheScope(config);
  if (!scope) return emptyCache(scope);

  try {
    const payload = JSON.parse(storage.getItem(RECORD_CACHE_STORAGE_KEY) || "null");
    if (!payload || payload.scope !== scope || !Array.isArray(payload.records)) {
      return emptyCache(scope);
    }
    return {
      scope,
      syncedAt: payload.syncedAt || "",
      records: payload.records
    };
  } catch {
    return emptyCache(scope);
  }
}

export function saveRecordCache(config, records, storage = localStorage, now = new Date()) {
  const scope = memoryCacheScope(config);
  if (!scope) return emptyCache(scope);

  const payload = {
    scope,
    syncedAt: now.toISOString(),
    records: Array.isArray(records) ? records : []
  };
  storage.setItem(RECORD_CACHE_STORAGE_KEY, JSON.stringify(payload));
  return payload;
}

function emptyCache(scope = "") {
  return {
    scope,
    syncedAt: "",
    records: []
  };
}
