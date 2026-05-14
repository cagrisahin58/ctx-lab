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

export async function startRunnerCodexRun(run, options = {}) {
  const desktop = desktopApi(options);
  if (desktop) return desktop.startCodexRun(run);
  return runnerRequest("/runs/codex", {
    method: "POST",
    body: JSON.stringify(run)
  }, options);
}

async function runnerRequest(path, requestOptions = {}, options = {}) {
  const fetchImpl = options.fetch || fetch;
  const baseUrl = options.baseUrl || DEFAULT_RUNNER_URL;
  const response = await fetchImpl(`${baseUrl}${path}`, {
    ...requestOptions,
    headers: {
      "Content-Type": "application/json",
      ...(requestOptions.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Yerel runner HTTP ${response.status}`);
  }
  return payload;
}

function desktopApi(options = {}) {
  if (options.forceHttp) return null;
  if (options.desktopApi) return options.desktopApi;
  return globalThis.window?.ctxLabDesktop || null;
}
