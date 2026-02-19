# ctx-lab — FAZ B: SQLite + Masaüstü Uygulama

> **Tahmini süre:** 4-5 hafta  
> **Bağımlılık:** Faz A tamamlanmış olmalı  
> **Teslimat:** Tauri masaüstü uygulaması (dashboard + proje detay + system tray)  
> **Bu faz sonunda:** Kullanıcı ctx-lab'ı açar, tüm projelerini dashboard'da görür, roadmap takip eder, oturum geçmişini inceler.

---

## 1. Faz Hedefi

Bilgisayara oturunca ctx-lab'ı aç → tüm projelerin durumunu tek ekranda gör → herhangi bir projeye tıkla → "en son ne yaptım, sırada ne var" bilgisine 5 saniyede ulaş.

**Hero Screen:** Dashboard — projeler kartlar halinde, her kartta son oturum özeti + ilerleme çubuğu + "VSCode'da Aç" butonu.

---

## 2. Workspace Genişlemesi

Faz A'daki workspace'e `ctx-lab-app` crate'i ve `frontend/` eklenir:

```
ctx-lab/
├── Cargo.toml                          ← workspace: core, hook, app
├── crates/
│   ├── ctx-lab-core/                   ← Faz A'dan (değişmez)
│   ├── ctx-lab-hook/                   ← Faz A'dan (değişmez)
│   └── ctx-lab-app/                    ← YENİ: Tauri backend
│       ├── Cargo.toml
│       ├── tauri.conf.json
│       ├── build.rs
│       └── src/
│           ├── main.rs
│           ├── commands.rs             ← Tauri IPC komutları
│           ├── watcher.rs              ← file watcher + polling fallback
│           ├── process_watcher.rs      ← Katman 3 heartbeat
│           ├── tray.rs                 ← system tray
│           ├── reconcile.rs            ← periyodik fs↔SQLite eşleme
│           └── db.rs                   ← SQLite bağlantı yönetimi
├── frontend/                           ← YENİ: React app
│   ├── package.json
│   ├── tsconfig.json
│   ├── tailwind.config.js
│   ├── vite.config.ts
│   ├── index.html
│   ├── public/
│   │   └── locales/
│   │       └── en/
│   │           └── translation.json    ← i18n (sadece EN, altyapı hazır)
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── i18n.ts                     ← i18next setup
│       ├── pages/
│       │   ├── Dashboard.tsx
│       │   ├── ProjectDetail.tsx
│       │   └── Settings.tsx
│       ├── components/
│       │   ├── ProjectCard.tsx
│       │   ├── RoadmapView.tsx
│       │   ├── SessionTimeline.tsx
│       │   ├── DecisionHistory.tsx
│       │   ├── ProgressBar.tsx
│       │   └── QuickResume.tsx         ← "One-click resume" widget
│       ├── hooks/
│       │   ├── useProjects.ts
│       │   ├── useSessions.ts
│       │   ├── useRoadmap.ts
│       │   └── useTauriEvent.ts
│       └── lib/
│           ├── tauri.ts                ← IPC wrapper
│           └── types.ts               ← TypeScript interfaces (Rust modelleriyle eşleşir)
└── README.md
```

---

## 3. SQLite Schema + Migration

### 3.1 Schema (cache.db)

