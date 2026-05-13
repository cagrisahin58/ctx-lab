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

const assetMatches = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((match) =>
  match[1].replace(/^\//, "")
);
assert.ok(assetMatches.some((asset) => asset.endsWith(".js")), "Build JS asseti bulunamadi.");
assert.ok(assetMatches.some((asset) => asset.endsWith(".css")), "Build CSS asseti bulunamadi.");

const assets = Object.fromEntries(
  assetMatches.map((asset) => [asset, readFileSync(join(dist, asset), "utf8")])
);
const bundleText = Object.values(assets).join("\n");

for (const expected of [
  "AI Inbox",
  "Is Panosu",
  "Karar Defteri",
  "Handoff",
  "Baglantiyi Tanila",
  "Gunluk Brif",
  "Yerel onbellek",
  "Yeni Is Hatti",
  "Yeni Karar",
  "Handoff hedefi",
  "Context Pack",
  "Oturum Kapanis"
]) {
  assert.ok(normalizeTurkish(bundleText).includes(expected), `UI metni eksik: ${expected}`);
}

assert.ok(bundleText.includes("github.com") || bundleText.includes("api.github.com"), "GitHub istemci izi bulunamadi.");
assert.ok(!/Seslog|seslog/i.test(bundleText), "Legacy Seslog metni build icinde kalmamali.");

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
