# Seslog Desktop App — Runtime UI Test Kılavuzu

**Tarih:** 2026-02-26
**Hedef:** Bu belge, uygulamayı hiç görmemiş birinin sıfırdan çalıştırıp tüm ekranları test etmesini sağlar.
**Süre:** ~45-60 dakika
**Gerekli bilgi:** Terminal kullanımı (komut kopyala-yapıştır düzeyinde yeterli)

---

## Bölüm 0: Ortam Hazırlığı

### 0.1 Rust Kurulumu (zaten kuruluysa atla)

```bash
# Rust var mı kontrol et:
rustc --version

# Yoksa kur:
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

### 0.2 macOS Ek Gereksinim
```bash
# Xcode Command Line Tools (zaten kuruluysa "already installed" der):
xcode-select --install
```

### 0.3 Linux Ek Gereksinim (macOS'ta atla)
```bash
sudo apt install -y libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev
```

### 0.4 Projeyi Aç
```bash
cd /path/to/hooks   # projenin bulunduğu dizin
```

---

## Bölüm 1: Derleme ve Otomatik Testler

Bu adım uygulamanın derlenebildiğini ve 181 otomatik testin geçtiğini doğrular.

### 1.1 Derleme
```bash
cargo build -p seslog-app
```
**Beklenen:** Son satırda `Finished` yazısı, hata yok.

### 1.2 Testler
```bash
cargo test --workspace
```
**Beklenen:** Son satırlarda `test result: ok. X passed; 0 failed` — toplamda 181 test geçmeli.

### 1.3 Kod Kalitesi
```bash
cargo clippy --workspace -- -D warnings
```
**Beklenen:** `Finished` yazısı, hiç warning/error yok.

> Bu 3 komut başarılıysa, uygulama runtime testine hazır demektir.

---

## Bölüm 2: Test Verisi Hazırlama

Uygulama `~/.seslog/` dizinindeki dosyaları okur. Bu dizin boşsa uygulama "boş ekran" gösterir — bu da bir test durumudur (Bölüm 3.3'te test edeceğiz). Ama önce zengin test verisi oluşturalım.

### 2.1 Test Projesi Oluştur

Aşağıdaki komutları terminale yapıştır (tek seferde hepsini yapıştırabilirsin):

```bash
# Proje dizini
mkdir -p ~/.seslog/projects/test-alpha/sessions

# Proje meta bilgisi
cat > ~/.seslog/projects/test-alpha/meta.toml << 'EOF'
name = "test-alpha"
status = "active"
paths = ["/tmp/test-alpha"]
EOF

# 1. oturum (yakın tarihli, maliyetli)
cat > ~/.seslog/projects/test-alpha/sessions/session-001.json << 'EOF'
{
  "session_id": "session-001",
  "started_at": "2026-02-26T09:00:00Z",
  "ended_at": "2026-02-26T09:45:00Z",
  "machine": "macbook-pro",
  "duration_minutes": 45,
  "files_changed": 12,
  "summary": "Kullanici kimlik dogrulama sistemi eklendi.\nJWT token uretimi ve dogrulama middleware yazildi.\nLogin ve register API endpointleri olusturuldu.",
  "next_steps": "Sifre sifirlama akisi eklenecek.\nRate limiting implemente edilecek.",
  "transcript_highlights": ["JWT middleware yazildi", "Bcrypt ile sifre hashleme", "Integration testleri eklendi"],
  "model": "claude-sonnet-4-20250514",
  "token_count": 285000,
  "estimated_cost_usd": 1.42,
  "recovered": false
}
EOF

# 2. oturum (daha eski, dusuk maliyetli)
cat > ~/.seslog/projects/test-alpha/sessions/session-002.json << 'EOF'
{
  "session_id": "session-002",
  "started_at": "2026-02-25T14:00:00Z",
  "ended_at": "2026-02-25T14:20:00Z",
  "machine": "macbook-pro",
  "duration_minutes": 20,
  "files_changed": 3,
  "summary": "Proje yapisini olusturdum.\nCargo workspace kurulumu yapildi.",
  "next_steps": "Auth modulu yazilacak.",
  "transcript_highlights": ["Cargo.toml olusturuldu", "CI pipeline eklendi"],
  "model": "claude-haiku-4-5-20251001",
  "token_count": 45000,
  "estimated_cost_usd": 0.08,
  "recovered": false
}
EOF