```sql
-- PRAGMA'lar
PRAGMA journal_mode = WAL;          -- concurrent read/write
PRAGMA user_version = 1;            -- schema version (migration tracking)
PRAGMA foreign_keys = ON;

-- Projeler
CREATE TABLE projects (
    id TEXT PRIMARY KEY,             -- "proj_xxx"
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'archived'
    created_at TEXT NOT NULL,        -- ISO 8601
    archived_at TEXT,
    description TEXT DEFAULT '',
    total_sessions INTEGER DEFAULT 0,
    total_duration_minutes INTEGER DEFAULT 0,
    last_session_at TEXT,
    last_machine TEXT,
    progress_percent REAL DEFAULT 0.0,
    meta_toml_path TEXT              -- kaynak dosya yolu (reconcile için)
);

-- Oturumlar
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,             -- "ses_xxx"
    project_id TEXT NOT NULL REFERENCES projects(id),
    machine TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    duration_minutes INTEGER,
    end_reason TEXT,
    summary TEXT DEFAULT '',
    summary_source TEXT DEFAULT 'unknown',
    next_steps TEXT DEFAULT '',
    files_changed INTEGER DEFAULT 0,
    recovered INTEGER DEFAULT 0,     -- boolean
    redaction_count INTEGER DEFAULT 0,
    source_path TEXT,                -- kaynak JSON dosya yolu (reconcile için)
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_sessions_project ON sessions(project_id);
CREATE INDEX idx_sessions_started ON sessions(started_at DESC);
CREATE INDEX idx_sessions_machine ON sessions(machine);

-- Transcript Highlights (ayrı tablo — N:1 sessions)
CREATE TABLE transcript_highlights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    content TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0
);

-- Roadmap Items (materialize edilmiş)
CREATE TABLE roadmap_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL REFERENCES projects(id),
    phase TEXT,
    item_text TEXT NOT NULL,
    status TEXT NOT NULL,             -- 'done' | 'active' | 'pending' | 'suspended' | 'blocked'
    sort_order INTEGER DEFAULT 0
);

CREATE INDEX idx_roadmap_project ON roadmap_items(project_id);

-- Kararlar
CREATE TABLE decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL REFERENCES projects(id),
    date TEXT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0
);

-- Makineler
CREATE TABLE machines (
    hostname TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    registered_at TEXT NOT NULL
);

-- Event idempotency tracking
CREATE TABLE processed_events (
    event_file TEXT PRIMARY KEY,      -- event dosya adı
    processed_at TEXT DEFAULT (datetime('now'))
);

-- Aggregate views
CREATE VIEW project_summary AS
SELECT
    p.id, p.name, p.status, p.progress_percent,
    MAX(s.started_at) as last_session_at,
    (SELECT machine FROM sessions WHERE project_id = p.id ORDER BY started_at DESC LIMIT 1) as last_machine,
    (SELECT summary FROM sessions WHERE project_id = p.id ORDER BY started_at DESC LIMIT 1) as last_summary,
    COUNT(s.id) as session_count,
    COALESCE(SUM(s.duration_minutes), 0) as total_minutes
FROM projects p
LEFT JOIN sessions s ON s.project_id = p.id
WHERE p.status = 'active'
GROUP BY p.id
ORDER BY last_session_at DESC;
```

### 3.2 Migration Stratejisi

```rust
// db.rs

const CURRENT_SCHEMA_VERSION: u32 = 1;

pub fn initialize_db(db_path: &Path) -> Result<rusqlite::Connection> {
    let conn = rusqlite::Connection::open(db_path)?;

    // WAL mode
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;

    let version: u32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

    if version == 0 {
        // İlk kurulum — tüm tabloları oluştur
        conn.execute_batch(SCHEMA_V1)?;
        conn.pragma_update(None, "user_version", CURRENT_SCHEMA_VERSION)?;
    } else if version < CURRENT_SCHEMA_VERSION {
        // Incremental migration
        for v in version..CURRENT_SCHEMA_VERSION {
            apply_migration(&conn, v, v + 1)?;
        }
        conn.pragma_update(None, "user_version", CURRENT_SCHEMA_VERSION)?;
    }

    Ok(conn)
}

fn apply_migration(conn: &rusqlite::Connection, from: u32, to: u32) -> Result<()> {
    match (from, to) {
        // (1, 2) => conn.execute_batch("ALTER TABLE sessions ADD COLUMN new_field TEXT DEFAULT ''")?,
        _ => anyhow::bail!("Unknown migration: v{} → v{}", from, to),
    }
    Ok(())
}
```

