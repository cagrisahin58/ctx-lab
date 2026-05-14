import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DESKTOP_IPC_CHANNELS } from "../electron/runtime.mjs";

const root = process.cwd();

for (const file of [
  "electron/main.mjs",
  "electron/preload.cjs",
  "electron/runtime.mjs",
  "electron/assets/icon.ico",
  "electron/assets/icon-placeholder.svg",
  "electron-builder.yml",
  "dist/index.html"
]) {
  assert.ok(existsSync(join(root, file)), `${file} bulunamadi`);
}

const preload = readFileSync(join(root, "electron/preload.cjs"), "utf8");
for (const channel of Object.values(DESKTOP_IPC_CHANNELS)) {
  assert.ok(preload.includes(channel), `preload IPC kanali eksik: ${channel}`);
}

const main = readFileSync(join(root, "electron/main.mjs"), "utf8");
assert.ok(main.includes("contextIsolation: true"), "Electron contextIsolation acik olmali");
assert.ok(main.includes("nodeIntegration: false"), "Renderer nodeIntegration kapali olmali");
assert.ok(main.includes("sandbox: true"), "Renderer sandbox acik olmali");
assert.ok(main.includes("icon: appIconPath"), "Electron pencere ikonu tanimli olmali");

const builder = readFileSync(join(root, "electron-builder.yml"), "utf8");
assert.ok(builder.includes("icon: electron/assets/icon.ico"), "Windows paket ikonu tanimli olmali");

const desktopDev = readFileSync(join(root, "scripts/desktop-dev.mjs"), "utf8");
assert.ok(desktopDev.includes("CTX_LAB_VITE_PORT"), "desktop dev port override desteklenmeli");

const windowsLauncher = readFileSync(join(root, "scripts/start-windows.ps1"), "utf8");
assert.ok(windowsLauncher.includes("run desktop:dev"), "Windows launcher varsayilan olarak Electron masaustu kabugunu acmali");
assert.ok(windowsLauncher.includes("run desktop:smoke"), "Windows launcher dry-run masaustu smoke calistirmali");
assert.ok(windowsLauncher.includes("if ($Web)"), "Windows launcher web fallback anahtarini korumali");

console.log("desktop smoke ok");
