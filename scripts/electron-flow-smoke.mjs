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
let phase = "Electron baslatma";

function markPhase(value) {
  phase = value;
  console.log(`[electron-flow] ${value}`);
}

function escapeAnnotation(value) {
  return String(value || "")
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A")
    .slice(0, 900);
}

function reportFailure(error) {
  console.error(`::error title=Electron flow smoke failed::${escapeAnnotation(phase)}: ${escapeAnnotation(error?.message || error)}`);
}

async function expectVisibleText(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({
    state: "visible",
    timeout: 15_000
  });
}

async function moveWorkCardToColumn(page, workId, status) {
  const workCard = page.locator(`[data-drag-work-id="${workId}"]`);
  const targetColumn = page.locator(`[data-board-column="${status}"]`);
  await workCard.scrollIntoViewIfNeeded();
  await targetColumn.scrollIntoViewIfNeeded();

  try {
    await workCard.dragTo(targetColumn, {
      targetPosition: { x: 24, y: 48 },
      timeout: 5_000
    });
  } catch {
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await workCard.dispatchEvent("dragstart", { dataTransfer });
    await targetColumn.dispatchEvent("dragenter", { dataTransfer });
    await targetColumn.dispatchEvent("dragover", { dataTransfer });
    await targetColumn.dispatchEvent("drop", { dataTransfer });
    await workCard.dispatchEvent("dragend", { dataTransfer });
  }

  await page.locator(`[data-board-column="${status}"] [data-drag-work-id="${workId}"]`).waitFor({
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

const launchArgs = process.platform === "linux" && process.env.CI
  ? ["--no-sandbox", "--disable-gpu", root]
  : [root];

let electronApp;
try {
  markPhase("Electron uygulamasini acma");
  electronApp = await electron.launch({
    executablePath: electronPath,
    args: launchArgs,
    cwd: root,
    env
  });

  const page = await electronApp.firstWindow();
  markPhase("Ilk kurulum ekranini bekleme");
  await page.waitForLoadState("domcontentloaded");

  await expectVisibleText(page, "Kısa Kurulum");
  await expectVisibleText(page, "GitHub Hafıza Reposu");
  await expectVisibleText(page, "Repo bağla");
  await expectVisibleText(page, "Yapıyı hazırla");
  await expectVisibleText(page, "Doğrula");
  await expectVisibleText(page, "Codex CLI Kontrolü");
  await expectVisibleText(page, "Örnek Devam Brifi");
  await expectVisibleText(page, "Proje Çalışma Merkezi");
  await page.getByRole("button", { name: "Tokeni göster" }).click();
  assert.equal(await page.locator('#onboarding-config-form input[name="token"]').getAttribute("type"), "text");
  await page.getByRole("button", { name: "Tokeni gizle" }).click();
  assert.equal(await page.locator('#onboarding-config-form input[name="token"]').getAttribute("type"), "password");
  await page.getByText("Token nasıl üretilir?").click();
  await expectVisibleText(page, "Read and write");
  await expectVisibleText(page, "GitHub token ekranını aç");
  await page.waitForFunction(() => {
    const text = document.body.innerText || "";
    return !text.includes("Kontrol bekliyor") && !text.includes("Codex kontrol bekliyor");
  }, null, { timeout: 20_000 }).catch(() => {
    console.warn("[electron-flow] Runner health bekleyisi tamamlanmadi; UI akisi devam ediyor.");
  });

  markPhase("Proje kokunu kaydetme");
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

  markPhase("Calisma merkezini ve komut paletini dogrulama");
  await page.getByRole("button", { name: "Önce Gez" }).click();
  await page.locator('button[data-view="inbox"]').click();
  await expectVisibleText(page, "Bugün");
  await expectVisibleText(page, "görünür oturum");
  await expectVisibleText(page, "Sıradaki adım");
  await expectVisibleText(page, "Akıllı eşleşme");
  await expectVisibleText(page, "Önerilen İşe Bağla");
  await page.keyboard.press("a");
  await expectVisibleText(page, "Arşivi Onayla");
  await page.keyboard.press("l");
  await expectVisibleText(page, "Oturum seçili iş kartına bağlandı.");
  await expectVisibleText(page, "Kalıcı gerçeklik burada tutulur");
  await page.locator('button[data-view="workspace"]').click();
  await expectVisibleText(page, "Güncel Bağlam");
  await expectVisibleText(page, "Codex'e Devret");
  await expectVisibleText(page, "Çalışma Günlüğü");
  await expectVisibleText(page, "Tek tıkla devam brifi");
  await page.locator('[data-action="toggle-activity-log"]').click();
  await page.locator(".activity-log").waitFor({ state: "detached", timeout: 15_000 });
  await page.locator('[data-action="toggle-activity-log"]').click();
  await expectVisibleText(page, "Çalışma Günlüğü");
  await page.locator('[data-action="toggle-theme"]').click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
  await page.locator('[data-action="toggle-theme"]').click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");

  await page.keyboard.press("Control+K");
  await expectVisibleText(page, "Komut Paleti");
  await page.locator("[data-command-search]").fill("runner");
  await page.locator("[data-command-dialog]").getByRole("button", { name: /Yerel Codex Runner/ }).click();
  await expectVisibleText(page, "Yerel Codex Runner");
  await expectVisibleText(page, "Hafıza Senkron Durumu");
  await page.keyboard.press("Control+K");
  await page.locator("[data-command-search]").fill("proje çalışma");
  await page.locator("[data-command-dialog]").getByRole("button", { name: /Proje Çalışma Merkezi/ }).click();
  await expectVisibleText(page, "Codex'e Devret");
  await page.keyboard.press("Control+K");
  await page.locator("[data-command-search]").fill("karar defteri");
  await page.locator('[data-command-id="view:decisions"]').click();
  await expectVisibleText(page, "Karar Detayı");
  await expectVisibleText(page, "GitHub memory repo source-of-truth olacak");
  await expectVisibleText(page, "Kalıcı çalışma hafızası için GitHub memory repo ana gerçeklik olacak.");
  await page.keyboard.press("Control+K");
  await page.locator("[data-command-search]").fill("görünüm");
  await page.locator('[data-command-id="view:appearance"]').click();
  await expectVisibleText(page, "Tema Durumu");
  await expectVisibleText(page, "Kısayol Haritası");
  await expectVisibleText(page, "Klavye Akışı");
  await page.getByRole("tab", { name: "Bağlantı" }).click();
  await expectVisibleText(page, "GitHub Token");
  await page.locator('button[data-view="workspace"]').click();
  await expectVisibleText(page, "Codex'e Devret");

  markPhase("Codex dry-run kaydi olusturma");
  const runForm = page.locator("#codex-run-form");
  await runForm.locator('textarea[name="prompt"]').fill("ctx-lab Electron smoke icin dry-run devam brifi hazirla.");
  await runForm.getByRole("button", { name: "Run kaydı oluştur" }).click();
  await expectVisibleText(page, "Codex dry-run kaydı hazırlandı.");
  await expectVisibleText(page, "dry_run");
  await expectVisibleText(page, "Run Kanıtı");
  await expectVisibleText(page, "Test sonucu");
  await expectVisibleText(page, "Git başlangıç");
  await expectVisibleText(page, "Git sonuç");
  await expectVisibleText(page, "Çalıştırılmadı");
  await expectVisibleText(page, "Commit + push için ayrı onay verdim");

  markPhase("Is akisi surukle birak durumunu dogrulama");
  await page.keyboard.press("Control+K");
  await page.locator("[data-command-search]").fill("iş akışı");
  await page.locator("[data-command-dialog]").getByRole("button", { name: /İş Akışı/ }).click();
  await expectVisibleText(page, "Kalıcı gerçeklik burada tutulur");
  await moveWorkCardToColumn(page, "work_ctx_lab_redesign", "waiting");

  markPhase("Devam brifi ve hafiza sagligi gorunumlerini dogrulama");
  await page.keyboard.press("Control+K");
  await page.locator("[data-command-search]").fill("devam brifi");
  await page.locator('[data-command-id="view:handoff"]').click();
  await expectVisibleText(page, "Tahmini token");
  await expectVisibleText(page, "Paket İçeriği");
  await page.getByRole("button", { name: "Claude Code" }).click();
  await page.locator(".target-switch .claude.active").waitFor({ state: "visible", timeout: 15_000 });
  await page.keyboard.press("Control+K");
  await page.locator("[data-command-search]").fill("hafıza sağlığı");
  await page.locator('[data-command-id="view:health"]').click();
  await expectVisibleText(page, "Hafıza Sağlığı");
  await expectVisibleText(page, "Format, yaşam döngüsü ve arşiv önerileri burada izlenir.");

  markPhase("Tamamlanan is hattini arsivleme akisini dogrulama");
  await page.keyboard.press("Control+K");
  await page.locator("[data-command-search]").fill("iş akışı");
  await page.locator("[data-command-dialog]").getByRole("button", { name: /İş Akışı/ }).click();
  await moveWorkCardToColumn(page, "work_ctx_lab_redesign", "done");
  await expectVisibleText(page, "İş Hattını Arşivle");
  await page.getByRole("button", { name: "İş Hattını Arşivle" }).click();
  await expectVisibleText(page, "Arşivi Onayla");
  await page.getByRole("button", { name: "Arşivi Onayla" }).click();
  await expectVisibleText(page, "İş hattı arşivlendi.");

  const title = await electronApp.evaluate(({ BrowserWindow }) => {
    return BrowserWindow.getAllWindows()[0]?.getTitle();
  });
  assert.match(title || "", /^ctx-lab/);

  const screenshot = await page.screenshot({ fullPage: true });
  assert.ok(screenshot.length > 10_000, "Electron ekran görüntüsü boş görünüyor");

  console.log("electron flow smoke ok");
} catch (error) {
  reportFailure(error);
  throw error;
} finally {
  if (electronApp) {
    await electronApp.close();
  }
  await rm(userData, { recursive: true, force: true });
}
