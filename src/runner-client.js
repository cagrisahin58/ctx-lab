export const DEFAULT_RUNNER_URL = "http://127.0.0.1:5174";

export async function fetchRunnerHealth(options = {}) {
  return runnerRequest("/health", {}, options);
}

export async function fetchRunnerProjects(options = {}) {
  return runnerRequest("/projects", {}, options);
}

export async function registerRunnerProject(project, options = {}) {
  return runnerRequest("/projects", {
    method: "POST",
    body: JSON.stringify(project)
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
