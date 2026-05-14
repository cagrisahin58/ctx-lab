import { createServer } from "node:http";
import { access, appendFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, posix, relative, resolve, sep, win32 } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { parseMemoryFile, validateMemoryRecords } from "../src/domain.js";

export const DEFAULT_RUNNER_PORT = 5174;
export const RUNNER_VERSION = "0.1.0";
export const MEMORY_DIRS = Object.freeze(["inbox", "work_items", "decisions", "handoffs", "archive"]);
export const AUTOMATION_LEVELS = Object.freeze([
  "brief",
  "suggest",
  "edit_no_commit",
  "test",
  "commit_prepare",
  "commit_push"
]);
export const PROMPT_TEMPLATES = Object.freeze([
  "continue_work",
  "review",
  "test_fix",
  "release_check"
]);

export function resolveAppDataDir(env = process.env, platform = process.platform) {
  if (env.CTX_LAB_HOME) return platform === "win32" ? win32.resolve(env.CTX_LAB_HOME) : posix.resolve(env.CTX_LAB_HOME);
  if (platform === "win32" && env.APPDATA) return win32.join(env.APPDATA, "ctx-lab");
  return posix.join(env.HOME || homedir(), ".ctx-lab");
}

export function buildRunnerPaths(appDataDir = resolveAppDataDir()) {
  return {
    appDataDir,
    memoryGitDir: join(appDataDir, "memory", "git"),
    memoryIndexDir: join(appDataDir, "memory", "index"),
    runsDir: join(appDataDir, "runs"),
    projectsFile: join(appDataDir, "projects.json")
  };
}

export async function ensureRunnerHome(paths = buildRunnerPaths()) {
  await mkdir(paths.memoryGitDir, { recursive: true });
  await mkdir(paths.memoryIndexDir, { recursive: true });
  await mkdir(paths.runsDir, { recursive: true });

  try {
    await access(paths.projectsFile, constants.F_OK);
  } catch {
    await writeFile(paths.projectsFile, JSON.stringify({ version: 1, projects: [] }, null, 2), "utf8");
  }

  return paths;
}

export async function readProjectRegistry(paths = buildRunnerPaths()) {
  try {
    const raw = await readFile(paths.projectsFile, "utf8");
    const parsed = JSON.parse(raw);
    return {
      version: parsed.version || 1,
      projects: Array.isArray(parsed.projects) ? parsed.projects : []
    };
  } catch {
    return { version: 1, projects: [] };
  }
}