# 3. oturum (kurtarilmis / recovered)
cat > ~/.seslog/projects/test-alpha/sessions/session-003.json << 'EOF'
{
  "session_id": "session-003",
  "started_at": "2026-02-24T10:00:00Z",
  "ended_at": "2026-02-24T10:10:00Z",
  "machine": "desktop-linux",
  "duration_minutes": 10,
  "files_changed": 1,
  "summary": "Kesilen oturum kurtarildi.",
  "next_steps": "",
  "transcript_highlights": [],
  "model": "claude-opus-4-20250514",
  "token_count": 12000,
  "estimated_cost_usd": 0.45,
  "recovered": true
}
EOF

# Yol haritasi (roadmap)
cat > ~/.seslog/projects/test-alpha/roadmap.md << 'EOF'
## Phase 1: Altyapi
- [x] Proje yapisini olustur {id: init}
- [x] CI/CD pipeline kur {id: ci, depends: init}

## Phase 2: Auth
- [x] JWT middleware yaz {id: jwt, depends: ci}
- [>] Login/Register API {id: auth-api, depends: jwt}
- [ ] Sifre sifirlama {id: reset, depends: auth-api}

## Phase 3: Test
- [ ] Integration testleri {id: tests, depends: auth-api}
- [~] E2E testleri {id: e2e, depends: tests}
- [!] Load testing {id: load, depends: e2e}
EOF
```

### 2.2 Arsivlenmis Proje Ekle

```bash
mkdir -p ~/.seslog/projects/eski-proje/sessions

cat > ~/.seslog/projects/eski-proje/meta.toml << 'EOF'
name = "eski-proje"
status = "archived"
paths = ["/tmp/eski-proje"]
EOF

cat > ~/.seslog/projects/eski-proje/sessions/session-001.json << 'EOF'
{
  "session_id": "eski-001",
  "started_at": "2026-01-15T08:00:00Z",
  "ended_at": "2026-01-15T08:30:00Z",
  "machine": "macbook-pro",
  "duration_minutes": 30,
  "files_changed": 5,
  "summary": "Eski projenin son oturumu.",
  "next_steps": "",
  "transcript_highlights": ["Final cleanup"],
  "model": "claude-sonnet-4-20250514",
  "token_count": 80000,
  "estimated_cost_usd": 0.35,
  "recovered": false
}
EOF
```

### 2.3 Dogrulama
```bash
ls ~/.seslog/projects/
# Beklenen: test-alpha  eski-proje
ls ~/.seslog/projects/test-alpha/sessions/
# Beklenen: session-001.json  session-002.json  session-003.json
```

---

## Bolum 3: Uygulamayi Calistir

```bash
cargo run -p seslog-app
```

**Beklenen:** 1200x800 piksel bir masaustu penceresi acilir. Koyu lacivert arkaplan (`#0f0f23`), solda sidebar, sagda Dashboard gorunumu.

> Pencere acildiktan sonra terminale donme — uygulama acik kalacak. Testleri pencere uzerinden yapacaksin. Bitirince pencereyi kapatabilir veya terminalde Ctrl+C yapabilirsin.

---

## Bolum 3: Testler

Her testin yaninda bir onay kutusu var. Testi yapip sonucu not et.

### 3.1 Ilk Acilis ve Pencere

| # | Test | Nasil | Beklenen | Sonuc |
|---|------|-------|----------|-------|
| 1 | Pencere boyutu | Gozle | Genis dikdortgen pencere (~1200x800) | [ ] |
| 2 | Pencere basligi | Pencere ust cubuguna bak | "Seslog" yaziyor | [ ] |
| 3 | Arkaplan rengi | Gozle | Koyu lacivert (neredeyse siyah), beyaz flas yok | [ ] |
| 4 | Genel gorunum | Gozle | Solda sidebar, sagda icerik alani | [ ] |

### 3.2 Sidebar

