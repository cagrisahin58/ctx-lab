# ctx-lab — FAZ D: Polish + Açık Kaynak Release

> **Tahmini süre:** 2-3 hafta  
> **Bağımlılık:** Faz A + B tamamlanmış olmalı. Faz C isteğe bağlı.  
> **Teslimat:** Public GitHub repo, downloadable binary'ler, dokümentasyon, auto-update  
> **Bu faz sonunda:** Herhangi biri GitHub'dan ctx-lab'ı indirip 10 dakikada kurabilir.

---

## 1. Faz Hedefi

Ürünü "benim bilgisayarımda çalışıyor"dan "herkesin bilgisayarında çalışıyor"a taşımak. Code signing, auto-update, dokümentasyon, edge case testleri, CI/CD.

---

## 2. Code Signing & Distribution

### 2.1 macOS

```
Gereksinimler:
  - Apple Developer Program üyeliği ($99/yıl)
  - Developer ID Application certificate
  - Notarization (Apple'ın malware taraması)

Build pipeline:
  1. cargo build --release (Tauri)
  2. codesign --deep --force --verify --verbose --sign "Developer ID Application: ..." target/release/ctx-lab.app
  3. xcrun notarytool submit ctx-lab.dmg --apple-id ... --password ... --team-id ...
  4. xcrun stapler staple ctx-lab.dmg
```

**İmzasız alternatif (v1 hızlı release için):**
- macOS Gatekeeper uyarısı gösterir: "Apple tarafından doğrulanamadı"
- Kullanıcı System Preferences → Security'den izin verebilir
- README'de açıkça belirt: "Code signing yok, uyarıyı nasıl geçersiniz: ..."
- Code signing Phase D+1'de eklenebilir

### 2.2 Windows

```
Gereksinimler:
  - Code signing certificate (Sectigo, DigiCert vb. ~$200-400/yıl)
  - VEYA: imzasız (SmartScreen uyarısı gösterir)

Build pipeline:
  1. cargo build --release --target x86_64-pc-windows-msvc (Tauri)
  2. signtool sign /f certificate.pfx /p password /tr http://timestamp... ctx-lab.exe
```

**İmzasız alternatif (v1):**
- Windows SmartScreen uyarısı: "Windows protected your PC"
- Kullanıcı "More info → Run anyway" ile geçebilir
- README'de belirt

### 2.3 Dağıtım Kanalları

| Kanal | Platform | Öncelik |
|-------|----------|---------|
| GitHub Releases | Her ikisi | P0 — ana dağıtım |
| Homebrew tap | macOS | P1 — `brew install ctx-lab/tap/ctx-lab` |
| Scoop bucket | Windows | P1 — `scoop install ctx-lab` |
| crates.io | Hook binary | P2 — `cargo install ctx-lab-hook` |
| AUR | Linux (gelecek) | P3 |

---

## 3. Auto-Update (Tauri Updater)

Tauri v2 built-in updater kullanılır:

```json
// tauri.conf.json
{
  "plugins": {
    "updater": {
      "active": true,
      "dialog": true,
      "endpoints": [
        "https://github.com/cagri/ctx-lab/releases/latest/download/latest.json"
      ],
      "pubkey": "..."
    }
  }
}
```

**Update akışı:**
1. Uygulama açılışında endpoint'i kontrol et
2. Yeni versiyon varsa dialog göster: "ctx-lab v0.2.0 mevcut. Güncelle?"
3. Kullanıcı onaylarsa arka planda indir + yükle
4. Uygulama yeniden başlatılır

**Hook binary güncelleme:**
- ctx-lab-hook binary Tauri app bundle'ı içinde dağıtılır
- App güncellenince hook binary de güncellenir
- `ctx-lab-hook install` yeniden çalıştırılır (idempotent)
- Versiyon uyumsuzluğu: app başlangıcında `ctx-lab-hook --version` kontrol edilir, uyumsuzsa uyarı

---

## 4. CI/CD Pipeline (GitHub Actions)

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags: ['v*']