### 3.3 Full Rebuild + Incremental Sync

```rust
// reconcile.rs

/// Dosya sisteminden SQLite'ı tamamen yeniden oluştur
/// Kullanım: ilk kurulum, cache.db bozulması, pull sonrası
pub fn full_rebuild(conn: &Connection, ctx_lab_dir: &Path) -> Result<()> {
    // 1. Tüm tabloları temizle
    // 2. projects/ altındaki her meta.toml'u parse et → INSERT projects
    // 3. Her projenin sessions/ altındaki JSON'ları parse et → INSERT sessions
    // 4. Her projenin roadmap.md'sini parse et → INSERT roadmap_items
    // 5. Her projenin decisions.md'sini parse et → INSERT decisions
    // 6. machines/ altındaki TOML'ları parse et → INSERT machines
    // 7. Proje aggregate'larını güncelle (session count, duration, progress)
    todo!("implement")
}

/// İnkremental güncelleme: sadece değişen dosyaları işle
/// File watcher veya reconcile job tarafından çağrılır
pub fn incremental_update(conn: &Connection, changed_path: &Path) -> Result<()> {
    // Dosya türüne göre:
    // - sessions/*.json → INSERT OR REPLACE sessions
    // - roadmap.md → DELETE + INSERT roadmap_items for project
    // - meta.toml → UPDATE projects
    // - decisions.md → DELETE + INSERT decisions for project
    todo!("implement")
}

/// Periyodik reconcile: fs ve SQLite'ı karşılaştır
/// 10 dakikada bir çalışır, drift'i düzeltir
pub fn reconcile(conn: &Connection, ctx_lab_dir: &Path) -> Result<ReconcileReport> {
    // 1. Fs'teki session dosyalarını listele
    // 2. SQLite'taki session'larla karşılaştır
    // 3. Eksikler → INSERT
    // 4. Fazlalar → DELETE (dosya silinmiş)
    // 5. Rapor döndür
    todo!("implement")
}

pub struct ReconcileReport {
    pub added: u32,
    pub removed: u32,
    pub updated: u32,
    pub errors: Vec<String>,
}
```

---

## 4. Tauri Backend (ctx-lab-app)

### 4.1 IPC Komutları (commands.rs)

```rust
// commands.rs — Tauri invoke handlers

#[tauri::command]
fn get_projects(db: State<DbPool>) -> Result<Vec<ProjectSummary>, String> {
    // SELECT * FROM project_summary
}

#[tauri::command]
fn get_project_detail(db: State<DbPool>, project_id: String) -> Result<ProjectDetail, String> {
    // project + roadmap_items + son 20 session + decisions
}

#[tauri::command]
fn get_sessions(db: State<DbPool>, project_id: String, limit: u32) -> Result<Vec<Session>, String> {
    // SELECT * FROM sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT ?
}

#[tauri::command]
fn get_roadmap(db: State<DbPool>, project_id: String) -> Result<RoadmapData, String> {
    // roadmap_items + progress_percent
}

#[tauri::command]
fn toggle_roadmap_item(project_id: String, item_text: String, new_status: String) -> Result<(), String> {
    // 1. roadmap.md dosyasını oku
    // 2. Item'ın status'unu değiştir (roadmap.rs kullan)
    // 3. Atomic write ile kaydet
    // 4. SQLite güncelle
    // 5. .events/ yaz (UI refresh trigger)
}

#[tauri::command]
fn archive_project(db: State<DbPool>, project_id: String) -> Result<(), String> {
    // meta.toml: status = "archived", archived_at = now
    // SQLite güncelle
}

#[tauri::command]
fn unarchive_project(db: State<DbPool>, project_id: String) -> Result<(), String> {
    // meta.toml: status = "active", archived_at = null
}

#[tauri::command]
fn open_in_vscode(project_id: String) -> Result<(), String> {
    // meta.toml'dan bu makinenin path'ini al
    // `code {path}` komutu çalıştır
}

#[tauri::command]
fn get_sync_status() -> Result<SyncStatus, String> {
    // Son git push/pull zamanı, pending commit sayısı
}

#[tauri::command]
fn rebuild_cache() -> Result<ReconcileReport, String> {
    // cache.db sil → full_rebuild çalıştır
}

#[tauri::command]
fn get_settings() -> Result<AppConfig, String> {
    // config.toml oku
}

#[tauri::command]
fn update_settings(config: AppConfig) -> Result<(), String> {
    // config.toml yaz (atomic)
}
```