| # | Test | Nasil | Beklenen | Sonuc |
|---|------|-------|----------|-------|
| 5 | Logo | Sol ust koseye bak | "SL" ikonu + "Seslog" yazisi, mor gradient | [ ] |
| 6 | Dashboard butonu | Sidebar'da "Dashboard" yaz. + simge | Aktif (vurgulu), yaninda kucuk "1" badge'i | [ ] |
| 7 | Overview butonu | Sidebar'da "Overview" yazisi + simge | Yaninda kucuk "2" badge'i | [ ] |
| 8 | Settings butonu | Sidebar'da "Settings" yazisi + simge | Yaninda kucuk "3" badge'i | [ ] |
| 9 | Ayirici cizgiler | Dashboard ile Projects arasi | Ince yatay cizgi | [ ] |
| 10 | "Projects" etiketi | Ayiricinin altinda | BUYUK HARFLE "PROJECTS" yazisi, soluk renk | [ ] |
| 11 | Arama kutusu | "Projects" altinda | "Search projects..." placeholder'li input alani | [ ] |
| 12 | Proje listesi | Arama kutusunun altinda | "test-alpha" ve "eski-proje" gorunuyor, yanlarinda % degeri | [ ] |
| 13 | Tema degistirici | Sidebar'in en altinda | Ay ikonu + "Dark Mode" yazisi | [ ] |
| 14 | Sidebar scroll | 10+ proje varsa (yoksa atla) | Proje listesi bagimsiz olarak kayar | [ ] |

### 3.3 Sidebar Arama (Search)

| # | Test | Nasil | Beklenen | Sonuc |
|---|------|-------|----------|-------|
| 15 | Proje ara | Arama kutusuna "test" yaz | Sadece "test-alpha" gorunur, "eski-proje" kaybolur | [ ] |
| 16 | Buyuk/kucuk harf | "TEST" yaz | Yine "test-alpha" gorunur (buyuk/kucuk fark etmez) | [ ] |
| 17 | Sonuc yok | "asdfxyz" yaz | "No matches" yazisi gorunur | [ ] |
| 18 | Temizle | Arama kutusunu sil (hepsini sil) | Tum projeler tekrar gorunur | [ ] |
| 19 | Nav etkilenmiyor | Arama sirasinda | Dashboard, Overview, Settings hep gorunur | [ ] |
| 20 | Klavye cakismasi | Arama kutusuna "123" yaz | Sayfa DEGISMEMELI — sadece arama kutusunda "123" gorunur | [ ] |

### 3.4 Dashboard

| # | Test | Nasil | Beklenen | Sonuc |
|---|------|-------|----------|-------|
| 21 | Baslik | Sayfa ust kismi | "Dashboard" basligi | [ ] |
| 22 | Alt baslik | Basligin altinda | "2 active projects" veya "1 active project" (duzgun cogul) | [ ] |
| 23 | Hero kart | En buyuk kart | "test-alpha" en son aktif proje olarak buyuk kartta gorunur | [ ] |
| 24 | Hero kart icerik | Hero kartta | Proje adi, ozet, ilerleme cubugu, oturum sayisi, sure | [ ] |
| 25 | Hero kart tiklama | Hero karta tikla | Proje detay sayfasina gider | [ ] |
| 26 | "View Details" butonu | Hero kartta | Tikla — ayni sekilde proje detaya gider (cift navigasyon yok) | [ ] |
| 27 | Proje kartlari | Hero'nun altinda | Diger aktif projeler kucuk kartlarda | [ ] |
| 28 | Ilerleme cubugu rengi | Kartlardaki progress bar | Kirmizi (<=33%), turuncu (34-66%), yesil (>66%) | [ ] |
| 29 | Durum noktasi | Kart basliginda | Aktif = yesil, arsivlenmis = gri | [ ] |
| 30 | Arsivlenmis bolum | Sayfa altinda | "Archived" bolumunde "eski-proje" gorunur | [ ] |

Simdi Dashboard'a geri donmek icin sidebar'da "Dashboard"a tikla.

### 3.5 Overview Tablosu

