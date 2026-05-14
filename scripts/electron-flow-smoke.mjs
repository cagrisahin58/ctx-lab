import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { _electron as electron } from "playwright-core";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const root = process.cwd();
const userData = await mkdtemp(join(tmpdir(), "ctxlab-electron-flow-"));

async function expectVisibleText(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({
    state: "visible",
    timeout: 15_000
  });
}

const env = {
  ...process.env,
  CTX_LAB_ELECTRON_USER_DATA: userData,
  ELECTRON_DISABLE_SECURITY_WARNINGS: "true"
};
delete env.VITE_DEV_SERVER_URL;

let electronApp;
try {
  electronApp = await electron.launch({
    executablePath: electronPath,
    args: [root],
    cwd: root,
    env
  });

  const page = await electronApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");

  await expectVisibleText(page, "Kısa Kurulum");
  await expectVisibleText(page, "GitHub Hafıza Reposu");
  await expectVisibleText(page, "Codex CLI Kontrolü");
  await expectVisibleText(page, "Örnek Devam Brifi");
  await expectVisibleText(page, "Proje Çalışma Merkezi");

  await page.getByRole("button", { name: "Örnek Devam Brifi Üret" }).click();
  await expectVisibleText(page, "Codex için ctx-lab devam brifi");

  await page.getByRole("button", { name: "Önce Gez" }).click();
  await page.locator('button[data-view="workspace"]').click();
  await expectVisibleText(page, "Güncel Bağlam");
  await expectVisibleText(page, "Codex'e Devret");
  await expectVisibleText(page, "Çalışma Günlüğü");
  await expectVisibleText(page, "Tek tıkla devam brifi");

  const title = await electronApp.evaluate(({ BrowserWindow }) => {
    return BrowserWindow.getAllWindows()[0]?.getTitle();
  });
  assert.match(title || "", /^ctx-lab/);

  const screenshot = await page.screenshot({ fullPage: true });
  assert.ok(screenshot.length > 10_000, "Electron ekran görüntüsü boş görünüyor");

  console.log("electron flow smoke ok");
} finally {
  if (electronApp) {
    await electronApp.close();
  }
  await rm(userData, { recursive: true, force: true });
}