### 4.2 File Watcher + Polling Fallback (watcher.rs)

```rust
// watcher.rs

use notify::{Watcher, RecursiveMode, Event};
use std::sync::mpsc;
use std::time::Duration;

/// Dual-mode watcher: notify event-based + polling fallback
/// WSL ve bazı Windows dosya sistemi senaryolarında notify güvenilmez
pub fn start_watcher(ctx_lab_dir: PathBuf, tx: mpsc::Sender<WatchEvent>) {
    // Katman 1: notify event-based
    let notify_tx = tx.clone();
    std::thread::spawn(move || {
        let (ntx, nrx) = mpsc::channel();
        let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
            if let Ok(event) = res {
                let _ = ntx.send(event);
            }
        }).expect("watcher init failed");

        watcher.watch(&ctx_lab_dir, RecursiveMode::Recursive).expect("watch failed");

        for event in nrx {
            // .events/ dizinindeki yeni dosyaları filtrele
            for path in &event.paths {
                if path.starts_with(ctx_lab_dir.join(".events")) {
                    let _ = notify_tx.send(WatchEvent::NewEvent(path.clone()));
                }
                if path.starts_with(ctx_lab_dir.join("projects")) {
                    let _ = notify_tx.send(WatchEvent::DataChanged(path.clone()));
                }
            }
        }
    });

    // Katman 2: Polling fallback (2 saniye interval)
    let poll_tx = tx.clone();
    let poll_dir = ctx_lab_dir.clone();
    std::thread::spawn(move || {
        let mut last_scan: HashMap<PathBuf, SystemTime> = HashMap::new();
        loop {
            std::thread::sleep(Duration::from_secs(2));
            // .events/ dizinini tara, mtime değişenleri bildir
            if let Ok(entries) = std::fs::read_dir(poll_dir.join(".events")) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if let Ok(meta) = path.metadata() {
                        if let Ok(mtime) = meta.modified() {
                            let is_new = last_scan.get(&path).map_or(true, |&prev| prev < mtime);
                            if is_new {
                                last_scan.insert(path.clone(), mtime);
                                let _ = poll_tx.send(WatchEvent::NewEvent(path));
                            }
                        }
                    }
                }
            }
        }
    });
}

pub enum WatchEvent {
    NewEvent(PathBuf),
    DataChanged(PathBuf),
}
```

### 4.3 Event Consumer — İdempotent (commands.rs veya ayrı modül)

```rust
/// Event dosyasını işle — idempotent (aynı event birden fazla gelse bile sorun yok)
fn process_event(conn: &Connection, event_path: &Path) -> Result<()> {
    let filename = event_path.file_name()
        .and_then(|f| f.to_str())
        .ok_or_else(|| anyhow::anyhow!("invalid event path"))?;

    // İdempotency check: daha önce işlenmiş mi?
    let already_processed: bool = conn.query_row(
        "SELECT COUNT(*) FROM processed_events WHERE event_file = ?",
        [filename],
        |row| row.get::<_, i64>(0),
    )? > 0;

    if already_processed { return Ok(()); }

    // Event'i parse et ve işle
    let event: serde_json::Value = storage::safe_read_json(event_path)?
        .ok_or_else(|| anyhow::anyhow!("event parse failed"))?;

    let event_type = event.get("event").and_then(|e| e.as_str()).unwrap_or("");
    match event_type {
        "session_started" => { /* incremental_update */ }
        "session_ended" => { /* incremental_update + proje aggregate güncelle */ }
        "checkpoint_created" => { /* minimal, belki skip */ }
        _ => { /* bilinmeyen event, log yaz */ }
    }

    // İşlendiğini kaydet
    conn.execute(
        "INSERT INTO processed_events (event_file) VALUES (?)",
        [filename],
    )?;

    // Event dosyasını sil (işlendi)
    std::fs::remove_file(event_path).ok();

    Ok(())
}
```

