import { createServer } from "node:http";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join, posix, resolve, win32 } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const DEFAULT_RUNNER_PORT = 5174;
export const RUNNER_VERSION = "0.1.0";

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
      if (request.method === "GET" && url.pathname === "/health") {
        return sendJson(response, 200, await buildHealthPayload(paths, options));
      }
      if (request.method === "GET" && url.pathname === "/projects") {
        await ensureRunnerHome(paths);
        return sendJson(response, 200, await readProjectRegistry(paths));
      }
      return sendJson(response, 404, { ok: false, error: "Endpoint bulunamadı" });
    } catch (error) {
      return sendJson(response, 500, { ok: false, error: error.message });
    }
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

function runCommand(command, args) {
  return new Promise((resolveResult) => {
    const child = process.platform === "win32"
      ? spawn("cmd.exe", ["/d", "/s", "/c", [command, ...args].map(quoteCmdArg).join(" ")], { windowsHide: true })
      : spawn(command, args);
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
    child.on("close", (code) => {
      resolveResult({ ok: code === 0, stdout, stderr });
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
