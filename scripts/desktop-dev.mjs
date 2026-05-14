import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const electronPath = require("electron");

export async function main(env = process.env) {
  const vitePort = env.CTX_LAB_VITE_PORT || "5173";
  const viteUrl = env.VITE_DEV_SERVER_URL || `http://127.0.0.1:${vitePort}`;
  const isSmoke = env.CTX_LAB_DESKTOP_DEV_SMOKE === "1";
  const vite = spawnChild(
    ...buildNpmInvocation(["run", "dev", "--", "--host", "127.0.0.1", "--port", vitePort, "--strictPort"], env),
    {
      stdio: "inherit",
      windowsHide: true
    }
  );

  let electron;

  try {
    await waitForViteReady(vite, viteUrl);
    electron = spawnChild(electronPath, isSmoke ? [".", "--smoke"] : ["."], {
      stdio: "inherit",
      env: {
        ...env,
        VITE_DEV_SERVER_URL: viteUrl
      },
      windowsHide: true
    });
    const [code] = await once(electron, "close");
    process.exitCode = code || 0;
  } finally {
    await stopProcessTree(vite);
  }
}

export function buildNpmInvocation(args, env = process.env, platform = process.platform) {
  if (env.npm_execpath) {
    return [
      env.npm_node_execpath || process.execPath,
      [env.npm_execpath, ...args]
    ];
  }
  if (platform === "win32") {
    return ["cmd.exe", ["/d", "/c", ["npm.cmd", ...args].join(" ")]];
  }
  return ["npm", args];
}

function spawnChild(command, args, options) {
  try {
    return spawn(command, args, options);
  } catch (error) {
    throw new Error(`Komut baslatilamadi (${command}): ${error.message}`);
  }
}

async function stopProcessTree(child) {
  if (!child || child.killed) return;
  if (process.platform === "win32" && child.pid) {
    const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true
    });
    await once(killer, "close").catch(() => {});
    return;
  }
  child.kill();
}

async function waitForViteReady(vite, url) {
  const close = once(vite, "close").then(([code, signal]) => ({ code, signal }));
  const readyOrClosed = await Promise.race([
    waitForUrl(url).then(() => null),
    close
  ]);
  if (readyOrClosed) throw new Error(formatViteExit(readyOrClosed));

  await wait(500);
  if (vite.exitCode !== null || vite.signalCode !== null) {
    throw new Error(formatViteExit({ code: vite.exitCode, signal: vite.signalCode }));
  }
}

function formatViteExit({ code, signal }) {
  const suffix = signal ? `sinyal ${signal}` : `cikis kodu ${code ?? "bilinmiyor"}`;
  return `Vite dev server erken kapandi: ${suffix}. Port doluysa once eski 127.0.0.1:5173 surecini kapat veya .\\scripts\\start-windows.cmd -Port 5175 kullan.`;
}

async function waitForUrl(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await wait(250);
  }
  throw new Error(`Vite dev server acilamadi: ${url}`);
}

function isDirectRun() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
