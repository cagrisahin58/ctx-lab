import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as wait } from "node:timers/promises";

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const electronCmd = process.platform === "win32"
  ? "node_modules\\.bin\\electron.cmd"
  : "node_modules/.bin/electron";
const viteUrl = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173";

const vite = spawn(npmCmd, ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5173", "--strictPort"], {
  stdio: "inherit",
  windowsHide: true
});

let electron;

try {
  await waitForUrl(viteUrl);
  electron = spawn(electronCmd, ["."], {
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: viteUrl
    },
    windowsHide: true
  });
  const [code] = await once(electron, "close");
  process.exitCode = code || 0;
} finally {
  vite.kill();
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