jobs:
  build-macos:
    runs-on: macos-latest
    strategy:
      matrix:
        target: [aarch64-apple-darwin, x86_64-apple-darwin]
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.target }}
      - uses: pnpm/action-setup@v2
      - run: cd frontend && pnpm install && pnpm build
      - run: cargo build --release --target ${{ matrix.target }} -p ctx-lab-hook
      - uses: tauri-apps/tauri-action@v0
        # ... Tauri build + bundle

  build-windows:
    runs-on: windows-latest
    steps:
      # ... benzer

  create-release:
    needs: [build-macos, build-windows]
    runs-on: ubuntu-latest
    steps:
      - uses: softprops/action-gh-release@v2
        with:
          files: |
            target/release/ctx-lab-hook-*
            target/release/bundle/*

  # Smoke test: install → simulate hook → verify output
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [macos-latest, windows-latest]
    steps:
      - run: cargo test --workspace
      - run: ./target/release/ctx-lab-hook doctor
```

---

## 5. Edge Case & Stability Tests

### 5.1 Uzun Oturum Testi

```
Senaryo: 8 saat kesintisiz Claude Code oturumu
Beklenti:
  - 48 checkpoint (10dk aralık)
  - SessionEnd'de tüm checkpoint'ler merge edilir
  - Oturum logu 1 dosya, checkpoint dosyaları temizlenir
  - Transcript parsing 30sn timeout'u aşmaz (tail-read)
```

### 5.2 Büyük Proje Testi

```
Senaryo: 50+ oturum, 500+ checkpoint (simülasyon)
Beklenti:
  - Dashboard 2 saniyede yüklenir
  - SQLite sorguları 100ms altında
  - git status 5 saniye altında
  - Proje detay ekranı 1 saniyede açılır
```

### 5.3 Hızlı Proje Değiştirme

```
Senaryo: 5 dakikada 3 farklı projede Claude Code aç-kapat
Beklenti:
  - Her proje için ayrı session log
  - Dashboard'da 3 farklı güncelleme
  - Checkpoint debounce doğru çalışıyor (proje bazlı)
```

### 5.4 Network Kesintisi

```
Senaryo: Oturum sırasında internet kesilir, 1 saat sonra geri gelir
Beklenti:
  - Offline queue'da commit birikir
  - Bağlantı gelince push yapılır
  - Veri kaybı yok
```

### 5.5 Concurrent Sessions

```
Senaryo: Aynı projede 3 Claude Code oturumu aynı anda
Beklenti:
  - 3 ayrı session log üretilir
  - CLAUDE.md last-write-wins (kırılmaz)
  - roadmap.md file lock çalışıyor (lock alınamazsa skip)
  - Dashboard'da 3 aktif oturum görünür
```

### 5.6 Chaos Scenarios

| Senaryo | Beklenti |
|---------|----------|
| Yarım yazılmış JSON (kill -9 sırasında) | Quarantine'e taşınır, UI uyarı gösterir |
| cache.db silinir | Startup'ta otomatik rebuild |
| .ctx dosyası silinir | Sonraki SessionStart'ta yeni UUID, yeni proje kaydı |
| Git repo bozuk (detached HEAD) | Sync error state, "Manual fix" butonu |
| 10GB transcript dosyası | Tail-read çalışır, tüm dosya okunmaz |
| settings.json bozulursa | Doctor uyarı verir, backup'tan restore önerir |

---

## 6. Dokümentasyon

### 6.1 README.md

```markdown
# ctx-lab

> Stop losing your train of thought across research projects and machines.
> Resume any project in seconds using your AI coding sessions.

## Quick Start (5 dakika)

### 1. İndir
macOS: `brew install ctx-lab/tap/ctx-lab`
Windows: [GitHub Releases'ten indir](...)

### 2. Hook'ları kur
```bash
ctx-lab-hook install
```

### 3. Çalışmaya başla
Claude Code'da herhangi bir projede çalış. ctx-lab otomatik takip eder.

### 4. Dashboard'u aç
System tray'den veya `ctx-lab` komutuyla.

## Özellikler
- 🔄 Otomatik oturum takibi (Claude Code hook'ları)
- 📊 Proje dashboard'u (ilerleme, roadmap, oturum geçmişi)
- 🔐 Gizlilik modları (metadata-only / summary-only / full)
- 💾 Git-based sync (cross-machine, opsiyonel)
- 🛡️ Crash recovery (üç katmanlı heartbeat)
- 📝 Roadmap yönetimi (markdown tabanlı)

## Gizlilik
ctx-lab oturum özetlerini ve proje durumunu saklar.
API anahtarları ve hassas bilgiler otomatik olarak temizlenir.
Detaylar: [Privacy](docs/privacy.md)

## Dokümantasyon
- [Kurulum Kılavuzu](docs/installation.md)
- [Yapılandırma](docs/configuration.md)
- [Mimari](docs/architecture.md)
- [Katkı Kılavuzu](CONTRIBUTING.md)
```

### 6.2 CONTRIBUTING.md

```markdown
# Katkı Kılavuzu

## Geliştirme Ortamı

### Gereksinimler
- Rust 1.75+ (rustup ile)
- Node.js 20+ (frontend)
- pnpm
- Tauri v2 CLI: `cargo install tauri-cli@^2`

### Kurulum
```bash
git clone https://github.com/cagri/ctx-lab
cd ctx-lab
cd frontend && pnpm install && cd ..
cargo build --workspace
```

### Çalıştırma
```bash
# Sadece hook binary
cargo run -p ctx-lab-hook -- doctor

# Tauri app (dev mode)
cargo tauri dev

# Testler
cargo test --workspace
```

### Proje Yapısı
- `crates/ctx-lab-core/` — paylaşılan kütüphane
- `crates/ctx-lab-hook/` — CLI hook binary
- `crates/ctx-lab-app/` — Tauri masaüstü uygulaması
- `frontend/` — React frontend

### Katkı Süreci
1. Issue aç veya mevcut issue'yu sahiplen
2. Feature branch oluştur
3. Test yaz
4. PR aç
```

### 6.3 docs/ dizini

```
docs/
├── installation.md          ← platform bazlı kurulum
├── configuration.md         ← config.toml referansı
├── privacy.md              ← gizlilik modları, sanitization detayı
├── architecture.md         ← mimari genel bakış (dokümanların özeti)
├── hooks.md                ← Claude Code hook detayları
├── sync.md                 ← Git sync kurulumu, conflict çözümü
└── troubleshooting.md      ← yaygın sorunlar ve çözümler
```

---

## 7. Observability (Logging + Support Bundle)

### 7.1 Yapılandırılabilir Log Seviyeleri

```toml
# config.toml
[logging]
level = "info"               # "trace" | "debug" | "info" | "warn" | "error"
file = "~/.ctx-lab/logs/ctx-lab.log"
max_size_mb = 10
max_files = 5                # rotasyon: 5 dosya x 10MB
```

### 7.2 Support Bundle Export

```bash
ctx-lab-hook support-bundle
# Çıktı: ~/.ctx-lab/support-bundle-20260219.zip
# İçerik:
#   - Son 200 log satırı
#   - config.toml (secret'lar maskeli)
#   - Sync state
#   - SQLite schema version
#   - Son 10 event ID'si
#   - Doctor çıktısı
#   - Quarantine dizini listesi (dosya içerikleri hariç)
#   - OS + Rust + Tauri versiyon bilgisi
```

---

## 8. GitHub Pages Web Sitesi

Basit landing page:

```
ctx-lab.dev (veya GitHub Pages)
├── Hero: "Resume any project in 5 seconds"
├── Demo GIF (30 saniye)
├── 3 özellik kartı
├── Download butonları (macOS / Windows)
├── "Open Source — MIT License"
└── GitHub linki
```

Teknoloji: Astro veya sadece HTML+Tailwind (minimal).

---

## 9. Release Checklist

### Pre-Release

- [ ] Tüm golden fixture testler geçiyor
- [ ] Edge case testler geçiyor (§5)
- [ ] macOS build çalışıyor (aarch64 + x86_64)
- [ ] Windows build çalışıyor
- [ ] `ctx-lab-hook install` → `doctor` → sağlıklı
- [ ] Onboarding wizard çalışıyor (Faz C varsa)
- [ ] Auto-update endpoint hazır
- [ ] README.md güncel
- [ ] CONTRIBUTING.md güncel
- [ ] LICENSE (MIT) dosyası var
- [ ] CHANGELOG.md (ilk versiyon notları)

### Release

- [ ] Git tag: `v0.1.0`
- [ ] GitHub Actions release pipeline tetiklendi
- [ ] macOS binary'ler GitHub Releases'ta
- [ ] Windows binary'ler GitHub Releases'ta
- [ ] Homebrew tap güncellendi
- [ ] Web sitesi güncellendi

### Post-Release

- [ ] Hacker News / Reddit paylaşımı
- [ ] Claude Code community'de paylaşım
- [ ] İlk kullanıcı geri bildirimlerini topla (GitHub Issues)
- [ ] D7 retention takibi başlat

---

## 10. Faz D Çıkış Kriterleri

| Kriter | Detay |
|--------|-------|
| ✅ GitHub public repo | MIT lisansı, README, CONTRIBUTING |
| ✅ Binary'ler | macOS (aarch64 + x86_64) + Windows indirilebilir |
| ✅ CI/CD | Push-to-tag → otomatik release |
| ✅ Auto-update | Tauri updater çalışıyor |
| ✅ Dokümentasyon | 10 dakikada kurulum yapılabilir |
| ✅ Edge case testler | 6 senaryo geçiyor |
| ✅ Support bundle | `ctx-lab-hook support-bundle` çalışıyor |
| ✅ Logging | Yapılandırılabilir log + rotasyon |
| ✅ Web sitesi | Landing page + download linkleri |

---

*Bu doküman Faz D'nin tam spesifikasyonudur. Faz A+B (ve isteğe bağlı C) tamamlandıktan sonra release hazırlığına geçilir.*
