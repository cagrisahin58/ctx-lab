export const CONFIG_STORAGE_KEY = "ctxlab.config.v1";
export const RECORD_CACHE_STORAGE_KEY = "ctxlab.records.cache.v1";
export const THEME_STORAGE_KEY = "ctxlab.theme.v1";
export const ACTIVITY_LOG_STORAGE_KEY = "ctxlab.activity.log.v1";

export const DEFAULT_CONFIG = {
  owner: "",
  repo: "",
  branch: "main",
  token: "",
  onboardingComplete: false
};

export function loadAppConfig(storage = localStorage) {
  try {
    return normalizeAppConfig(JSON.parse(storage.getItem(CONFIG_STORAGE_KEY)) || {});
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveAppConfig(config, storage = localStorage) {
  const normalized = normalizeAppConfig(config);
  storage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

function normalizeAppConfig(config = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    onboardingComplete: Boolean(config.onboardingComplete)
  };
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
      remoteHead: payload.remoteHead || "",
      records: payload.records
    };
  } catch {
    return emptyCache(scope);
  }
}

export function saveRecordCache(config, records, storage = localStorage, now = new Date(), meta = {}) {
  const scope = memoryCacheScope(config);
  if (!scope) return emptyCache(scope);

  const payload = {
    scope,
    syncedAt: now.toISOString(),
    remoteHead: meta.remoteHead || "",
    records: Array.isArray(records) ? records : []
  };
  storage.setItem(RECORD_CACHE_STORAGE_KEY, JSON.stringify(payload));
  return payload;
}

export function activityLogScope(config) {
  return memoryCacheScope(config) || "local";
}

export function loadActivityLog(config, storage = localStorage) {
  const scope = activityLogScope(config);
  try {
    const payload = JSON.parse(storage.getItem(ACTIVITY_LOG_STORAGE_KEY) || "null");
    if (!payload || payload.scope !== scope || !Array.isArray(payload.items)) return [];
    return payload.items.map(normalizeActivityItem).filter(Boolean).slice(0, 24);
  } catch {
    return [];
  }
}

export function saveActivityLog(config, items, storage = localStorage) {
  const payload = {
    scope: activityLogScope(config),
    items: (Array.isArray(items) ? items : []).map(normalizeActivityItem).filter(Boolean).slice(0, 24)
  };
  storage.setItem(ACTIVITY_LOG_STORAGE_KEY, JSON.stringify(payload));
  return payload.items;
}

function emptyCache(scope = "") {
  return {
    scope,
    syncedAt: "",
    remoteHead: "",
    records: []
  };
}

function normalizeActivityItem(item = {}) {
  const id = truncateText(item.id || "");
  const at = truncateText(item.at || "");
  const message = truncateText(item.message || "");
  if (!id || !at || !message) return null;
  return {
    id,
    at,
    kind: ["info", "success", "warning", "error"].includes(item.kind) ? item.kind : "info",
    message,
    detail: truncateText(item.detail || "")
  };
}

function truncateText(value, limit = 240) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 3).trimEnd()}...` : text;
}
