import { createServer } from "node:http";
import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { basename, join, posix, resolve, win32 } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

export const DEFAULT_RUNNER_PORT = 5174;
export const RUNNER_VERSION = "0.1.0";
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

  for (const candidate of candidates) {
    const result = await run(candidate, ["--version"]);
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
      runs.push(JSON.parse(await readFile(join(paths.runsDir, name), "utf8")));
    } catch {
      runs.push({
        id: name.replace(/\.json$/, ""),
        status: "corrupt",
        error: "Run logu okunamadi."
      });
    }
  }
  return runs;
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
    prompt,
    logPath
  };

  if (dryRun) {
    const record = {
      ...baseRecord,
      status: "dry_run",
      summary: "Codex calistirilmadi; prompt ve proje kapsami kaydedildi."
    };
    await writeRunLog(logPath, record);
    return record;
  }

  const codex = await detectCodex(options);
  if (!codex.available) {
    const record = {
      ...baseRecord,
      status: "failed",
      codex,
      error: codex.error || "Codex CLI bulunamadi."
    };
    await writeRunLog(logPath, record);
    return record;
  }

  await writeRunLog(logPath, { ...baseRecord, codex });
  const sandbox = sandboxForAutomationLevel(automationLevel);
  const run = options.runCommand || runCommand;
  const result = await run(codex.command, [
    "exec",
    "--json",
    "--cd",
    project.path,
    "--sandbox",
    sandbox,
    "-"
  ], { cwd: project.path, input: prompt });

  const finishedAt = (options.finishedAt || new Date()).toISOString();
  const record = {
    ...baseRecord,
    updatedAt: finishedAt,
    finishedAt,
    status: result.ok ? "succeeded" : "failed",
    codex,
    sandbox,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    exitCode: result.code ?? (result.ok ? 0 : 1)
  };
  await writeRunLog(logPath, record);
  return record;
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
          endpoints: ["/health", "/projects", "/runs", "/runs/codex"]
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
      if (request.method === "POST" && url.pathname === "/runs/codex") {
        const body = await readJsonBody(request);
        return sendJson(response, 201, await startCodexRun(paths, body, options));
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
    `Branch: ${project.branch || "main"}`,
    `Proje koku: ${project.path}`,
    `Prompt sablonu: ${templateText}`,
    `Otomasyon seviyesi: ${levelText}`,
    "Yasak islemler: git reset --hard, git clean -fd, git branch -D, git push --force, credential dosyasi okuma.",
    "Tum gorunur kullanici metinleri Turkce tutulacak.",
    "",
    userPrompt
  ].join("\n");
}

function assertSafeAutomationPrompt(prompt) {
  const forbidden = [
    /git\s+reset\s+--hard/i,
    /git\s+clean\s+-[a-z]*f/i,
    /git\s+branch\s+-D/i,
    /git\s+push\s+--force/i,
    /push\s+-f/i
  ];
  if (forbidden.some((pattern) => pattern.test(prompt))) {
    throw new Error("Destructive git islemi iceren Codex promptu reddedildi.");
  }
}

function sandboxForAutomationLevel(level) {
  if (level === "suggest") return "read-only";
  return "workspace-write";
}

async function writeRunLog(logPath, record) {
  await writeFile(logPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
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
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolveResult({ ok: false, stdout, stderr: error.message });
    });
    if (options.input) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
    child.on("close", (code) => {
      resolveResult({ ok: code === 0, stdout, stderr, code });
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
    console.log(`ctx-lab runner hazır: http://${args.host}:${args.port}`);
  });
}
