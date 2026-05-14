export const DEFAULT_RUNNER_URL = "http://127.0.0.1:5174";

export async function fetchRunnerHealth(options = {}) {
  const desktop = desktopApi(options);
  if (desktop) return desktop.runnerHealth();
  return runnerRequest("/health", {}, options);
}

export async function fetchRunnerProjects(options = {}) {
  const desktop = desktopApi(options);
  if (desktop) return desktop.runnerProjects();
  return runnerRequest("/projects", {}, options);
}

export async function registerRunnerProject(project, options = {}) {
  const desktop = desktopApi(options);
  if (desktop) return desktop.registerProject(project);
  return runnerRequest("/projects", {
    method: "POST",
    body: JSON.stringify(project)
  }, options);
}

export async function selectRunnerProjectDirectory(options = {}) {
  const desktop = desktopApi(options);
  if (!desktop) throw new Error("Klasor secimi masaustu uygulamasinda kullanilabilir.");
  return desktop.selectProjectDirectory();
}

export async function fetchRunnerRuns(options = {}) {
  const desktop = desktopApi(options);
  if (desktop) return desktop.runnerRuns({ limit: options.limit || 20 });
  return runnerRequest(`/runs?limit=${encodeURIComponent(options.limit || 20)}`, {}, options);
}

export async function fetchRunnerRunEvents(runId, options = {}) {
  const desktop = desktopApi(options);
  const input = { runId, limit: options.limit || 20 };
  if (desktop) return desktop.runnerRunEvents(input);
  const params = new URLSearchParams({
    runId: String(runId || ""),
    limit: String(options.limit || 20)
  });
  return runnerRequest(`/runs/events?${params.toString()}`, {}, options);
}

export async function startRunnerCodexRun(run, options = {}) {
  const desktop = desktopApi(options);
  if (desktop) return desktop.startCodexRun(run);
  return runnerRequest("/runs/codex", {
    method: "POST",
    body: JSON.stringify(run)
  }, options);
}

export async function applyRunnerRunCommit(input, options = {}) {
  const desktop = desktopApi(options);
  if (desktop) return desktop.applyRunCommit(input);
  return runnerRequest("/runs/commit", {
    method: "POST",
    body: JSON.stringify(input)
  }, options);
}

export async function fetchMemoryMirrorStatus(config, options = {}) {
  const desktop = desktopApi(options);
  if (desktop) return desktop.memoryStatus(config);
  return runnerRequest(`/memory/status?${memoryParams(config)}`, {}, options);
}

export async function fetchMemoryMirrorIndex(config, options = {}) {
  const desktop = desktopApi(options);
  if (desktop) return desktop.memoryIndex(config);
  return runnerRequest(`/memory/index?${memoryParams(config)}`, {}, options);
}

export async function syncMemoryMirror(config, options = {}) {
  const desktop = desktopApi(options);
  if (desktop) return desktop.syncMemory(config);
  return runnerRequest("/memory/sync", {
    method: "POST",
    body: JSON.stringify(config)
  }, options);
}

async function runnerRequest(path, requestOptions = {}, options = {}) {
  const fetchImpl = options.fetch || fetch;
  const baseUrl = options.baseUrl || DEFAULT_RUNNER_URL;
  const runnerToken = options.runnerToken || defaultRunnerToken();
  const response = await fetchImpl(`${baseUrl}${path}`, {
    ...requestOptions,
    headers: {
      "Content-Type": "application/json",
      ...(runnerToken ? { "x-ctxlab-runner-token": runnerToken } : {}),
      ...(requestOptions.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Yerel çalıştırıcı HTTP ${response.status}`);
  }
  return payload;
}

function defaultRunnerToken() {
  return import.meta.env?.VITE_CTX_LAB_RUNNER_TOKEN || "";
}

function memoryParams(config = {}) {
  const params = new URLSearchParams();
  for (const key of ["owner", "repo", "branch", "repoInput", "repoUrl", "remoteUrl"]) {
    if (config[key]) params.set(key, config[key]);
  }
  return params.toString();
}

function desktopApi(options = {}) {
  if (options.forceHttp) return null;
  if (options.desktopApi) return options.desktopApi;
  return globalThis.window?.ctxLabDesktop || null;
}
