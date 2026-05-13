import { parseMemoryFile } from "./domain.js";

const API_ROOT = "https://api.github.com";
const MEMORY_DIRS = ["inbox", "work_items", "decisions", "handoffs", "archive"];

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
    throw new Error(`GitHub ${response.status}: ${body.slice(0, 300)}`);
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

export async function putFile(config, path, content, message, sha = undefined) {
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
  return githubRequest(config, `/repos/${config.owner}/${config.repo}/contents/${path}`, {
    method: "DELETE",
    body: JSON.stringify({
      message,
      sha,
      branch: config.branch || undefined
    })
  });
}

export async function moveFile(config, fromRecord, toPath, message) {
  await putFile(config, toPath, fromRecord.raw, message);
  await deleteFile(config, fromRecord.path, fromRecord.sha, message);
}
