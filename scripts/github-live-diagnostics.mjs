import { fileURLToPath } from "node:url";
import { diagnoseMemoryRepo } from "../src/github.js";

const GITHUB_HOST_PREFIXES = [
  "https://github.com/",
  "http://github.com/",
  "git@github.com:"
];

export function parseRepoInput(input) {
  let value = String(input || "").trim();
  if (!value) return null;

  for (const prefix of GITHUB_HOST_PREFIXES) {
    if (value.startsWith(prefix)) {
      value = value.slice(prefix.length);
      break;
    }
  }
  value = value.replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "");

  const match = value.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

export function buildLiveDiagnosticsConfigFromEnv(env = process.env) {
  const token = env.CTX_LAB_GITHUB_TOKEN || env.GITHUB_TOKEN || "";
  const repoInput = env.CTX_LAB_GITHUB_REPO || env.CTX_LAB_MEMORY_REPO || "";
  const branch = env.CTX_LAB_GITHUB_BRANCH || env.CTX_LAB_MEMORY_BRANCH || "main";
  const repo = parseRepoInput(repoInput);
  const missing = [];

  if (!repoInput) {
    missing.push("CTX_LAB_GITHUB_REPO");
  } else if (!repo) {
    missing.push("gecerli owner/repo veya GitHub URL");
  }
  if (!token) missing.push("CTX_LAB_GITHUB_TOKEN");

  return {
    ok: missing.length === 0,
    missing,
    config: repo && token ? { owner: repo.owner, repo: repo.repo, branch, token } : null
  };
}

export function formatSkipMessage(missing) {
  return [
    "GitHub canli tani atlandi: gerekli ortam degiskenleri eksik.",
    `Eksik: ${missing.join(", ")}`,
    "Canli kontrol icin ornek:",
    "  $env:CTX_LAB_GITHUB_REPO='owner/work-memory'",
    "  $env:CTX_LAB_GITHUB_BRANCH='main'",
    "  $env:CTX_LAB_GITHUB_TOKEN='<fine-grained token>'",
    "  npm run github:diagnose",
    "Token degeri ekrana yazdirilmaz. Token Contents read/write iznine sahip olmalidir."
  ].join("\n");
}

export function flattenDiagnosticsChecks(result) {
  return [
    result.repo,
    result.branch,
    result.configFile,
    ...(result.directories || []),
    result.writeAccess
  ].filter(Boolean);
}

export function formatDiagnosticsResult(result, config) {
  const lines = [
    `GitHub canli tani sonucu: ${result.ok ? "BASARILI" : "BASARISIZ"}`,
    `Hedef: ${config.owner}/${config.repo}#${config.branch || "main"}`
  ];

  for (const check of flattenDiagnosticsChecks(result)) {
    const state = check.ok ? "OK" : "HATA";
    const detail = check.ok ? summarizeDetail(check.detail) : check.message;
    lines.push(`- ${state} ${check.label}${detail ? `: ${detail}` : ""}`);
  }

  return lines.join("\n");
}

export async function runLiveDiagnostics(env = process.env, output = console) {
  const prepared = buildLiveDiagnosticsConfigFromEnv(env);
  if (!prepared.ok) {
    output.log(formatSkipMessage(prepared.missing));
    return 0;
  }

  const { config } = prepared;
  output.log(`GitHub canli tani calisiyor: ${config.owner}/${config.repo}#${config.branch}`);
  const result = await diagnoseMemoryRepo(config);
  output.log(formatDiagnosticsResult(result, config));
  return result.ok ? 0 : 1;
}

function summarizeDetail(detail) {
  if (!detail || typeof detail !== "object") return "";
  if (detail.path) return detail.path;
  if (detail.name) return detail.name;
  if (detail.sha) return `sha ${String(detail.sha).slice(0, 12)}`;
  if (Number.isFinite(detail.files)) return `${detail.files} oge`;
  const parts = [];
  if (typeof detail.private === "boolean") parts.push(detail.private ? "private" : "public");
  if (detail.defaultBranch) parts.push(`varsayilan dal ${detail.defaultBranch}`);
  if (typeof detail.writeHint === "boolean") parts.push(detail.writeHint ? "write hint var" : "write hint yok");
  return parts.join(", ");
}

function isDirectRun() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isDirectRun()) {
  runLiveDiagnostics().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(`GitHub canli tani hata verdi: ${error.message}`);
    process.exitCode = 1;
  });
}