export async function saveProjectRegistry(paths = buildRunnerPaths(), registry = { version: 1, projects: [] }) {
  const normalized = {
    version: registry.version || 1,
    projects: Array.isArray(registry.projects) ? registry.projects : []
  };
  await ensureRunnerHome(paths);
  await writeFile(paths.projectsFile, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

export function normalizeProjectDraft(input = {}) {
  const projectPath = String(input.path || input.rootPath || "").trim();
  if (!projectPath) throw new Error("Proje klasoru zorunlu.");

  const resolvedPath = resolve(projectPath);
  const name = String(input.name || "").trim() || basename(resolvedPath) || "proje";
  const repo = String(input.repo || "").trim();
  const branch = String(input.branch || "main").trim() || "main";

  return {
    id: `project_${createHash("sha1").update(resolvedPath.toLowerCase()).digest("hex").slice(0, 12)}`,
    name,
    path: resolvedPath,
    repo,
    branch
  };
}

export async function registerProject(paths = buildRunnerPaths(), input = {}, options = {}) {
  await ensureRunnerHome(paths);
  const draft = normalizeProjectDraft(input);
  const details = await stat(draft.path).catch(() => {
    throw new Error("Proje klasoru bulunamadi.");
  });
  if (!details.isDirectory()) throw new Error("Proje yolu bir klasor olmali.");
  await access(draft.path, constants.R_OK | constants.W_OK).catch(() => {
    throw new Error("Proje klasoru okunabilir ve yazilabilir olmali.");
  });

  const registry = await readProjectRegistry(paths);
  const now = (options.now || new Date()).toISOString();
  const existing = registry.projects.find((project) => project.id === draft.id);
  const project = {
    ...existing,
    ...draft,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  const projects = existing
    ? registry.projects.map((item) => item.id === project.id ? project : item)
    : [...registry.projects, project];
  await saveProjectRegistry(paths, { version: registry.version, projects });
  return project;
}

export function codexCandidates(env = process.env, platform = process.platform) {
  const configured = env.CTX_LAB_CODEX_PATH ? [env.CTX_LAB_CODEX_PATH] : [];
  if (platform === "win32") return [...configured, "codex.cmd", "codex.exe", "codex"];
  return [...configured, "codex"];
}

export async function detectCodex(options = {}) {
  const candidates = options.candidates || codexCandidates(options.env, options.platform);
  const run = options.runCommand || runCommand;
  const timeoutMs = options.timeoutMs || 3000;

  for (const candidate of candidates) {
    const result = await run(candidate, ["--version"], { timeoutMs });
    if (result.ok) {
      return {
        available: true,
        command: candidate,
        version: result.stdout.trim() || "version okunamadı"
      };
    }
  }

  return {
    available: false,
    command: "",
    version: "",
    error: "codex.cmd bulunamadı veya çalıştırılamadı"
  };
}

export async function buildHealthPayload(paths = buildRunnerPaths(), options = {}) {
  await ensureRunnerHome(paths);
  const registry = await readProjectRegistry(paths);
  const codex = await detectCodex(options);

  return {
    ok: true,
    service: "ctx-lab-runner",
    version: RUNNER_VERSION,
    appDataDir: paths.appDataDir,
    memoryGitDir: paths.memoryGitDir,
    memoryIndexDir: paths.memoryIndexDir,
    runsDir: paths.runsDir,
    projectsFile: paths.projectsFile,
    projectCount: registry.projects.length,
    codex
  };
}

export function normalizeMemoryMirrorConfig(input = {}) {
  const repoInput = String(input.repoInput || input.repoUrl || "").trim();
  let owner = String(input.owner || "").trim();
  let repo = String(input.repo || "").trim();

  if ((!owner || !repo) && repoInput) {
    const cleaned = repoInput
      .replace(/^https:\/\/github\.com\//, "")
      .replace(/^git@github\.com:/, "")
      .replace(/\.git$/, "")
      .replace(/^\/+|\/+$/g, "");
    const [parsedOwner, parsedRepo] = cleaned.split("/");
    owner ||= parsedOwner || "";
    repo ||= parsedRepo || "";
  }

  if (!owner || !repo) throw new Error("Memory mirror icin owner/repo zorunlu.");

  const branch = String(input.branch || "main").trim() || "main";
  const remoteUrl = input.remoteUrl
    ? sanitizeGitHubRemoteUrl(input.remoteUrl)
    : `https://github.com/${owner}/${repo}.git`;

  return { owner, repo, branch, remoteUrl };
}

export function buildMemoryMirrorPaths(paths = buildRunnerPaths(), input = {}) {
  const config = normalizeMemoryMirrorConfig(input);
  const scope = `${slugForId(config.owner)}__${slugForId(config.repo)}__${slugForId(config.branch)}`;
  return {
    config,
    scope,
    cloneDir: join(paths.memoryGitDir, scope),
    indexFile: join(paths.memoryIndexDir, `${scope}.json`)
  };
}

export async function getMemoryMirrorStatus(paths = buildRunnerPaths(), input = {}) {
  await ensureRunnerHome(paths);
  const mirror = buildMemoryMirrorPaths(paths, input);
  const cloneExists = await pathExists(join(mirror.cloneDir, ".git"));
  const index = await readMemoryIndex(paths, input).catch(() => null);

  return {
    configured: true,
    owner: mirror.config.owner,
    repo: mirror.config.repo,
    branch: mirror.config.branch,
    remoteUrl: mirror.config.remoteUrl,
    cloneDir: mirror.cloneDir,
    indexFile: mirror.indexFile,
    cloneExists,
    indexed: Boolean(index),
    recordCount: index?.recordCount || 0,
    warningCount: index?.warningCount || 0,
    lastIndexedAt: index?.indexedAt || "",
    lastCommit: index?.lastCommit || ""
  };
}

export async function syncMemoryMirror(paths = buildRunnerPaths(), input = {}, options = {}) {
  await ensureRunnerHome(paths);
  const mirror = buildMemoryMirrorPaths(paths, input);
  const run = options.runCommand || runCommand;
  const cloneExists = await pathExists(join(mirror.cloneDir, ".git"));

  if (!cloneExists) {
    await mkdir(dirname(mirror.cloneDir), { recursive: true });
    const cloned = await run("git", [
      "clone",
      "--branch",
      mirror.config.branch,
      "--single-branch",
      mirror.config.remoteUrl,
      mirror.cloneDir
    ]);
    if (!cloned.ok) throw new Error(`Memory mirror clone basarisiz: ${cloned.stderr || cloned.stdout || "git hata verdi"}`);
  } else {
    for (const args of [
      ["-C", mirror.cloneDir, "fetch", "--prune", "origin", mirror.config.branch],
      ["-C", mirror.cloneDir, "checkout", mirror.config.branch],
      ["-C", mirror.cloneDir, "pull", "--ff-only", "origin", mirror.config.branch]
    ]) {
      const result = await run("git", args);
      if (!result.ok) throw new Error(`Memory mirror git islemi basarisiz: ${result.stderr || result.stdout || args.join(" ")}`);
    }
  }

  return indexMemoryMirror(paths, input, options);
}

export async function readMemoryIndex(paths = buildRunnerPaths(), input = {}) {
  const mirror = buildMemoryMirrorPaths(paths, input);
  const raw = await readFile(mirror.indexFile, "utf8");
  return JSON.parse(raw);
}

export async function indexMemoryMirror(paths = buildRunnerPaths(), input = {}, options = {}) {
  await ensureRunnerHome(paths);
  const mirror = buildMemoryMirrorPaths(paths, input);
  const root = await findMemoryRoot(mirror.cloneDir);
  const files = await collectMemoryMarkdownFiles(root);
  const records = [];

  for (const filePath of files) {
    const content = await readFile(filePath, "utf8");
    const relativePath = relative(root, filePath).split(sep).join("/");
    const sha = createHash("sha1").update(content).digest("hex");
    records.push(parseMemoryFile(relativePath, content, sha));
  }

  const commit = await readGitCommit(mirror.cloneDir, options);
  const warnings = validateMemoryRecords(records);
  const index = {
    schemaVersion: 1,
    owner: mirror.config.owner,
    repo: mirror.config.repo,
    branch: mirror.config.branch,
    cloneDir: mirror.cloneDir,
    memoryRoot: root,
    indexedAt: (options.now || new Date()).toISOString(),
    lastCommit: commit,
    recordCount: records.length,
    warningCount: warnings.length,
    counts: countRecords(records),
    warnings,
    records: records.map(summarizeRecordForIndex)
  };

  await mkdir(dirname(mirror.indexFile), { recursive: true });
  await writeFile(mirror.indexFile, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return index;
}

export async function listCodexRuns(paths = buildRunnerPaths(), limit = 20) {
  await ensureRunnerHome(paths);
  const names = await readdir(paths.runsDir).catch(() => []);
  const runFiles = names
    .filter((name) => name.endsWith(".json"))
    .sort()
    .reverse()
    .slice(0, Number(limit) || 20);

  const runs = [];
  for (const name of runFiles) {
    try {
      const run = JSON.parse(await readFile(join(paths.runsDir, name), "utf8"));
      runs.push(await attachRunEventPreview(paths, run));
    } catch {
      runs.push({
        id: name.replace(/\.json$/, ""),
        status: "corrupt",
        error: "Çalıştırma günlüğü okunamadı."
      });
    }
  }
  return runs;
}

export async function listCodexRunEvents(paths = buildRunnerPaths(), input = {}) {
  await ensureRunnerHome(paths);
  const runId = normalizeRunId(typeof input === "string" ? input : input.runId || input.id);
  const limit = Math.min(Math.max(Number(input.limit) || 8, 1), 50);
  const eventLogPath = join(paths.runsDir, `${runId}.events.jsonl`);
  const text = await readFile(eventLogPath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return "";
    throw error;
  });
  if (!text.trim()) {
    return { runId, eventLogPath, status: "missing", events: [] };
  }
  const lines = text.trim().split(/\r?\n/).filter(Boolean).slice(-limit);
  return {
    runId,
    eventLogPath,
    status: "ok",
    events: lines.map(parseRunEventLine)
  };
}

export async function startCodexRun(paths = buildRunnerPaths(), input = {}, options = {}) {
  await ensureRunnerHome(paths);
  const registry = await readProjectRegistry(paths);
  const project = resolveAllowedProject(registry, input);
  const automationLevel = normalizeAutomationLevel(input.automationLevel);
  const template = normalizePromptTemplate(input.template);
  assertSafeAutomationPrompt(String(input.prompt || ""));
  const prompt = buildCodexRunPrompt(project, input, automationLevel, template);

  const now = options.now || new Date();
  const id = input.id || `run_${timestampSlug(now)}_${slugForId(project.name)}`;
  const logPath = join(paths.runsDir, `${id}.json`);
  const eventLogPath = join(paths.runsDir, `${id}.events.jsonl`);
  const dryRun = input.dryRun !== false || automationLevel === "brief";
  const baseRecord = {
    id,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    status: dryRun ? "dry_run" : "running",
    dryRun,
    automationLevel,
    template,
    project: {
      id: project.id,
      name: project.name,
      path: project.path,
      repo: project.repo,
      branch: project.branch
    },
    sourceRecordId: String(input.sourceRecordId || ""),
    sourceRecordPath: String(input.sourceRecordPath || ""),
    sourceWorkItemId: String(input.sourceWorkItemId || ""),
    requestedTask: String(input.prompt || "").trim(),
    prompt,
    logPath,
    eventLogPath
  };

  if (dryRun) {
    const record = {
      ...baseRecord,
      status: "dry_run",
      summary: "Codex çalıştırılmadı; prompt ve proje kapsamı kaydedildi.",
      testResult: "not_run",
      commitGate: commitGateForAutomationLevel(automationLevel)
    };
    attachCommitReview(record);
    await writeRunLog(logPath, record);
    return record;
  }

  if (automationLevel === "commit_push" && input.confirmCommitPush !== true) {
    const record = {
      ...baseRecord,
      status: "blocked",
      summary: "Commit/push seviyesi gerçek çalışma için ayrı kullanıcı onayı gerektirir.",
      error: "Commit/push onayı verilmedi.",
      testResult: "not_run",
      commitGate: commitGateForAutomationLevel(automationLevel)
    };
    attachCommitReview(record);
    await writeRunLog(logPath, record);
    return record;
  }

  const gitBefore = await readGitSnapshot(project.path, options.gitCommand);
  const codex = await detectCodex(options);
  if (!codex.available) {
    const record = {
      ...baseRecord,
      status: "failed",
      codex,
      gitBefore,
      error: codex.error || "Codex CLI bulunamadi."
    };
    attachCommitReview(record);
    await writeRunLog(logPath, record);
    return record;
  }

  await writeRunLog(logPath, { ...baseRecord, codex, gitBefore });
  const sandbox = sandboxForAutomationLevel(automationLevel);
  await appendRunEvent(eventLogPath, {
    event: "start",
    at: new Date().toISOString(),
    runId: id,
    command: codex.command,
    sandbox
  });
  const run = options.runCommand || runCommand;
  const result = await run(codex.command, [
    "exec",
    "--json",
    "--cd",
    project.path,
    "--sandbox",
    sandbox,
    "-"
  ], {
    cwd: project.path,
    input: prompt,
    onStdout: (chunk) => appendRunEvent(eventLogPath, {
      event: "stdout",
      at: new Date().toISOString(),
      runId: id,
      text: chunk
    }),
    onStderr: (chunk) => appendRunEvent(eventLogPath, {
      event: "stderr",
      at: new Date().toISOString(),
      runId: id,
      text: chunk
    })
  });

  const finishedAt = (options.finishedAt || new Date()).toISOString();
  const gitAfter = await readGitSnapshot(project.path, options.gitCommand);
  const record = {
    ...baseRecord,
    updatedAt: finishedAt,
    finishedAt,
    status: result.ok ? "succeeded" : "failed",
    codex,
    sandbox,
    summary: buildCodexResultSummary(result),
    testResult: detectTestResult(result.stdout, result.stderr),
    commitGate: commitGateForAutomationLevel(automationLevel),
    gitBefore,
    gitAfter,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    exitCode: result.code ?? (result.ok ? 0 : 1)
  };
  attachCommitReview(record);
  await appendRunEvent(eventLogPath, {
    event: "finish",
    at: finishedAt,
    runId: id,
    status: record.status,
    exitCode: record.exitCode,
    testResult: record.testResult
  });
  await writeRunLog(logPath, record);
  return attachRunEventPreview(paths, record);
}

export function createRunnerServer(options = {}) {
  const paths = options.paths || buildRunnerPaths(options.appDataDir);
  const host = options.host || "127.0.0.1";

  return createServer(async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", options.allowOrigin || "http://127.0.0.1:5173");
    response.setHeader("Access-Control-Allow-Headers", "content-type, x-ctxlab-runner-token");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    try {
      const url = new URL(request.url || "/", `http://${host}`);
      if (request.method === "GET" && url.pathname === "/") {
        return sendJson(response, 200, {
          ...(await buildHealthPayload(paths, options)),
          endpoints: ["/health", "/projects", "/runs", "/runs/events", "/runs/codex", "/memory/status", "/memory/index", "/memory/sync"]
        });
      }
      if (request.method === "GET" && url.pathname === "/health") {
        return sendJson(response, 200, await buildHealthPayload(paths, options));
      }
      if (request.method === "GET" && url.pathname === "/projects") {
        await ensureRunnerHome(paths);
        return sendJson(response, 200, await readProjectRegistry(paths));
      }
      if (request.method === "POST" && url.pathname === "/projects") {
        const body = await readJsonBody(request);
        const project = await registerProject(paths, body, options);
        return sendJson(response, 201, { ok: true, project, registry: await readProjectRegistry(paths) });
      }
      if (request.method === "GET" && url.pathname === "/runs") {
        return sendJson(response, 200, { runs: await listCodexRuns(paths, url.searchParams.get("limit")) });
      }
      if (request.method === "GET" && url.pathname === "/runs/events") {
        return sendJson(response, 200, await listCodexRunEvents(paths, Object.fromEntries(url.searchParams)));
      }
      if (request.method === "POST" && url.pathname === "/runs/codex") {
        const body = await readJsonBody(request);
        return sendJson(response, 201, await startCodexRun(paths, body, options));
      }
      if (request.method === "GET" && url.pathname === "/memory/status") {
        return sendJson(response, 200, await getMemoryMirrorStatus(paths, Object.fromEntries(url.searchParams)));
      }
      if (request.method === "GET" && url.pathname === "/memory/index") {
        return sendJson(response, 200, await readMemoryIndex(paths, Object.fromEntries(url.searchParams)));
      }
      if (request.method === "POST" && url.pathname === "/memory/sync") {
        const body = await readJsonBody(request);
        return sendJson(response, 201, await syncMemoryMirror(paths, body, options));
      }
      return sendJson(response, 404, { ok: false, error: "Endpoint bulunamadı" });
    } catch (error) {
      return sendJson(response, 500, { ok: false, error: error.message });
    }
  });
}

function resolveAllowedProject(registry, input) {
  const projects = Array.isArray(registry.projects) ? registry.projects : [];
  const requestedPath = String(input.path || input.projectPath || "").trim();
  const requestedId = String(input.projectId || "").trim();
  const pathMatch = requestedPath ? resolve(requestedPath).toLowerCase() : "";
  const project = projects.find((item) => {
    if (requestedId && item.id === requestedId) return true;
    if (!pathMatch) return false;
    return resolve(item.path).toLowerCase() === pathMatch;
  });

  if (!project) {
    throw new Error("Codex yalnizca kayitli proje koklerinde calistirilabilir.");
  }
  return project;
}

function sanitizeGitHubRemoteUrl(value) {
  const text = String(value || "").trim();
  if (/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(text)) {
    return text.endsWith(".git") ? text : `${text}.git`;
  }
  if (/^git@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(text)) {
    return text.endsWith(".git") ? text : `${text}.git`;
  }
  throw new Error("Memory mirror remote URL yalnizca github.com repo adresi olabilir.");
}

async function findMemoryRoot(cloneDir) {
  const candidates = [cloneDir, join(cloneDir, "work-memory")];
  for (const candidate of candidates) {
    const checks = await Promise.all(MEMORY_DIRS.map((dir) => pathExists(join(candidate, dir))));
    if (checks.some(Boolean)) return candidate;
  }
  throw new Error("Memory mirror icinde beklenen memory klasorleri bulunamadi.");
}

async function collectMemoryMarkdownFiles(root) {
  const files = [];
  for (const dir of MEMORY_DIRS) {
    const dirPath = join(root, dir);
    if (!(await pathExists(dirPath))) continue;
    for (const file of await walkMarkdownFiles(dirPath)) {
      files.push(file);
    }
  }
  return files.sort();
}

async function walkMarkdownFiles(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

async function readGitCommit(cloneDir, options = {}) {
  const run = options.runCommand || runCommand;
  const result = await run("git", ["-C", cloneDir, "rev-parse", "HEAD"]);
  return result.ok ? result.stdout.trim() : "";
}

function countRecords(records) {
  return records.reduce((counts, record) => {
    counts[record.type] = (counts[record.type] || 0) + 1;
    return counts;
  }, {});
}

function summarizeRecordForIndex(record) {
  return {
    id: record.id,
    type: record.type,
    path: record.path,
    status: record.status,
    project: record.project,
    repo: record.repo,
    branch: record.branch,
    title: record.title,
    summary: record.summary,
    nextAction: record.nextAction,
    createdAt: record.createdAt,
    updatedAt: record.frontmatter?.updated_at || "",
    sha: record.sha
  };
}

async function pathExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function normalizeAutomationLevel(value) {
  const normalized = String(value || "brief").trim();
  if (AUTOMATION_LEVELS.includes(normalized)) return normalized;
  throw new Error(`Gecersiz otomasyon seviyesi: ${normalized}`);
}

function normalizePromptTemplate(value) {
  const normalized = String(value || "continue_work").trim();
  if (PROMPT_TEMPLATES.includes(normalized)) return normalized;
  throw new Error(`Gecersiz prompt sablonu: ${normalized}`);
}

function buildCodexRunPrompt(project, input, automationLevel, template) {
  const userPrompt = String(input.prompt || "").trim();
  if (!userPrompt) throw new Error("Codex promptu zorunlu.");

  const templateText = {
    continue_work: "Secili is hattini veya oturumu devam ettir.",
    review: "Degisiklikleri correctness, test ve guvenlik riskleri acisindan incele.",
    test_fix: "Testleri calistir, hatayi kok nedenine inerek duzelt ve sonucu raporla.",
    release_check: "Build, smoke ve dogrulama kapilarini kontrol ederek yayina hazirlik raporu uret."
  }[template];

  const levelText = {
    brief: "Sadece brif hazirla; dosya degistirme.",
    suggest: "Oneri uret; dosya degistirme.",
    edit_no_commit: "Gerekli dosya degisikliklerini yap; commit atma.",
    test: "Gerekli testleri calistir; commit atma.",
    commit_prepare: "Degisiklik ozetini ve commit taslagini hazirla; kullanici onayi olmadan commit atma.",
    commit_push: "Test sonucu ve commit ozetini gorunur yap; destructive git islemleri yapma."
  }[automationLevel];

  return [
    "ctx-lab masaustu otomasyon kosusu.",
    `Proje: ${project.name}`,
    `Repo: ${project.repo || "belirtilmedi"}`,
    `Dal: ${project.branch || "main"}`,
    `Proje koku: ${project.path}`,
    `Prompt sablonu: ${templateText}`,
    `Otomasyon seviyesi: ${levelText}`,
    "Yasak islemler: git reset --hard, git clean -fd, git checkout --, git restore, git branch -D, git push --force/--delete, credential dosyasi okuma.",
    "Tum gorunur kullanici metinleri Turkce tutulacak.",
    "",
    userPrompt
  ].join("\n");
}

function assertSafeAutomationPrompt(prompt) {
  const forbidden = [
    /\bgit\s+reset\s+--hard\b/i,
    /\bgit\s+clean\s+-[^\s]*f[^\s]*/i,
    /\bgit\s+checkout\s+--\s+/i,
    /\bgit\s+restore\b/i,
    /\bgit\s+branch\s+-D\b/i,
    /\bgit\s+branch\s+--delete\s+--force\b/i,
    /\bgit\s+push\s+--force(?:-with-lease)?\b/i,
    /\bgit\s+push\s+-[^\s]*f[^\s]*/i,
    /\bgit\s+push\b[^\n;&|]*(?:--delete|:\S|\+\S)/i
  ];
  if (forbidden.some((pattern) => pattern.test(prompt))) {
    throw new Error("Destructive git islemi iceren Codex promptu reddedildi.");
  }
}

function sandboxForAutomationLevel(level) {
  if (level === "suggest") return "read-only";
  return "workspace-write";
}

async function readGitSnapshot(projectPath, gitCommand = runCommand) {
  const inside = await gitCommand("git", ["-C", projectPath, "rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || inside.stdout.trim() !== "true") {
    return {
      available: false,
      error: inside.stderr || inside.stdout || "Git çalışma ağacı değil."
    };
  }
  const [branch, head, status] = await Promise.all([
    gitCommand("git", ["-C", projectPath, "rev-parse", "--abbrev-ref", "HEAD"]),
    gitCommand("git", ["-C", projectPath, "rev-parse", "HEAD"]),
    gitCommand("git", ["-C", projectPath, "status", "--short"])
  ]);
  const statusLines = status.ok
    ? status.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    : [];
  return {
    available: true,
    branch: branch.ok ? branch.stdout.trim() : "",
    head: head.ok ? head.stdout.trim() : "",
    dirty: statusLines.length > 0,
    changedCount: statusLines.length,
    changedFiles: statusLines.slice(0, 20)
  };
}

function buildCodexResultSummary(result = {}) {
  const testResult = detectTestResult(result.stdout, result.stderr);
  if (!result.ok) return "Codex komutu hata ile tamamlandı; stderr ve exit code kontrol edilmeli.";
  if (testResult === "passed") return "Codex komutu tamamlandı; test çıktısı başarılı görünüyor.";
  if (testResult === "failed") return "Codex komutu tamamlandı; test çıktısında hata sinyali var.";
  return "Codex komutu tamamlandı; test sonucu çıktıda net tespit edilemedi.";
}

function detectTestResult(stdout = "", stderr = "") {
  const text = `${stdout || ""}\n${stderr || ""}`;
  if (!text.trim()) return "not_detected";
  if (/\b(fail|failed|failing|error|errored|tests?\s+failed)\b/i.test(text)) return "failed";
  if (/\b(pass|passed|passing|tests?\s+passed|all tests passed|ok)\b/i.test(text)) return "passed";
  return "not_detected";
}

function commitGateForAutomationLevel(level) {
  if (level === "commit_prepare") {
    return "Commit taslağı kullanıcı onayı ve görünür test sonucu olmadan uygulanmaz.";
  }
  if (level === "commit_push") {
    return "Commit/push kullanıcı onayı, görünür özet ve test sonucu olmadan uygulanmaz.";
  }
  return "";
}

function attachCommitReview(record) {
  record.commitReadiness = buildCommitReadiness(record);
  record.commitDraft = buildCommitDraft(record);
  return record;
}

function buildCommitReadiness(record = {}) {
  if (!["commit_prepare", "commit_push"].includes(record.automationLevel)) return null;
  const changedFiles = Array.isArray(record.gitAfter?.changedFiles) ? record.gitAfter.changedFiles : [];
  const checks = [
    {
      id: "run",
      label: "Codex sonucu",
      ok: record.status === "succeeded",
      detail: record.status === "succeeded" ? "Codex komutu tamamlandı." : "Codex komutu başarılı tamamlanmadı."
    },
    {
      id: "summary",
      label: "Görünür özet",
      ok: Boolean(record.summary || record.error),
      detail: record.summary || record.error || "Çalıştırma özeti yok."
    },
    {
      id: "test",
      label: "Test sinyali",
      ok: record.testResult === "passed",
      detail: commitReadinessTestDetail(record.testResult)
    },
    {
      id: "changes",
      label: "Dosya değişikliği",
      ok: Boolean(record.gitAfter?.available && changedFiles.length),
      detail: record.gitAfter?.available
        ? (changedFiles.length ? `${changedFiles.length} dosya değişikliği görünüyor.` : "Git değişikliği yok.")
        : "Git sonucu okunamadı."
    }
  ];
  const ready = checks.every((check) => check.ok);
  return {
    ready,
    status: ready ? "ready_for_review" : "not_ready",
    summary: ready
      ? "Commit/push için kullanıcı incelemesine hazır."
      : "Commit/push için eksik kanıt var.",
    checks
  };
}

function buildCommitDraft(record = {}) {
  if (!["commit_prepare", "commit_push"].includes(record.automationLevel)) return null;
  const readiness = record.commitReadiness || buildCommitReadiness(record);
  const changedFiles = Array.isArray(record.gitAfter?.changedFiles) ? record.gitAfter.changedFiles : [];
  const ready = Boolean(readiness?.ready);
  const message = ready ? buildCommitDraftMessage(record) : "";
  const body = ready ? [
    `Run: ${record.id}`,
    `Otomasyon: ${record.automationLevel}`,
    `Test: ${commitReadinessTestDetail(record.testResult)}`,
    `Degisen dosya: ${changedFiles.length}`
  ] : [];
  return {
    ready,
    message,
    body,
    changedFiles,
    pushAllowed: record.automationLevel === "commit_push" && ready,
    note: ready
      ? "Commit taslağı kullanıcı incelemesine hazır; gerçek commit/push için son onay gerekir."
      : "Commit taslağı hazır değil; önce başarılı run, test sinyali ve Git değişikliği gerekir."
  };
}

function buildCommitDraftMessage(record = {}) {
  const project = String(record.project?.name || "project").trim() || "project";
  const task = firstMeaningfulLine(record.requestedTask);
  const base = task ? task : `Update ${project} with Codex changes`;
  return truncateCommitSubject(base);
}

function firstMeaningfulLine(value = "") {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, " "))
    .find(Boolean) || "";
}

function truncateCommitSubject(value = "") {
  const subject = String(value || "").replace(/[.!?]+$/g, "");
  if (subject.length <= 72) return subject;
  return `${subject.slice(0, 69).trimEnd()}...`;
}

function commitReadinessTestDetail(result) {
  if (result === "passed") return "Test çıktısı başarılı sinyal veriyor.";
  if (result === "failed") return "Test çıktısında hata sinyali var.";
  if (result === "not_run") return "Test çalıştırılmadı.";
  return "Test sonucu net tespit edilemedi.";
}

async function writeRunLog(logPath, record) {
  await writeFile(logPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

async function appendRunEvent(eventLogPath, event) {
  await appendFile(eventLogPath, `${JSON.stringify(event)}\n`, "utf8");
}

async function attachRunEventPreview(paths, run) {
  if (!run?.id || run.status === "corrupt") return run;
  try {
    const preview = await listCodexRunEvents(paths, { runId: run.id, limit: 6 });
    return {
      ...run,
      eventPreview: preview.events,
      eventPreviewStatus: preview.status
    };
  } catch (error) {
    return {
      ...run,
      eventPreview: [],
      eventPreviewStatus: "error",
      eventPreviewError: error.message || "Olay günlüğü okunamadı."
    };
  }
}

function normalizeRunId(value) {
  const runId = String(value || "").trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(runId)) {
    throw new Error("Geçersiz çalıştırma kimliği.");
  }
  return runId;
}

function parseRunEventLine(line) {
  try {
    const event = JSON.parse(line);
    return sanitizeRunEvent(event);
  } catch {
    return {
      event: "corrupt",
      at: "",
      text: "Olay satırı okunamadı."
    };
  }
}

function sanitizeRunEvent(event = {}) {
  const clean = {
    event: String(event.event || "event"),
    at: String(event.at || ""),
    runId: String(event.runId || "")
  };
  for (const key of ["command", "sandbox", "status", "testResult"]) {
    if (event[key] !== undefined && event[key] !== null) clean[key] = String(event[key]);
  }
  if (event.exitCode !== undefined && event.exitCode !== null) clean.exitCode = Number(event.exitCode);
  if (event.text !== undefined && event.text !== null) clean.text = compactRunEventText(event.text);
  return clean;
}

function compactRunEventText(value) {
  const text = String(value || "").replace(/\r?\n/g, "\n").trim();
  return text.length > 1200 ? `${text.slice(0, 1200)}\n...` : text;
}

function timestampSlug(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function slugForId(value) {
  return String(value || "proje")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/İ/g, "I")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "proje";
}

async function readJsonBody(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 1024 * 1024) throw new Error("Istek govdesi cok buyuk.");
  }
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Gecersiz JSON govdesi.");
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

function runCommand(command, args, options = {}) {
  return new Promise((resolveResult) => {
    let settled = false;
    let timeout;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolveResult(result);
    };
    const spawnOptions = {
      cwd: options.cwd,
      windowsHide: true
    };
    const child = process.platform === "win32"
      ? spawn("cmd.exe", ["/d", "/s", "/c", [command, ...args].map(quoteCmdArg).join(" ")], spawnOptions)
      : spawn(command, args, spawnOptions);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      options.onStdout?.(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      options.onStderr?.(text);
    });
    child.on("error", (error) => {
      finish({ ok: false, stdout, stderr: error.message });
    });
    if (options.input) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
    if (options.timeoutMs) {
      timeout = setTimeout(() => {
        child.kill();
        finish({
          ok: false,
          stdout,
          stderr: stderr || `Komut zaman asimina ugradi (${options.timeoutMs} ms).`,
          code: null,
          timedOut: true
        });
      }, options.timeoutMs);
    }
    child.on("close", (code) => {
      finish({ ok: code === 0, stdout, stderr, code });
    });
  });
}

function quoteCmdArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_.:/\\-]+$/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

function readCliArgs(argv) {
  const args = {
    port: DEFAULT_RUNNER_PORT,
    host: "127.0.0.1",
    dryRun: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--port") args.port = Number(argv[index + 1] || DEFAULT_RUNNER_PORT);
    if (item === "--host") args.host = argv[index + 1] || "127.0.0.1";
    if (item === "--dry-run") args.dryRun = true;
  }

  return args;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = readCliArgs(process.argv.slice(2));
  const paths = buildRunnerPaths();

  if (args.dryRun) {
    const payload = await buildHealthPayload(paths);
    console.log(JSON.stringify(payload, null, 2));
    process.exit(payload.codex.available ? 0 : 2);
  }

  const server = createRunnerServer({ paths, host: args.host });
  server.listen(args.port, args.host, () => {
    console.log(`ctx-lab çalıştırıcı hazır: http://${args.host}:${args.port}`);
  });
}
