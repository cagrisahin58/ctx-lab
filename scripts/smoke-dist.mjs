import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const root = process.cwd();
const dist = join(root, "dist");
const indexPath = join(dist, "index.html");

assert.ok(existsSync(indexPath), "dist/index.html bulunamadi. Once `npm run build` calistir.");

const html = readFileSync(indexPath, "utf8");
assert.match(html, /<html lang="tr">/, "HTML dili Turkce olmali.");
assert.match(html, /ctx-lab/, "HTML basligi ctx-lab icermeli.");

const rawAssetMatches = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((match) => match[1]);
assert.ok(
  rawAssetMatches.every((asset) => !asset.startsWith("/")),
  "Build asset yollari Electron file:// icin goreli olmali."
);
const assetMatches = rawAssetMatches.map((asset) =>
  asset.replace(/^\.\//, "").replace(/^\//, "")
);
assert.ok(assetMatches.some((asset) => asset.endsWith(".js")), "Build JS asseti bulunamadi.");
assert.ok(assetMatches.some((asset) => asset.endsWith(".css")), "Build CSS asseti bulunamadi.");

const assets = Object.fromEntries(
  assetMatches.map((asset) => [asset, readFileSync(join(dist, asset), "utf8")])
);
const bundleText = Object.values(assets).join("\n");

for (const expected of [
  "Oturum Akisi",
  "Proje Calisma Merkezi",
  "Komut Paleti",
  "Temayi Degistir",
  "Kisayollar",
  "Ayarlar",
  "Baglanti",
  "Gorunum",
  "Tema Durumu",
  "Kisayol Haritasi",
  "Klavye Akisi",
  "Hafiza Sagligi",
  "Hafiza Uyarilari",
  "yasam dongusu",
  "arsiv onerileri",
  "Hafiza Senkron Durumu",
  "Kisa Kurulum",
  "GitHub hafiza reposu",
  "Codex CLI Kontrolu",
  "Ornek Devam Brifi",
  "Is Akisi",
  "Karar Defteri",
  "Karar Detayi",
  "Devam Brifi",
  "Paket icerigi",
  "Tahmini token",
  "Baglantiyi Tanila",
  "Gunluk Devam Brifi",
  "Yerel onbellek",
  "Yeni Is Hatti",
  "Yeni Karar",
  "Devam brifi hedefi",
  "Devam Brifini Kopyala",
  "Yerel Codex Runner",
  "Yerel Memory Mirror",
  "Mirror Yenile",
  "Calisma Gunlugu",
  "Codex'e Devret",
  "Run Kaniti",
  "Test sonucu",
  "Git baslangic",
  "Git sonuc",
  "Commit + push icin ayri onay verdim",
  "Run sonucunu secili is hattina bagla",
  "Akilli eslesme",
  "Onerilen Ise Bagla",
  "Tokeni goster",
  "Token nasil uretilir",
  "Read and write",
  "GitHub token ekranini ac",
  "GitHub hafiza reposu disaridan guncellendi",
  "J K",
  "Akilli eslesmeye bagla",
  "A / Backspace",
  "Listedeki kaydi degistir",
  "Secili oturumu arsivleme onayi",
  "Arsivi Onayla",
  "Proje Koku",
  "Oturum Kapanis"
]) {
  assert.ok(normalizeTurkish(bundleText).includes(expected), `UI metni eksik: ${expected}`);
}

assert.ok(bundleText.includes("github.com") || bundleText.includes("api.github.com"), "GitHub istemci izi bulunamadi.");
assert.ok(!/Seslog|seslog/i.test(bundleText), "Legacy Seslog metni build icinde kalmamali.");
assert.ok(bundleText.includes("timelineIn"), "Timeline giris animasyonu bundle icinde olmali.");
assert.ok(bundleText.includes("activityPulse"), "Run/activity hareket sinyali bundle icinde olmali.");
assert.ok(bundleText.includes("prefers-reduced-motion"), "Dusuk hareket tercihi CSS icinde desteklenmeli.");

console.log("dist smoke ok");

function normalizeTurkish(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/İ/g, "I")
    .replace(/ğ/g, "g")
    .replace(/Ğ/g, "G")
    .replace(/ü/g, "u")
    .replace(/Ü/g, "U")
    .replace(/ş/g, "s")
    .replace(/Ş/g, "S")
    .replace(/ö/g, "o")
    .replace(/Ö/g, "O")
    .replace(/ç/g, "c")
    .replace(/Ç/g, "C");
}
