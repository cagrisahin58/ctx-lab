import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DESKTOP_IPC_CHANNELS } from "../electron/runtime.mjs";

const root = process.cwd();

for (const file of [
  "electron/main.mjs",
  "electron/preload.cjs",
  "electron/runtime.mjs",
  "scripts/electron-smoke-launch.mjs",
  "electron/assets/icon.ico",
  "electron-builder.yml",
  "dist/index.html"
]) {
  assert.ok(existsSync(join(root, file)), `${file} bulunamadi`);
}

const icon = readFileSync(join(root, "electron/assets/icon.ico"));
assert.equal(icon.readUInt16LE(0), 0, "Windows ikon header reserve alani sifir olmali");
assert.equal(icon.readUInt16LE(2), 1, "Windows ikon tipi ICO olmali");
assert.ok(icon.readUInt16LE(4) >= 1, "Windows ikon dosyasinda en az bir gorsel olmali");
assert.ok(icon.length > 1000, "Windows ikon dosyasi placeholder kadar kucuk gorunuyor");
assert.deepEqual(
  [...icon.subarray(22, 30)],
  [137, 80, 78, 71, 13, 10, 26, 10],
  "ICO icinde PNG ikon verisi bulunmali"
);

const preload = readFileSync(join(root, "electron/preload.cjs"), "utf8");
for (const channel of Object.values(DESKTOP_IPC_CHANNELS)) {
  assert.ok(preload.includes(channel), `preload IPC kanali eksik: ${channel}`);
}

const main = readFileSync(join(root, "electron/main.mjs"), "utf8");
assert.ok(main.includes("contextIsolation: true"), "Electron contextIsolation acik olmali");
assert.ok(main.includes("nodeIntegration: false"), "Renderer nodeIntegration kapali olmali");
assert.ok(main.includes("sandbox: true"), "Renderer sandbox acik olmali");
assert.ok(main.includes("icon: appIconPath"), "Electron pencere ikonu tanimli olmali");
assert.ok(main.includes("Menu.setApplicationMenu"), "Electron uygulama menusu tanimli olmali");
assert.ok(main.includes("new Tray"), "Electron tray opsiyonu tanimli olmali");
assert.ok(!main.includes("icon-placeholder"), "Electron gercek ikon yerine placeholder fallback kullanmamali");
for (const label of ["ctx-lab Hakkında", "Görünüm", "Geliştirici Araçları", "Yaklaşımı Sıfırla", "ctx-lab'i Aç", "Çıkış"]) {
  assert.ok(main.includes(label), `Electron menu/tray etiketi eksik: ${label}`);
}

const builder = readFileSync(join(root, "electron-builder.yml"), "utf8");
assert.ok(builder.includes("icon: electron/assets/icon.ico"), "Windows paket ikonu tanimli olmali");

const readme = readFileSync(join(root, "README.md"), "utf8");
assert.ok(readme.includes("main process içindeki güvenli IPC"), "README Electron IPC calistirici omurgasini anlatmali");
assert.ok(readme.includes("yalnızca `127.0.0.1` üzerinde HTTP servisi"), "README web fallback localhost sinirini anlatmali");
assert.ok(!readme.includes("`start-windows` komutu ayrıca `scripts/ctxlab-runner.mjs` servislerini başlatır"), "README varsayilan launcher icin eski localhost runner anlatimini tasimamali");

const desktopDev = readFileSync(join(root, "scripts/desktop-dev.mjs"), "utf8");
assert.ok(desktopDev.includes("CTX_LAB_VITE_PORT"), "desktop dev port override desteklenmeli");

const smokeLaunch = readFileSync(join(root, "scripts/electron-smoke-launch.mjs"), "utf8");
assert.ok(smokeLaunch.includes("--no-sandbox"), "CI Linux Electron smoke sandbox bayragi desteklenmeli");

const windowsLauncher = readFileSync(join(root, "scripts/start-windows.ps1"), "utf8");
assert.ok(windowsLauncher.includes("run desktop:dev"), "Windows launcher varsayilan olarak Electron masaustu kabugunu acmali");
assert.ok(windowsLauncher.includes("run desktop:smoke"), "Windows launcher deneme kontrolunde masaustu smoke calistirmali");
assert.ok(windowsLauncher.includes("if ($Web)"), "Windows launcher web fallback anahtarini korumali");

console.log("desktop smoke ok");
