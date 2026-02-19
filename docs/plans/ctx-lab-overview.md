# ctx-lab — Genel Mimari & Karar Referansı

> **Versiyon:** v0.4 (19 Şubat 2026)  
> **Durum:** Geliştirmeye Hazır — Faz A'dan başla  
> **Lisans:** MIT

---

## Proje Özeti

**ctx-lab:** Bilgisayara oturduğunda, herhangi bir projeye geçtiğinde, en son nerede kaldığını, ne yaptığını ve sırada ne olduğunu otomatik olarak gösteren masaüstü uygulaması.

**Hedef kitle:** Claude Code kullanan çok projeli araştırmacılar ve geliştiriciler.

**North Star Metric:** "Resume-to-first-productive-action" süresi < 10 saniye.

---

## Mimari Karar Tablosu (Kesinleşmiş)

| # | Karar | Seçim | Gerekçe |
|---|-------|-------|---------|
| 1 | Platform | Tauri v2 (Rust + React) | Hafif (~60MB RAM), cross-platform, system tray |
| 2 | Frontend | React + TypeScript + Tailwind | Web dashboard ile kod paylaşımı potansiyeli |
| 3 | Workspace | Cargo workspace (core, hook, app) | Shared crate, tek build pipeline |
| 4 | Hook binary | Rust (ctx-lab-hook) | Sıfır dependency, <5ms cold start |
| 5 | Veri katmanı | Git = SoT, SQLite = Local Cache | Binary conflict sıfır, offline-first |
| 6 | Hook event'leri | SessionStart, PostToolUse, Stop, SessionEnd | Resmi Claude Code API |
| 7 | Bağlam enjeksiyonu | additionalContext (1500 char max) + CLAUDE.md fallback | Native injection |
| 8 | Oturum özeti | Transcript + git diff + commits (hibrit) | Ücretsiz, API gereksiz |
| 9 | Heartbeat | 3 katman: PostToolUse + SessionEnd + Process watcher | Crash recovery |
| 10 | Sync (v1) | Git-based (pull on start, push on end) | Ücretsiz, offline çalışır |
| 11 | İsim | ctx-lab | Teknik, açık, benzersiz |
| 12 | Lisans | MIT | Maksimum benimseme |
| 13 | Dil | EN öncelikli, i18n altyapısı Day 1 | Uluslararası standart |
| 14 | AI tool desteği | Sadece Claude Code (v1) | Önce bir platformda mükemmel |
| 15 | Roadmap editörü | Markdown (v1) | Hedef kitle markdown biliyor |
| 16 | Roadmap güncelleme | Konservatif + onay modeli | Yanlış pozitif önleme |
| 17 | Hook mimarisi | **Fire-and-forget** (queue → daemon) | Asla kullanıcı CLI'ını bloklama |
| 18 | Dosya yazımı | **Atomic write** (tmp → fsync → rename) | Yarım JSON önleme |
| 19 | Schema | **Versiyonlu** (schema_version alanı) | İleriye dönük uyumluluk |
| 20 | Privacy | **v1: sadece "full"** (config alanı future-proof) | Minimal implementasyon |
| 21 | File watcher | notify + **polling fallback** (WSL için) | Cross-platform güvenilirlik |
| 22 | Event tüketimi | **İdempotent** (processed tablosu) | Çift/kayıp event koruması |
| 23 | Transcript | **Abstraction layer** (trait + git-diff fallback) | Format değişikliğine dayanıklı |
| 24 | CLAUDE.md | **Marker-based** (ctx-lab:start/end) | Mevcut içeriğe dokunmaz |

---

## Tech Stack

```
ctx-lab/
├── Cargo.toml                    ← workspace
├── crates/
│   ├── ctx-lab-core/             ← paylaşılan kütüphane
│   ├── ctx-lab-hook/             ← CLI hook binary (fire-and-forget)
│   └── ctx-lab-app/              ← Tauri masaüstü uygulaması
├── frontend/                     ← React + TypeScript
└── README.md
```

**Temel Rust Crate'leri:**