| # | Test | Nasil | Beklenen | Sonuc |
|---|------|-------|----------|-------|
| 31 | Sayfaya git | Sidebar'da "Overview"a tikla | Tablo gorunumu acilir | [ ] |
| 32 | Tablo basliklari | Ust satir | Name, Last Activity, Progress, Sessions, Time, Cost | [ ] |
| 33 | Veri satiri | Tabloda | "test-alpha" satiri gorunur, bilgileriyle | [ ] |
| 34 | Siralama — Name | "Name" basligina tikla | Satirlar alfabetik siraya girer, ok isareti (↑ veya ↓) gorunur | [ ] |
| 35 | Siralama yonu | Ayni basliga tekrar tikla | Sira tersine doner (↑ ↔ ↓ degisir) | [ ] |
| 36 | Siralama — Cost | "Cost" basligina tikla | Maliyete gore siralama | [ ] |
| 37 | Aktif baslik vurgusu | Siralanan sutun | Baslik arka plani vurgulu (accent renk) | [ ] |
| 38 | Satir tiklama | Bir satira tikla | O projenin detay sayfasina gider | [ ] |
| 39 | "Include Archived" | Checkbox'i isle/isaretini kaldir | Arsivlenmis projeler gorunur/kaybolur | [ ] |
| 40 | Arsiv badge | Arsivlenmis satirda | Kucuk gri "archived" etiketi | [ ] |
| 41 | Maliyet sutunu | Tabloda | Yesil badge (<=\$1), turuncu badge (>\$1), veya "—" (sifir) | [ ] |
| 42 | Zaman formati | Last Activity sutunu | "Just now", "X min ago", "X hours ago", veya tarih | [ ] |

### 3.6 Proje Detay

| # | Test | Nasil | Beklenen | Sonuc |
|---|------|-------|----------|-------|
| 43 | Sayfaya git | Sidebar'da "test-alpha"ya tikla | Proje detay sayfasi acilir | [ ] |
| 44 | Breadcrumb | Sayfa ust kismi | "Dashboard > test-alpha" gorunur | [ ] |
| 45 | Breadcrumb tiklama | "Dashboard" yazisina tikla | Dashboard'a doner | [ ] |
| 46 | Geri don | Sidebar'dan tekrar "test-alpha"ya tikla | Proje detaya doner | [ ] |
| 47 | Eski geri butonu | Sayfada ara | "Back to Dashboard" butonu OLMAMALI — breadcrumb degistirdi | [ ] |
| 48 | Sayfa basligi | Ust kisim | "test-alpha" adi + yesil durum noktasi | [ ] |
| 49 | Iki sutun yerlesim | Gozle | Sol: roadmap + oturumlar. Sag: ilerleme + istatistik + aksiyonlar | [ ] |

**Roadmap (Sol Sutun — Ust):**

| # | Test | Nasil | Beklenen | Sonuc |
|---|------|-------|----------|-------|
| 50 | Faz basliklari | Roadmap bolumunde | "Phase 1: Altyapi", "Phase 2: Auth", "Phase 3: Test" | [ ] |
| 51 | Tamamlanan ogeler | [x] ogeler | Dolu checkbox + ustu cizili yazi | [ ] |
| 52 | Aktif oge | [>] ogesi | Aktif gorunum | [ ] |
| 53 | Bekleyen ogeler | [ ] ogeler | Bos checkbox | [ ] |
| 54 | Askiya alinan | [~] ogesi | Gorunur | [ ] |
| 55 | Engellenmis | [!] ogesi | Gorunur | [ ] |
| 56 | Bagimlilik girintisi | depends olan ogeler | Saga girintili gorunur | [ ] |
| 57 | ID badge'leri | Her ogede | `[init]`, `[ci]`, `[jwt]` gibi monospace etiketler | [ ] |

**Son Oturumlar (Sol Sutun — Alt):**

| # | Test | Nasil | Beklenen | Sonuc |
|---|------|-------|----------|-------|
| 58 | Timeline | "Recent Sessions" bolumu | Son 5 oturum (bizde 3 var) listeli | [ ] |
| 59 | Timeline noktalar | Her oturumun solunda | Kucuk renkli daire | [ ] |
| 60 | Oturum bilgileri | Her satirda | Tarih, makine, sure, dosya sayisi, maliyet badge | [ ] |
| 61 | Oturum tiklama | Bir oturuma tikla | Oturum detay sayfasina gider | [ ] |

**Sag Sutun:**