### 4.4 Process Watcher — Katman 3 (process_watcher.rs)

```rust
/// 10 dakikada bir claude process'ini kontrol et
/// Default: KAPALI (config.toml'da enable edilir)
/// V1'de "best effort" — ciddi sorun çıkarsa devre dışı bırakılabilir
pub fn start_process_watcher(config: &AppConfig, tx: mpsc::Sender<WatchEvent>) {
    if !config.process_watcher_enabled {
        return; // default kapalı
    }

    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_secs(600)); // 10 dk

            let claude_running = check_claude_process();
            // ... (Faz A dokümanındaki mantık)
        }
    });
}

fn check_claude_process() -> bool {
    // sysinfo crate ile process listesini tara
    // "claude" veya "claude-code" process'i var mı
    // Fallback: ~/.claude/.lock dosyası kontrolü
    todo!("implement")
}
```

---

## 5. Frontend (React + TypeScript + Tailwind)

### 5.1 Temel Bağımlılıklar

```json
{
  "dependencies": {
    "react": "^18",
    "react-dom": "^18",
    "react-router-dom": "^6",
    "@tauri-apps/api": "^2",
    "i18next": "^23",
    "react-i18next": "^13",
    "lucide-react": "latest",
    "date-fns": "^3"
  },
  "devDependencies": {
    "typescript": "^5",
    "tailwindcss": "^3",
    "@vitejs/plugin-react": "^4",
    "vite": "^5"
  }
}
```

### 5.2 TypeScript Interfaces (types.ts)

```typescript
// Rust struct'larıyla birebir eşleşir

export interface ProjectSummary {
  id: string;
  name: string;
  status: 'active' | 'archived';
  progress_percent: number;
  last_session_at: string | null;
  last_machine: string | null;
  last_summary: string | null;
  session_count: number;
  total_minutes: number;
}

export interface ProjectDetail extends ProjectSummary {
  roadmap: RoadmapData;
  recent_sessions: Session[];
  decisions: Decision[];
}

export interface Session {
  id: string;
  project_id: string;
  machine: string;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number | null;
  summary: string;
  next_steps: string;
  files_changed: number;
  recovered: boolean;
  transcript_highlights: string[];
}

export interface RoadmapData {
  items: RoadmapItem[];
  progress_percent: number;
}

export interface RoadmapItem {
  phase: string | null;
  item_text: string;
  status: 'done' | 'active' | 'pending' | 'suspended' | 'blocked';
}

export interface Decision {
  date: string | null;
  title: string;
  description: string;
}

export interface SyncStatus {
  last_push: string | null;
  last_pull: string | null;
  pending_commits: number;
  status: 'synced' | 'pending' | 'error';
}
```

### 5.3 Ana Ekranlar

