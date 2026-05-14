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
  await page.waitForFunction(() => {
    const text = document.body.innerText || "";
    return !text.includes("Kontrol bekliyor") && !text.includes("Codex kontrol bekliyor");
  }, null, { timeout: 20_000 });

  const projectForm = page.locator("#onboarding-project-form");
  await projectForm.locator('input[name="name"]').fill("ctx-lab");
  await projectForm.locator('input[name="repo"]').fill("cagrisahin58/ctx-lab");
  await projectForm.locator('input[name="branch"]').fill("main");
  await projectForm.locator('input[name="path"]').fill(root);
  await projectForm.getByRole("button", { name: "Proje Kökünü Kaydet" }).click();
  await expectVisibleText(page, "Proje kökü yerel runner'a kaydedildi.");
  await expectVisibleText(page, "1 kayıtlı kök");

  await page.getByRole("button", { name: "Örnek Devam Brifi Üret" }).click();
  await expectVisibleText(page, "Codex için ctx-lab devam brifi");

  await page.getByRole("button", { name: "Önce Gez" }).click();
  await page.locator('button[data-view="workspace"]').click();
  await expectVisibleText(page, "Güncel Bağlam");
  await expectVisibleText(page, "Codex'e Devret");
  await expectVisibleText(page, "Çalışma Günlüğü");
  await expectVisibleText(page, "Tek tıkla devam brifi");

  await page.keyboard.press("Control+K");
  await expectVisibleText(page, "Komut Paleti");
  await page.locator("[data-command-search]").fill("runner");
  await page.locator("[data-command-dialog]").getByRole("button", { name: /Yerel Codex Runner/ }).click();
  await expectVisibleText(page, "Yerel Codex Runner");
  await page.keyboard.press("Control+K");
  await page.locator("[data-command-search]").fill("proje çalışma");
  await page.locator("[data-command-dialog]").getByRole("button", { name: /Proje Çalışma Merkezi/ }).click();
  await expectVisibleText(page, "Codex'e Devret");

  const runForm = page.locator("#codex-run-form");
  await runForm.locator('textarea[name="prompt"]').fill("ctx-lab Electron smoke icin dry-run devam brifi hazirla.");
  await runForm.getByRole("button", { name: "Run kaydı oluştur" }).click();
  await expectVisibleText(page, "Codex dry-run kaydı hazırlandı.");
  await expectVisibleText(page, "dry_run");

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