| Crate | Kullanım |
|-------|----------|
| serde + serde_json | JSON parse/serialize |
| clap | Subcommand CLI |
| git2 | Git operasyonları |
| rusqlite | SQLite |
| toml | Config parse |
| chrono | Zaman damgası |
| notify | File watcher |
| sysinfo | Process watcher |
| fd-lock | Cross-platform file locking |
| uuid | Session/checkpoint ID'leri |

---

## Veri Deposu Yapısı

```
~/.ctx-lab/                              ← git repo (SoT)
├── .gitignore                           ← cache.db, *.db-*, queue/
├── config.toml
├── machines/{hostname}.toml
├── projects/{slug}/
│   ├── meta.toml                        ← proje meta + makine path'leri
│   ├── roadmap.md
│   ├── sessions/{tarih}_{makine}_{saat}_{ses-id}.json
│   ├── checkpoints/{tarih}_{saat}_{chk-id}.json
│   └── decisions.md
├── queue/                               ← hook payload kuyruğu (local, .gitignore)
├── .events/                             ← hook→app IPC (local, .gitignore)
├── cache.db                             ← SQLite (local, .gitignore)
└── templates/
```

---

## Faz Planı & Bağımlılıklar

```
FAZ A (Hook Binary + Core)     3-4 hafta
  │
  ├──► FAZ B (UI + SQLite)     4-5 hafta
  │       │
  │       └──► FAZ C (Sync)    2-3 hafta
  │
  └──► FAZ D (Release)         2-3 hafta

FAZ E (SaaS)                   İleri tarih
```

**MVP:** Faz A + B + D (tek makine, UI'lı, açık kaynak)  
**v1.0:** Faz A + B + C + D (multi-machine)

**Her fazın ayrıntılı dokümanı:**
- `ctx-lab-faz-a.md` — Temel Altyapı + Hook Binary
- `ctx-lab-faz-b.md` — SQLite + Masaüstü Uygulama
- `ctx-lab-faz-c.md` — Multi-Machine Sync + Onboarding
- `ctx-lab-faz-d.md` — Polish + Release

---

## Privacy Modları

| Mod | Ne saklanır | Ne saklanmaz |
|-----|-------------|--------------|
| `metadata-only` | Zaman, süre, dosya listesi, commit hash | Transcript, özet, highlight |
| `summary-only` | + Oturum özeti, roadmap değişiklikleri | Transcript highlight, ham mesajlar |
| `full` (varsayılan) | + Transcript highlights, tool listesi | Ham transcript (zaten saklanmaz) |

Config: `config.toml` → `privacy_mode = "full"`

---

## Güvenlik Katmanları

1. **Private repo varsayılan** (onboarding'de uyarı)
2. **Auto-sanitization** (API key, password, secret pattern regex)
3. **Redaction raporu** ("N adet secret redacted" — değerler gösterilmez)
4. **Privacy modları** (metadata-only seçeneği)
5. **Path sanitization** (home path, kullanıcı adı maskeleme opsiyonu)
6. **İleri aşama (Faz E):** At-rest encryption (OS keychain ile anahtar yönetimi)

---

## Uzman Review Entegrasyonu

Bu v0.4'te üç uzman review'dan alınan kritik iyileştirmeler:

| Kaynak | Konu | Entegre Edildiği Faz |
|--------|------|---------------------|
| Principal Eng. | Polling fallback (WSL) | Faz B |
| Principal Eng. | Git repo bloat → log rotation | Faz C |
| Principal Eng. | Fire-and-forget hook | Faz A |
| CTO | Atomic write (tmp→rename) | Faz A |
| CTO | Schema versioning | Faz A |
| CTO | Sync state machine | Faz C |
| CTO | Event idempotency | Faz B |
| CTO | Privacy modes | Faz A (config), Faz B (UI) |
| CTO | Reconcile job | Faz B |
| CTO | Install idempotency + doctor | Faz A |
| CTO | Golden fixture tests | Faz A |
| Yatırımcı | North Star Metric | Overview |
| Yatırımcı | One-click resume (hero screen) | Faz B |
| Yatırımcı | Onboarding sürtünme azaltma | Faz C |

---

*Bu doküman kompakt referanstır. Implementasyon detayları için ilgili faz dokümanına bakın.*
