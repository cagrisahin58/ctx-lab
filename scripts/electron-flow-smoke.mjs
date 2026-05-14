import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { inflateSync } from "node:zlib";
import { _electron as electron } from "playwright-core";
import { parseMemoryFile } from "../src/domain.js";
import { CONFIG_STORAGE_KEY, RECORD_CACHE_STORAGE_KEY } from "../src/storage.js";
import { buildMemoryMirrorPaths, buildRunnerPaths } from "../scripts/ctxlab-runner.mjs";

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

function assertRenderedScreenshot(png) {
  const { width, height, pixels } = decodePng(png);
  assert.ok(width >= 1000, `Electron ekran görüntüsü beklenenden dar: ${width}px`);
  assert.ok(height >= 700, `Electron ekran görüntüsü beklenenden kısa: ${height}px`);

  const seen = new Set();
  let minLuma = 255;
  let maxLuma = 0;
  const sampleStep = Math.max(1, Math.floor((width * height) / 10_000));
  for (let offset = 0, sample = 0; offset < pixels.length; offset += 4, sample += 1) {
    if (sample % sampleStep !== 0) continue;
    const alpha = pixels[offset + 3];
    if (alpha === 0) continue;
    const r = pixels[offset];
    const g = pixels[offset + 1];
    const b = pixels[offset + 2];
    const luma = Math.round((0.2126 * r) + (0.7152 * g) + (0.0722 * b));
    minLuma = Math.min(minLuma, luma);
    maxLuma = Math.max(maxLuma, luma);
    seen.add(`${r >> 4},${g >> 4},${b >> 4}`);
  }

  assert.ok(seen.size >= 18, `Electron ekran görüntüsü tekdüze görünüyor: ${seen.size} renk kovası`);
  assert.ok(maxLuma - minLuma >= 35, `Electron ekran görüntüsü kontrastı düşük görünüyor: ${maxLuma - minLuma}`);
}

function decodePng(buffer) {
  assert.equal(buffer.toString("hex", 0, 8), "89504e470d0a1a0a", "Ekran görüntüsü PNG değil");
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = buffer.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }

  assert.equal(bitDepth, 8, "PNG ekran görüntüsü 8-bit olmalı");
  assert.ok(colorType === 2 || colorType === 6, `Desteklenmeyen PNG renk tipi: ${colorType}`);
  const sourceBpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * sourceBpp;
  const rgba = Buffer.alloc(width * height * 4);
  let rawOffset = 0;
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset];
    rawOffset += 1;
    const current = Buffer.from(raw.subarray(rawOffset, rawOffset + stride));
    rawOffset += stride;
    unfilterScanline(current, previous, sourceBpp, filter);
    for (let x = 0; x < width; x += 1) {
      const source = x * sourceBpp;
      const target = (y * width + x) * 4;
      rgba[target] = current[source];
      rgba[target + 1] = current[source + 1];
      rgba[target + 2] = current[source + 2];
      rgba[target + 3] = sourceBpp === 4 ? current[source + 3] : 255;
    }
    previous = current;
  }

  return { width, height, pixels: rgba };
}

function unfilterScanline(current, previous, bpp, filter) {
  for (let index = 0; index < current.length; index += 1) {
    const left = index >= bpp ? current[index - bpp] : 0;
    const up = previous[index] || 0;
    const upperLeft = index >= bpp ? previous[index - bpp] || 0 : 0;
    if (filter === 1) current[index] = (current[index] + left) & 255;
    else if (filter === 2) current[index] = (current[index] + up) & 255;
    else if (filter === 3) current[index] = (current[index] + Math.floor((left + up) / 2)) & 255;
    else if (filter === 4) current[index] = (current[index] + paeth(left, up, upperLeft)) & 255;
    else assert.equal(filter, 0, `Desteklenmeyen PNG filtre tipi: ${filter}`);
  }
}

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

async function expectVisibleText(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({
    state: "visible",
    timeout: 15_000
  });
}

