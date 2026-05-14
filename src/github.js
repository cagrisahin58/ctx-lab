import { parseMemoryFile } from "./domain.js";

const API_ROOT = "https://api.github.com";
export const MEMORY_DIRS = ["inbox", "work_items", "decisions", "handoffs", "archive"];

class GitHubHttpError extends Error {
  constructor(status, body) {
    super(formatGitHubHttpError(status, body));
    this.name = "GitHubHttpError";
    this.status = status;
    this.body = body;
  }
}

function formatGitHubHttpError(status, body = "") {
  const detail = extractGitHubErrorDetail(body);
  if (status === 401) {
    return `GitHub 401: Token doğrulanamadı. Token süresi, kopyalanan değer veya Authorization izni hatalı olabilir.${detail}`;
  }
  if (status === 403) {
    return `GitHub 403: Erişim reddedildi. Fine-grained token için repo erişimi ve Contents read/write iznini kontrol et; oran limiti de bu hatayı verebilir.${detail}`;
  }
  if (status === 404) {
    return `GitHub 404: Repo, branch veya dosya bulunamadı. Repo private ise token bu repoya erişemiyor olabilir; owner/repo ve branch değerlerini kontrol et.${detail}`;
  }
  if (status === 409) {
    return `GitHub 409: Repo içeriği bu işlem sırasında değişti. ctx-lab son sha ile tekrar deneyecek; hata sürerse GitHub'dan yenile.${detail}`;
  }
  if (status === 422) {
    return `GitHub 422: GitHub isteği kabul etmedi. Dosya zaten var, sha eksik veya branch koruması devrede olabilir.${detail}`;
  }
  return `GitHub ${status}: GitHub API isteği başarısız oldu.${detail || ` Ayrıntı: ${String(body).slice(0, 240)}`}`;
}

function extractGitHubErrorDetail(body) {
  if (!body) return "";
  try {
    const parsed = JSON.parse(body);
    const message = parsed.message || parsed.error || "";
    if (message) return ` Ayrıntı: ${String(message).slice(0, 180)}`;
  } catch {
    // Plain-text GitHub/proxy responses are handled below.
  }
  const text = String(body).trim();
  return text ? ` Ayrıntı: ${text.slice(0, 180)}` : "";
}

async function githubRequest(config, path, options = {}) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...options.headers
  };
  if (config.token) headers.Authorization = `Bearer ${config.token}`;

  const response = await fetch(`${API_ROOT}${path}`, { ...options, headers });
  if (response.status === 404 && options.allow404) return null;
  if (!response.ok) {
    const body = await response.text();
    throw new GitHubHttpError(response.status, body);
  }
  if (response.status === 204) return null;
  return response.json();
}

function contentsPath(config, path) {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const ref = config.branch ? `?ref=${encodeURIComponent(config.branch)}` : "";
  return `/repos/${config.owner}/${config.repo}/contents/${encoded}${ref}`;
}

