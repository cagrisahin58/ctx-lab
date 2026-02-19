# ctx-lab — FAZ C: Multi-Machine Sync + Onboarding

> **Tahmini süre:** 1-2 hafta  
> **Bağımlılık:** Faz A + B tamamlanmış olmalı  
> **Teslimat:** Git-based cross-machine senkronizasyon, onboarding wizard  
> **Bu faz sonunda:** MacBook'ta çalış → Windows'a geç → ctx-lab'da MacBook'taki son oturumu gör.

---

## 1. Faz Hedefi

İki makinede ctx-lab kurulu, aynı GitHub repo'ya bağlı. Birinde oturum tamamlanınca diğerinde güncelleme görünüyor.

**Tasarım prensibi:** Tek kullanıcı, private repo. Over-engineering yapma. Conflict olursa kullanıcı terminalden çözer.

---

## 2. Sync Mekanizması — Minimal

State machine, offline queue, retry backoff yok. Sadece:

### 2.1 Uygulama Açılışında (pull)

```rust
pub fn sync_on_startup(repo_path: &Path) -> Result<SyncResult> {
    // 1. Remote var mı kontrol et (yoksa → local-only, skip)
    // 2. git pull --rebase || git pull --no-rebase (config'e göre)
    //    → Başarılı → SQLite incremental rebuild → return Ok
    //    → Conflict → log yaz, UI'da uyarı göster:
    //      "Sync conflict var. Terminalde çözmek için: cd ~/.ctx-lab && git status"
    //    → Network hatası → log yaz, sessizce devam et (offline mode)
    // 3. Sonuç döndür
}

pub enum SyncResult {
    Synced,
    LocalOnly,          // remote yok
    Offline,            // network yok, sessizce devam
    ConflictNeedsManualFix(String),  // kullanıcıya mesaj göster
}
```

### 2.2 Oturum Bittiğinde (push)

Session-end hook'unda (zaten fire-and-forget kuyruğunda):

```bash
# Bu kadar. || true ile hata sessizce yutulur.
cd ~/.ctx-lab && git add . && git commit -m "session: {project} — {short_summary}" && git push || true
```

Rust karşılığı:
```rust
pub fn sync_on_session_end(repo_path: &Path, commit_msg: &str) -> Result<()> {
    // git2 crate ile:
    // 1. git add .
    // 2. git commit -m "{commit_msg}"
    // 3. git push → hata olursa log yaz, panic yapma
    //    Push başarısızsa bir sonraki startup'ta pull zaten çözecek
}
```

### 2.3 Conflict Stratejisi

| Dosya | Conflict olasılığı | Çözüm |
|-------|-------------------|-------|
| sessions/*.json | İmkânsız (unique dosya adı) | — |
| checkpoints/*.json | İmkânsız | — |
| roadmap.md | Düşük (genelde tek makinede edit) | `git status` ile kullanıcı çözer |
| meta.toml | Çok düşük | `git status` ile kullanıcı çözer |
| config.toml | `.gitignore`'a eklenebilir (makineye özgü) | — |

**İleri aşama (gerekirse):** Conflict sıklığı gerçek kullanımda yüksek çıkarsa, o zaman state machine + conflict UI eklenir. Şimdilik YAGNI.

---

## 3. Makine Profili

### 3.1 Otomatik Oluşturma

İlk kurulumda:

```toml
# machines/macbook-cagri.toml
schema_version = 1

[machine]
hostname = "macbook-cagri"
platform = "macos"
arch = "aarch64"
registered_at = "2026-02-19T10:00:00Z"
```

### 3.2 Proje-Makine Path Eşleme

```toml
# projects/adeb-sci/meta.toml
[paths]
macbook-cagri = "/Users/cagri/Projects/adeb-sci"
windows-ofis = "C:\\Users\\cagri\\Projects\\adeb-sci"
```

Her SessionStart'ta: UUID eşleşiyor ama path farklıysa → meta.toml güncellenir.

---

## 4. Log Rotation

3 aydan eski session/checkpoint JSON'ları birleştirip arşivle:

```
projects/X/archive/sessions_2026_Q1.jsonl
```

config.toml:
```toml
[archiving]
enabled = true
retention_days = 90
```

Orijinal dosyalar silinir, SQLite'ta veri korunur.

---

## 5. Onboarding Wizard

```
Ekran 1: Hook Kurulumu
  "ctx-lab-hook kurulumu yapılıyor..."
  ✅ Hook'lar başarıyla kuruldu
  [Devam]

Ekran 2: Proje Taraması
  "Mevcut projeleriniz taranıyor..."
  ✅ ~/Projects/adeb-sci
  ✅ ~/Projects/sahte-goruntu
  [Seçilenleri Kaydet]

Ekran 3: Sync (opsiyonel)
  "Birden fazla makinede mi çalışıyorsunuz?"
  [Evet, Git repo bağla] → URL gir
  [Hayır, local yeterli] → skip (varsayılan)

→ Dashboard açılır
```

**Sync opsiyonel.** İlk gün local-only. Kullanıcı değer gördükten sonra Ayarlar'dan aktive eder.

---

## 6. Cross-Machine Bildirimler

Git pull sonrası yeni session dosyaları tespit edildiğinde, makinesi farklı olanlar için native bildirim:

```
"adeb-sci güncellendi (Windows-Ofis): CV pipeline tamamlandı"
```

---

## 7. Faz C Çıkış Kriterleri

| Kriter | Detay |
|--------|-------|
| ✅ Pull on startup | Uygulama açılınca git pull yapılıyor |
| ✅ Push on session-end | Oturum bitince commit + push (hata sessiz) |
| ✅ Local-only mod | Git remote olmadan tam çalışıyor |
| ✅ Conflict mesajı | Conflict olursa "terminalden çöz" mesajı |
| ✅ Cross-machine bildirim | Başka makineden session gelince bildirim |
| ✅ Onboarding wizard | İlk kurulum 5 dakikada tamamlanıyor |
| ✅ Path eşleme | Aynı proje iki makinede farklı path'te tanınıyor |
| ✅ Log rotation | 3 aydan eski dosyalar arşivleniyor |

---

*Faz C bilinçli olarak minimal tutuldu. Gerçek kullanımda sync sorunları çıkarsa, state machine / conflict UI / retry mekanizması Faz E'de eklenir.*