| # | Test | Nasil | Beklenen | Sonuc |
|---|------|-------|----------|-------|
| 62 | Ilerleme kahraman | Sag ust | Buyuk yuzde sayisi (ornegin "60%"), altinda "3 of 5 tasks" | [ ] |
| 63 | Ilerleme cubugu | Yuzdenin altinda | Renkli cubuk, yuzdeyle uyumlu | [ ] |
| 64 | Istatistik paneli | Orta sag | 4 kutu: Total Sessions (3), Time Invested, Last Machine, Last Active | [ ] |
| 65 | Toplam maliyet | Istatistik altinda | CostBadge ile toplam ($1.95 civari — 3 oturumun toplami) | [ ] |
| 66 | "Open in VS Code" | Buton tikla | Toast mesaji gorunur (basari veya hata) | [ ] |
| 67 | "Rebuild Cache" | Buton tikla | Toast mesaji: "Rebuild complete: X added, Y removed, Z updated" | [ ] |

### 3.7 Oturum Detay

| # | Test | Nasil | Beklenen | Sonuc |
|---|------|-------|----------|-------|
| 68 | Sayfaya git | Proje detayda bir oturuma tikla | Oturum detay sayfasi acilir | [ ] |
| 69 | Breadcrumb | Sayfa ust kismi | "Dashboard > test-alpha > Kullanici kimlik dogrulama..." | [ ] |
| 70 | Breadcrumb tiklama | "test-alpha"ya tikla | Proje detaya doner | [ ] |
| 71 | Breadcrumb tiklama 2 | "Dashboard"a tikla | Dashboard'a doner. Sonra oturuma geri don | [ ] |
| 72 | Eski geri butonu | Sayfada ara | "Back to Project" butonu OLMAMALI | [ ] |
| 73 | Sayfa basligi | Ust kisim | Ozetin ilk satiri baslik, altinda tarih | [ ] |
| 74 | Meta grid | 6 kart | Date, Machine, Duration, Files Changed, Model, Recovered | [ ] |
| 75 | Recovered degeri | Meta grid'de | session-001: "No", session-003: "Yes" | [ ] |
| 76 | Maliyet paneli | Glass panel | Token sayisi (285.0K gibi), tahmini maliyet ($1.42), model adi | [ ] |
| 77 | Token formati | Maliyet panelinde | 285000 → "285.0K", 12000 → "12.0K" | [ ] |
| 78 | Ozet bolumu | "Summary" basligi | Cok satirli ozet, bosluklar korunmus (satir atlama gorunur) | [ ] |
| 79 | Sonraki adimlar | "Next Steps" basligi | Varsa gorunur, yoksa bolum gizli | [ ] |
| 80 | Onemli noktalar | "Transcript Highlights" | Her biri ayri bir kartta, stil uygulanmis | [ ] |

### 3.8 Settings Sayfasi

| # | Test | Nasil | Beklenen | Sonuc |
|---|------|-------|----------|-------|
| 81 | Sayfaya git | Sidebar'da "Settings"e tikla | Ayarlar sayfasi acilir | [ ] |
| 82 | Gizlilik modu | Dropdown | "Full" / "Summary Only" / "Metadata Only" — degistirince toast cikar | [ ] |
| 83 | Sirlari temizle | Toggle switch | Tiklayinca kayar, toast cikar ("Sanitize setting updated.") | [ ] |
| 84 | Checkpoint | Deger | "10 min" gibi monospace yazi (salt okunur) | [ ] |
| 85 | Hook durumu | Durum satiri | Yesil nokta + "Hook installed" VEYA gri nokta + "Hook not detected" | [ ] |
| 86 | Run Doctor | Butona tikla | Toast cikar (basari veya hata mesaji) | [ ] |
| 87 | Reinstall Hook | Butona tikla | Toast cikar | [ ] |
| 88 | Sync durumu | Sync bolumu | Git repo durumu, makine bilgisi (hostname, platform, arch) | [ ] |
| 89 | Rebuild Cache | Butona tikla | Toast: "Rebuild complete: X added, Y removed, Z updated" | [ ] |
| 90 | Support Bundle | "Generate Bundle" tikla | Toast: "Bundle saved: /path/to/file.zip" veya hata | [ ] |
| 91 | Toast gorunumu | Herhangi bir aksiyonda | Sag ustten kayarak gelir, yesil/kirmizi/mavi kenarlk | [ ] |

### 3.9 Toast Bildirimleri

