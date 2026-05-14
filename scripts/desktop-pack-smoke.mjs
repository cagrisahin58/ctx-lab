import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const require = createRequire(import.meta.url);
const electronPath = require("electron");

if (process.platform !== "win32") {
  console.log("desktop pack smoke skipped: Windows paket çıktısı yalnızca win32 üzerinde doğrulanır.");
  process.exit(0);
}

const unpackedDir = join(root, "release", "win-unpacked");
const exePath = join(unpackedDir, "ctx-lab.exe");
const asarPath = join(unpackedDir, "resources", "app.asar");

assert.ok(existsSync(unpackedDir), "release/win-unpacked bulunamadı. Önce `npm run desktop:pack` çalışmalı.");
assert.ok(existsSync(exePath), "Paketlenmiş ctx-lab.exe bulunamadı.");
assert.ok(existsSync(asarPath), "Paketlenmiş app.asar bulunamadı.");
assert.ok(statSync(exePath).size > 1_000_000, "ctx-lab.exe beklenenden küçük görünüyor.");
assert.ok(statSync(asarPath).size > 100_000, "app.asar beklenenden küçük görünüyor.");

const userData = await mkdtemp(join(tmpdir(), "ctxlab-pack-smoke-"));
try {
  const result = await runPackagedSmokeWithFallback(exePath, asarPath, userData);
  assert.equal(result.code, 0, `Paketlenmiş uygulama smoke çıkış kodu başarısız: ${result.code}\n${result.output}`);
  assert.match(result.output, /desktop app loaded/, "Paketlenmiş uygulama smoke yükleme sinyali vermedi.");
  console.log(result.mode === "asar-fallback"
    ? "desktop pack smoke ok (Windows exe politikası nedeniyle app.asar fallback kullanıldı)"
    : "desktop pack smoke ok");
} finally {
  await rm(userData, { recursive: true, force: true });
}

async function runPackagedSmokeWithFallback(exe, appAsar, userDataDir) {
  try {
    return { ...await runPackagedSmoke(exe, ["--smoke"], userDataDir), mode: "exe" };
  } catch (error) {
    if (!isWindowsPolicySpawnBlock(error)) throw error;
    const fallback = await runPackagedSmoke(electronPath, [appAsar, "--smoke"], userDataDir);
    return {
      ...fallback,
      mode: "asar-fallback",
      output: `${fallback.output}\nPaketlenmiş exe Windows uygulama denetimi tarafından engellendi: ${error.message}`
    };
  }
}

function isWindowsPolicySpawnBlock(error) {
  return process.platform === "win32" && error?.code === "UNKNOWN" && error?.syscall === "spawn";
}

function runPackagedSmoke(command, args, userDataDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      windowsHide: true,
      env: {
        ...process.env,
        CTX_LAB_ELECTRON_USER_DATA: userDataDir,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true"
      }
    });
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Paketlenmiş Electron smoke zaman aşımına uğradı.\n${output}`));
    }, 30_000);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (signal) {
        reject(new Error(`Paketlenmiş Electron smoke sinyal ile kapandı: ${signal}\n${output}`));
        return;
      }
      resolve({ code: code ?? 1, output });
    });
  });
}