function validationFixtureRecords() {
  const updatedAt = "2026-05-14T08:00:00.000Z";
  return [
    parseMemoryFile("inbox/missing-status.md", `---
id: sess_missing_status
source: codex
project: ctx-lab
repo: cagrisahin58/ctx-lab
created_at: ${updatedAt}
---

# Eksik Durum

## Amaç
Eksik status alanının Hafıza Sağlığı panelinde görünmesini doğrula.
`, "fixture-missing-status"),
    parseMemoryFile("work_items/missing-id.md", `---
title: Eksik id doğrulaması
project: ctx-lab
status: active
updated_at: ${updatedAt}
---

## Objective
Eksik id uyarısını kullanıcı seviyesinde doğrula.
`, "fixture-missing-id"),
    parseMemoryFile("inbox/malformed.md", `---
id sess_malformed
source: codex
project: ctx-lab
status: needs_triage
---

# Bozuk Frontmatter
`, "fixture-malformed"),
    parseMemoryFile("inbox/duplicate-a.md", `---
id: sess_duplicate
source: codex
project: ctx-lab
status: needs_triage
created_at: ${updatedAt}
---

# Duplicate A
`, "fixture-duplicate-a"),
    parseMemoryFile("inbox/duplicate-b.md", `---
id: sess_duplicate
source: claude
project: ctx-lab
status: needs_triage
created_at: ${updatedAt}
---

# Duplicate B
`, "fixture-duplicate-b")
  ];
}

function memoryFixtureConfig() {
  return {
    owner: "cagrisahin58",
    repo: "ctx-lab",
    branch: "main",
    token: "test-token"
  };
}

function localChangeFixtureRecords() {
  return [
    ...validationFixtureRecords(),
    parseMemoryFile("inbox/local-only.md", `---
id: sess_local_only
source: codex
project: ctx-lab
repo: cagrisahin58/ctx-lab
status: needs_triage
created_at: 2026-05-14T08:10:00.000Z
---

# Yerel Değişiklik

## Amaç
Yerel önbellekte olup ayna indeksinde olmayan kaydın senkron panelinde görünmesini doğrula.
`, "fixture-local-only")
  ];
}

async function seedValidationCache(page, options = {}) {
  const config = memoryFixtureConfig();
  const indexRecords = validationFixtureRecords();
  const records = options.localChange ? localChangeFixtureRecords() : indexRecords;
  const cache = {
    scope: "cagrisahin58/ctx-lab@main",
    syncedAt: options.localChange ? "2026-05-14T08:10:00.000Z" : "2026-05-14T08:05:00.000Z",
    remoteHead: "validation-fixture-head",
    records
  };
  await seedMemoryIndex(config, indexRecords);
  await page.evaluate(({ configKey, cacheKey, configValue, cacheValue }) => {
    localStorage.setItem(configKey, JSON.stringify(configValue));
    localStorage.setItem(cacheKey, JSON.stringify(cacheValue));
  }, {
    configKey: CONFIG_STORAGE_KEY,
    cacheKey: RECORD_CACHE_STORAGE_KEY,
    configValue: config,
    cacheValue: cache
  });
}