| # | Test | Nasil | Beklenen | Sonuc |
|---|------|-------|----------|-------|
| 92 | Basari toast | Settings'te bir degisiklik yap | Yesil kenarlkli toast, sag usttan kayarak gelir | [ ] |
| 93 | Otomatik kapanma | Toast cikar ciktiktan sonra bekle | ~3 saniye sonra otomatik kaybolur | [ ] |
| 94 | Manuel kapanma | Toast'un X butonuna tikla | Hemen kaybolur | [ ] |
| 95 | Birden fazla toast | Hizlica 2-3 aksiyon yap | Toastlar ust uste yigilir | [ ] |
| 96 | Cam efekti | Toast arka planina bak | Yari saydam, bulaniklik (blur) efekti | [ ] |

### 3.10 Tema Degistirme

| # | Test | Nasil | Beklenen | Sonuc |
|---|------|-------|----------|-------|
| 97 | Acik temaya gec | Sidebar altinda ay ikonuna tikla | Tum uygulama acik temaya gecer (beyaz/gri arka plan) | [ ] |
| 98 | Buton degisimi | Tema butonu | Gunes ikonu + "Light Mode" yazisina donusur | [ ] |
| 99 | Sidebar acik tema | Sidebar | Beyaz arkaplan, hafif golge | [ ] |
| 100 | Kartlar acik tema | Dashboard kartlari | Beyaz/saydam, bulaniklik yok, hafif golge | [ ] |
| 101 | Metin okunabilirligi | Tum sayfalari gez | Tum yazilar acik temada okunabilir, kontrast yeterli | [ ] |
| 102 | Geri don | Tema butonuna tekrar tikla | Koyu temaya doner | [ ] |
| 103 | Toast acik tema | Acik temada bir toast tetikle | Toast okunabilir ve stilli | [ ] |

### 3.11 Klavye Kisayollari

| # | Test | Nasil | Beklenen | Sonuc |
|---|------|-------|----------|-------|
| 104 | Onkosul | Uygulama penceresine tikla | Pencerenin focus'ta oldugunu dogrula | [ ] |
| 105 | Tus "1" | Klavyede 1'e bas | Dashboard'a gider | [ ] |
| 106 | Tus "2" | Klavyede 2'ye bas | Overview'a gider | [ ] |
| 107 | Tus "3" | Klavyede 3'e bas | Settings'e gider | [ ] |
| 108 | Escape — Oturum | Once bir oturum detaya git, sonra Escape'e bas | Proje detaya doner | [ ] |
| 109 | Escape — Proje | Proje detaydayken Escape'e bas | Dashboard'a doner | [ ] |
| 110 | Escape — Dashboard | Dashboard'dayken Escape'e bas | Hicbir sey degismez (zaten en ust seviye) | [ ] |
| 111 | Hint badge'leri | Sidebar nav ogelerine bak | Her birinde kucuk "1", "2", "3" badge'i gorunur | [ ] |

### 3.12 Skeleton Yukleme Durumlari

> NOT: Skeleton'lar veri yuklenirken gorunur. Yerel SQLite'tan veri cok hizli gelecegi icin skeleton'lar sadece anlk gorunebilir. Goremezsen, bu normaldir — asil test pattern'in dogru oldugunu dogrulamaktir.

| # | Test | Nasil | Beklenen | Sonuc |
|---|------|-------|----------|-------|
| 112 | Dashboard | Dashboard'a git | Kisa bir an shimmer (parildama) gorunebilir, sonra icerik | [ ] |
| 113 | Proje Detay | Proje detaya git | Kisa bir an shimmer gorunebilir | [ ] |
| 114 | Oturum Detay | Oturum detaya git | Kisa bir an shimmer gorunebilir | [ ] |
| 115 | Overview | Overview'a git | Kisa bir an shimmer gorunebilir | [ ] |
| 116 | Bos ekran yok | Sayfa degisimlerinde | Icerik gorunmeden once BOS BEYAZ EKRAN OLMAMALI | [ ] |

### 3.13 Dosya Izleyici (Watcher) Reaktivitesi

| # | Test | Nasil | Beklenen | Sonuc |
|---|------|-------|----------|-------|
| 117 | Yeni oturum ekle | Uygulama ACIKKEN terminalde asagidaki komutu calistir (altta) | Dashboard ve proje detay ~1 saniye icinde guncellenir | [ ] |
| 118 | Roadmap guncelle | Uygulama ACIKKEN roadmap.md'yi duzenle (altta) | Proje detayda ilerleme yuzddesi degisir | [ ] |