**Dashboard (hero screen):**
- Aktif projeler grid (2-3 sütun responsive)
- Her kart: proje adı, son oturum özeti (2 satır), ilerleme çubuğu, son makine+tarih
- **Quick Resume widget:** En son çalışılan proje büyük kart, "Devam Et" butonu (VSCode'u açar)
- Son aktiviteler listesi (alt kısım)
- Arşivlenmiş projeler collapse bölümü
- Sync durumu göstergesi (sağ üst)

**Proje Detay:**
- Roadmap rendered view (fazlar + checkbox'lar, inline toggle)
- Oturum timeline (son 20 oturum, tarih + makine + süre + özet)
- Karar geçmişi (kronolojik)
- "Roadmap Geçmişi" butonu (git diff modal)

**Ayarlar:**
- Privacy mode seçimi
- Checkpoint interval
- Bildirim tercihleri
- Tema (açık/koyu)
- Proje listesi yönetimi
- Hook durumu (doctor çıktısı)
- "Rebuild Cache" butonu

### 5.4 System Tray

```rust
// tray.rs

pub fn setup_tray(app: &tauri::App) -> Result<()> {
    // Tray ikonu: aktif oturum varsa yeşil, yoksa gri
    // Menü:
    //   ─────────────────────────────
    //   📊 adeb-sci — CV pipeline tamamlandı (2 saat önce)
    //   ─────────────────────────────
    //   Dashboard'u Aç
    //   ─────────────────────────────
    //   adeb-sci → VSCode'da Aç
    //   sahte-goruntu → VSCode'da Aç
    //   lit-rag → VSCode'da Aç
    //   ─────────────────────────────
    //   🔄 Sync: 5dk önce
    //   Ayarlar
    //   Çıkış
    todo!("implement")
}
```

### 5.5 Bildirimler

| Olay | Bildirim |
|------|----------|
| Oturum tamamlandı (başka makineden) | "Windows'tan sahte-goruntu güncellendi: CV pipeline tamamlandı" |
| Sync hatası | "GitHub sync başarısız, detaylar için tıklayın" |
| Kurtarılan oturum | "adeb-sci: önceki oturum kurtarıldı (beklenmedik kapanış)" |
| Yeni proje algılandı | "Yeni proje: lit-rag" |

---

## 6. Reconcile Job

Her 10 dakikada bir çalışır, fs ile SQLite arasındaki drift'i düzeltir:

```
Reconcile cycle:
  1. projects/ dizinindeki meta.toml'ları tara
  2. SQLite'taki projelerle karşılaştır
     → Yeni proje → INSERT
     → Silinen proje → DELETE
  3. Her projenin sessions/ dizinini tara
     → Yeni session → INSERT
     → Silinen session → DELETE
  4. Roadmap'leri yeniden parse et (değişmişse)
  5. Proje aggregate'larını güncelle
  6. processed_events'ten 24 saatten eski kayıtları temizle
```

---

## 7. Faz B Çıkış Kriterleri

| Kriter | Detay |
|--------|-------|
| ✅ Dashboard | Tüm aktif projeler kartlarla görünüyor |
| ✅ Quick Resume | En son proje büyük kartla öne çıkıyor |
| ✅ Proje detay | Roadmap + oturum timeline + kararlar |
| ✅ Roadmap toggle | Checkbox tıkla → roadmap.md güncellenir |
| ✅ System tray | Arka planda çalışıyor, bildirimler geliyor |
| ✅ SQLite rebuild | cache.db silinse 3 saniyede rebuild |
| ✅ Event idempotency | Aynı event 3 kez gelse bile tek işlem |
| ✅ Reconcile | 10dk'da bir fs↔SQLite eşleşiyor |
| ✅ Polling fallback | notify başarısız olsa bile 2sn poll ile çalışıyor |
| ✅ i18n altyapısı | Tüm string'ler locale dosyasından geliyor (EN) |
| ✅ Tema | Açık/koyu tema çalışıyor |
| ✅ Degraded mode | cache.db bozuksa "Rebuild" butonu çalışıyor |

---

*Bu doküman Faz B'nin tam implementasyon spesifikasyonudur. Faz A tamamlandıktan sonra Claude Code'a verildiğinde Tauri app + React frontend iskeletini büyük ölçüde üretebilir.*