function decodeBase64(value) {
  const binary = atob(value.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function loadMemoryRepo(config) {
  const allFiles = [];
  for (const dir of MEMORY_DIRS) {
    const entries = await githubRequest(config, contentsPath(config, dir), { allow404: true });
    if (!Array.isArray(entries)) continue;
    allFiles.push(...entries.filter((entry) => entry.type === "file" && entry.name.endsWith(".md")));
  }

  const records = await Promise.all(
    allFiles.map(async (file) => {
      const payload = await githubRequest(config, contentsPath(config, file.path));
      const content = decodeBase64(payload.content || "");
      return parseMemoryFile(file.path, content, payload.sha);
    })
  );

  return records.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function getBranchHead(config) {
  const branchName = config.branch || "main";
  const payload = await githubRequest(
    config,
    `/repos/${config.owner}/${config.repo}/branches/${encodeURIComponent(branchName)}`
  );
  return payload?.commit?.sha || "";
}

export async function ensureMemoryRepo(config) {
  const created = [];
  await ensureFile(
    config,
    "config.yaml",
    [
      "schema_version: 1",
      "language: tr",
      "product: ctx-lab",
      "description: GitHub destekli AI çalışma hafızası",
      ""
    ].join("\n"),
    "chore: ctx-lab hafıza reposu config"
  ).then((result) => result && created.push("config.yaml"));

  for (const dir of MEMORY_DIRS) {
    await ensureFile(
      config,
      `${dir}/.gitkeep`,
      "",
      `chore: ctx-lab hafıza reposu ${dir} klasörünü hazırla`
    ).then((result) => result && created.push(`${dir}/.gitkeep`));
  }

  return created;
}

export async function diagnoseMemoryRepo(config) {
  const repo = await check("Repo erişimi", async () => {
    const payload = await githubRequest(config, `/repos/${config.owner}/${config.repo}`);
    return {
      private: Boolean(payload.private),
      defaultBranch: payload.default_branch || "",
      writeHint: payload.permissions ? Boolean(payload.permissions.push || payload.permissions.maintain || payload.permissions.admin) : null
    };
  });
  const branchName = config.branch || "main";
  const branch = await check(`Branch: ${branchName}`, async () => {
    const payload = await githubRequest(
      config,
      `/repos/${config.owner}/${config.repo}/branches/${encodeURIComponent(branchName)}`
    );
    return { name: payload.name || branchName };
  });
  const configFile = await check("config.yaml", async () => {
    const payload = await getContent(config, "config.yaml");
    if (!payload) throw new Error("config.yaml bulunamadı");
    return { sha: payload.sha || "" };
  });
  const directories = [];
  for (const dir of MEMORY_DIRS) {
    directories.push(await check(`${dir}/`, async () => {
      const payload = await githubRequest(config, contentsPath(config, dir), { allow404: true });
      if (!Array.isArray(payload)) throw new Error(`${dir}/ klasörü bulunamadı`);
      return { files: payload.length };
    }));
  }
  const writeAccess = await check("Yazma testi", async () => {
    const path = "archive/.ctxlab-write-test";
    const result = await putFile(
      config,
      path,
      `ctx-lab write test: ${new Date().toISOString()}\n`,
      "chore: ctx-lab write access check"
    );
    const sha = result?.content?.sha;
    if (!sha) throw new Error("Yazma testi dosya sha değeri döndürmedi");
    await deleteFile(config, path, sha, "chore: remove ctx-lab write access check");
    return { path };
  });

  return {
    ok: [repo, branch, configFile, ...directories, writeAccess].every((item) => item.ok),
    repo,
    branch,
    configFile,
    directories,
    writeAccess
  };
}

async function check(label, fn) {
  try {
    return { label, ok: true, detail: await fn() };
  } catch (error) {
    return { label, ok: false, message: error.message };
  }
}

async function getContent(config, path) {
  return githubRequest(config, contentsPath(config, path), { allow404: true });
}

async function ensureFile(config, path, content, message) {
  const existing = await getContent(config, path);
  if (existing) return null;
  return putFile(config, path, content, message);
}

export async function putFile(config, path, content, message, sha = undefined) {
  try {
    return await putFileOnce(config, path, content, message, sha);
  } catch (error) {
    if (!isRecoverableWriteError(error)) throw error;
    const latest = await getContent(config, path);
    if (!latest?.sha || latest.sha === sha) throw error;
    return putFileOnce(config, path, content, message, latest.sha);
  }
}

async function putFileOnce(config, path, content, message, sha = undefined) {
  const body = {
    message,
    content: encodeBase64(content),
    branch: config.branch || undefined,
    sha
  };
  return githubRequest(config, `/repos/${config.owner}/${config.repo}/contents/${path}`, {
    method: "PUT",
    body: JSON.stringify(body)
  });
}

export async function deleteFile(config, path, sha, message) {
  try {
    return await deleteFileOnce(config, path, sha, message);
  } catch (error) {
    if (error.status === 404) return null;
    if (!isRecoverableWriteError(error)) throw error;
    const latest = await getContent(config, path);
    if (!latest?.sha || latest.sha === sha) throw error;
    return deleteFileOnce(config, path, latest.sha, message);
  }
}

async function deleteFileOnce(config, path, sha, message) {
  return githubRequest(config, `/repos/${config.owner}/${config.repo}/contents/${path}`, {
    method: "DELETE",
    body: JSON.stringify({
      message,
      sha,
      branch: config.branch || undefined
    })
  });
}

function isRecoverableWriteError(error) {
  return error?.status === 409 || error?.status === 422;
}

export async function moveFile(config, fromRecord, toPath, message) {
  await putFile(config, toPath, fromRecord.raw, message);
  await deleteFile(config, fromRecord.path, fromRecord.sha, message);
}