async function seedMemoryIndex(config, records) {
  const paths = buildRunnerPaths(userData);
  const mirror = buildMemoryMirrorPaths(paths, config);
  const index = {
    schemaVersion: 1,
    owner: config.owner,
    repo: config.repo,
    branch: config.branch,
    cloneDir: mirror.cloneDir,
    memoryRoot: join(mirror.cloneDir, "work-memory"),
    indexedAt: "2026-05-14T08:06:00.000Z",
    lastCommit: "validation-fixture-head",
    recordCount: records.length,
    warningCount: 4,
    counts: records.reduce((counts, record) => {
      counts[record.type] = (counts[record.type] || 0) + 1;
      return counts;
    }, {}),
    warnings: ["validation fixture"],
    records: records.map((record) => ({
      id: record.id,
      type: record.type,
      path: record.path,
      status: record.status,
      project: record.project,
      repo: record.repo,
      branch: record.branch,
      title: record.title,
      summary: record.summary,
      nextAction: record.nextAction,
      createdAt: record.createdAt,
      updatedAt: record.frontmatter?.updated_at || "",
      sha: record.sha
    }))
  };
  await mkdir(dirname(mirror.indexFile), { recursive: true });
  await writeFile(mirror.indexFile, `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

async function moveWorkCardToColumn(page, workId, status) {
  const workCard = page.locator(`[data-drag-work-id="${workId}"]`);
  const targetColumn = page.locator(`[data-board-column="${status}"]`);
  const movedCard = page.locator(`[data-board-column="${status}"] [data-drag-work-id="${workId}"]`);
  await workCard.scrollIntoViewIfNeeded();
  await targetColumn.scrollIntoViewIfNeeded();

  async function waitForMoved(timeout = 2_500) {
    try {
      await movedCard.waitFor({ state: "visible", timeout });
      return true;
    } catch {
      return false;
    }
  }

  async function dispatchDragFallback() {
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await workCard.dispatchEvent("dragstart", { dataTransfer });
    await targetColumn.dispatchEvent("dragenter", { dataTransfer });
    await targetColumn.dispatchEvent("dragover", { dataTransfer });
    await targetColumn.dispatchEvent("drop", { dataTransfer });
    await workCard.dispatchEvent("dragend", { dataTransfer });
  }

  try {
    await workCard.dragTo(targetColumn, {
      targetPosition: { x: 24, y: 48 },
      timeout: 5_000
    });
  } catch {
    await dispatchDragFallback();
  }

  if (!(await waitForMoved())) {
    await dispatchDragFallback();
  }

  await movedCard.waitFor({
    state: "visible",
    timeout: 15_000
  });
}

const env = {
  ...process.env,
  CTX_LAB_ELECTRON_USER_DATA: userData,
  CTX_LAB_ELECTRON_PROJECT_DIR: root,
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
  await expectVisibleText(page, "Hafızayı bağla");
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
  await projectForm.getByRole("button", { name: "Klasör Seç" }).click();
  await expectVisibleText(page, "Proje kökü seçildi.");
  assert.equal(await projectForm.locator('input[name="path"]').inputValue(), root);
  await projectForm.locator('input[name="name"]').fill("ctx-lab");
  await projectForm.locator('input[name="repo"]').fill("cagrisahin58/ctx-lab");
  await projectForm.locator('input[name="branch"]').fill("main");
  await projectForm.getByRole("button", { name: "Proje Kökünü Kaydet" }).click();
  await expectVisibleText(page, "Proje kökü yerel çalıştırıcıya kaydedildi.");
  await page.locator('.toast[role="status"][aria-live="polite"][aria-atomic="true"]').waitFor({
    state: "visible",
    timeout: 15_000
  });
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
  await page.keyboard.press("Shift+Tab");
  assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest("[data-command-dialog]"))), true);
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest("[data-command-dialog]"))), true);
  await page.locator("[data-command-search]").fill("çalıştırıcı");
  await page.locator("[data-command-dialog]").getByRole("button", { name: /Yerel Codex Çalıştırıcı/ }).click();
  await expectVisibleText(page, "Yerel Codex Çalıştırıcı");
  await expectVisibleText(page, "Hafıza Senkron Durumu");
  await expectVisibleText(page, "Yerel Hafıza Aynası");
  await expectVisibleText(page, "Aynayı Yenile");
  await page.keyboard.press("Control+K");
  await page.locator("[data-command-search]").fill("proje çalışma");
  await page.locator("[data-command-dialog]").getByRole("button", { name: /Proje Çalışma Merkezi/ }).click();
  await expectVisibleText(page, "Codex'e Devret");
  await page.keyboard.press("Control+K");
  await page.locator("[data-command-search]").fill("karar defteri");
  await page.locator('[data-command-id="view:decisions"]').click();
  await expectVisibleText(page, "Karar Detayı");
  await expectVisibleText(page, "GitHub hafıza reposu kaynak gerçeklik olacak");
  await expectVisibleText(page, "Kalıcı çalışma hafızası için GitHub hafıza reposu ana gerçeklik olacak.");
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

  markPhase("Codex deneme kaydi olusturma");
  const runForm = page.locator("#codex-run-form");
  await runForm.locator('textarea[name="prompt"]').fill("ctx-lab Electron smoke icin deneme devam brifi hazirla.");
  await runForm.getByRole("button", { name: "Çalıştırma kaydı oluştur" }).click();
  await expectVisibleText(page, "Codex deneme kaydı hazırlandı.");
  await expectVisibleText(page, "Codex çalıştırma kaydı hafızaya bağlandı:");
  await expectVisibleText(page, "Deneme kaydı");
  await expectVisibleText(page, "Çalıştırma Kanıtı");
  await expectVisibleText(page, "Test sonucu");
  await expectVisibleText(page, "Çıkış kodu");
  await expectVisibleText(page, "Olay Akışı");
  await expectVisibleText(page, "Olayları Yenile");
  await expectVisibleText(page, "Gerçek Codex çalışmasının stdout/stderr olayları burada görünür.");
  await expectVisibleText(page, "Deneme kaydı olarak kaydet");
  await expectVisibleText(page, "Çalıştırma sonucunu seçili iş hattına bağla");
  await expectVisibleText(page, "Git başlangıç");
  await expectVisibleText(page, "Git sonuç");
  await expectVisibleText(page, "Çalıştırılmadı");
  await expectVisibleText(page, "Commit + push için ayrı onay verdim");

  markPhase("Commit push onay kapisini dogrulama");
  await runForm.locator('textarea[name="prompt"]').fill("Commit push kapisini onaysiz dene.");
  await runForm.locator('select[name="automationLevel"]').selectOption("commit_push");
  await runForm.locator('input[name="dryRun"]').uncheck();
  await runForm.getByRole("button", { name: "Çalıştırma kaydı oluştur" }).click();
  await expectVisibleText(page, "Codex çalıştırması onay bekliyor.");
  await expectVisibleText(page, "Engellendi");
  await expectVisibleText(page, "Commit/push kullanıcı onayı, görünür özet ve test sonucu olmadan uygulanmaz.");
  await expectVisibleText(page, "Commit/push onayı verilmedi.");
  await expectVisibleText(page, "Commit Hazırlığı");
  await expectVisibleText(page, "Hazır değil");
  await expectVisibleText(page, "Commit Taslağı");
  await expectVisibleText(page, "Commit mesajı");

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
  await expectVisibleText(page, "Paket Kaynakları");
  await expectVisibleText(page, "İş hattı kaynağı");
  await expectVisibleText(page, "Oturum kaynağı");
  await expectVisibleText(page, "Karar kaynağı");
  await expectVisibleText(page, "Çalıştırma kaynağı");
  await expectVisibleText(page, "Codex Çalıştırma Kaydı");
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

  markPhase("Hafiza sagligi uyarilarini kullanici seviyesinde dogrulama");
  await seedValidationCache(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expectVisibleText(page, "Proje Çalışma Merkezi");
  await page.keyboard.press("Control+K");
  await page.locator("[data-command-search]").fill("hafıza sağlığı");
  await page.locator('[data-command-id="view:health"]').click();
  await expectVisibleText(page, "Hafıza Sağlığı");
  await expectVisibleText(page, "inbox/missing-status.md");
  await expectVisibleText(page, "status alanı eksik");
  await expectVisibleText(page, "work_items/missing-id.md");
  await expectVisibleText(page, "id alanı eksik");
  await expectVisibleText(page, "inbox/malformed.md");
  await expectVisibleText(page, "bozuk frontmatter");
  await expectVisibleText(page, "inbox/duplicate-b.md");
  await expectVisibleText(page, "duplicate id");
  await page.keyboard.press("Control+K");
  await page.locator("[data-command-search]").fill("çalıştırıcı");
  await page.locator('[data-command-id="view:runner"]').click();
  await expectVisibleText(page, "Hafıza Senkron Durumu");
  await expectVisibleText(page, "Son GitHub senkronizasyonu");
  await expectVisibleText(page, "Yerel ayna");
  await expectVisibleText(page, "GitHub ile aynı");
  await expectVisibleText(page, "Kayıt yolları ve özet alanları eşleşiyor");

  markPhase("Hafiza senkron fark durumunu kullanici seviyesinde dogrulama");
  await seedValidationCache(page, { localChange: true });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expectVisibleText(page, "Proje Çalışma Merkezi");
  await page.keyboard.press("Control+K");
  await page.locator("[data-command-search]").fill("çalıştırıcı");
  await page.locator('[data-command-id="view:runner"]').click();
  await expectVisibleText(page, "Hafıza Senkron Durumu");
  await expectVisibleText(page, "Yerel değişiklik var");
  await expectVisibleText(page, "1 kayıt ayna içinde yok");
  await expectVisibleText(page, "Yerel önbellek ayna indeksinden daha yeni");
  await page.keyboard.press("Control+K");
  await page.locator("[data-command-search]").fill("proje çalışma");
  await page.locator('[data-command-id="view:workspace"]').click();
  await expectVisibleText(page, "GitHub hafıza senkronizasyonu");
  await expectVisibleText(page, "Yerel hafıza aynası indekslendi");

  const title = await electronApp.evaluate(({ BrowserWindow }) => {
    return BrowserWindow.getAllWindows()[0]?.getTitle();
  });
  assert.match(title || "", /^ctx-lab/);

  const screenshot = await page.screenshot({ fullPage: true });
  assertRenderedScreenshot(screenshot);

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