**Test 117 icin komutu terminale yapistir (uygulama acikken):**
```bash
cat > ~/.seslog/projects/test-alpha/sessions/session-004.json << 'EOF'
{
  "session_id": "session-004",
  "started_at": "2026-02-26T15:00:00Z",
  "ended_at": "2026-02-26T15:30:00Z",
  "machine": "macbook-pro",
  "duration_minutes": 30,
  "files_changed": 8,
  "summary": "Canli test sirasinda eklenen oturum.",
  "next_steps": "Daha fazla test yap.",
  "transcript_highlights": ["Canli ekleme testi"],
  "model": "claude-sonnet-4-20250514",
  "token_count": 150000,
  "estimated_cost_usd": 0.75,
  "recovered": false
}
EOF
```

**Test 118 icin — roadmap'te bir ogeyi tamamla:**
```bash
sed -i '' 's/\[>\] Login\/Register API/[x] Login\/Register API/' ~/.seslog/projects/test-alpha/roadmap.md
```

### 3.14 Responsive Davranis

| # | Test | Nasil | Beklenen | Sonuc |
|---|------|-------|----------|-------|
| 119 | Pencere daralt <768px | Pencereyi yatayda daralt | Sidebar cokuyor (60px yukseklik), icerik tekil sutuna donuyor | [ ] |
| 120 | Sidebar hover | Daraltilmis sidebar uzerine gel | Sidebar genisler, icerik gorunur | [ ] |
| 121 | Overview dar | Overview tablosunda | Tablo yatay kaydirilabilir | [ ] |
| 122 | Proje detay dar | Proje detayda | Iki sutun teke donuyor | [ ] |
| 123 | Pencere geniset | Pencereyi tekrar genislet | Normal yerlseim geri gelir | [ ] |

### 3.15 Bos Durum Testi

| # | Test | Nasil | Beklenen | Sonuc |
|---|------|-------|----------|-------|
| 124 | Uygulamayi kapat | Pencereyi kapat veya Ctrl+C | Uygulama kapanir | [ ] |
| 125 | Verileri tasi | `mv ~/.seslog ~/.seslog-backup` | Veri dizini gecici olarak kaldirilir | [ ] |
| 126 | Tekrar ac | `cargo run -p seslog-app` | Uygulama acilir | [ ] |
| 127 | Bos Dashboard | Dashboard'a bak | Klasor ikonu + "No Projects Yet" mesaji | [ ] |
| 128 | Bos Overview | Overview'a git | Liste ikonu + "No Projects" mesaji | [ ] |
| 129 | Verileri geri al | Uygulamayi kapat, `mv ~/.seslog-backup ~/.seslog` | Veri geri gelir | [ ] |

---

## Bolum 4: Test Raporu

Testleri tamamladindan sonra asagidaki ozet tablosunu doldur:

| Bolum | Toplam Test | Gecen | Kalan |
|-------|-------------|-------|-------|
| 3.1 Ilk Acilis | 4 | | |
| 3.2 Sidebar | 10 | | |
| 3.3 Arama | 6 | | |
| 3.4 Dashboard | 10 | | |
| 3.5 Overview | 12 | | |
| 3.6 Proje Detay | 25 | | |
| 3.7 Oturum Detay | 13 | | |
| 3.8 Settings | 11 | | |
| 3.9 Toast | 5 | | |
| 3.10 Tema | 7 | | |
| 3.11 Klavye | 8 | | |
| 3.12 Skeleton | 5 | | |
| 3.13 Watcher | 2 | | |
| 3.14 Responsive | 5 | | |
| 3.15 Bos Durum | 6 | | |
| **TOPLAM** | **129** | | |

### Basarisiz Test Detaylari

Her basarisiz test icin:

| Test # | Aciklama | Beklenen | Gerceklesen | Ekran Goruntusu? |
|--------|----------|----------|-------------|------------------|
| | | | | |

---

## Bolum 5: Temizlik

Testler bittikten sonra test verilerini temizlemek istersen:

```bash
# Test projelerini sil
rm -rf ~/.seslog/projects/test-alpha
rm -rf ~/.seslog/projects/eski-proje

# Veya tum seslog verisini sil (DIKKAT: gercek verini de siler)
# rm -rf ~/.seslog
```

---

*Bu kilavuz, 5 round statik kod analizi sonrasinda "production beta'ya hazir" onayini almis Seslog uygulamasinin runtime dogrulamasi icindir.*
