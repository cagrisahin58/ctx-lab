# ctx-lab Faz B: SQLite + Masaüstü Uygulama — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Tauri v2 masaüstü uygulaması — SQLite cache, file watcher, React dashboard, system tray.

**Architecture:** Mevcut ctx-lab-core crate'i import edilir (tekrar yazılmaz). Yeni `ctx-lab-app` Tauri crate'i SQLite'ı yönetir, `frontend/` React dashboard'u sunar. Hook binary (Faz A) `.events/` dizinine yazar → file watcher bunu algılar → SQLite güncellenir → frontend Tauri event ile refresh eder.

**Tech Stack:** Tauri v2, Rust, rusqlite, notify, sysinfo, React 18, TypeScript, Tailwind CSS, Vite, react-router-dom, Lucide icons, date-fns, i18next

**Faz A'dan miras:** ctx-lab-core (models, storage, config, roadmap, sanitize, queue, git_ops, transcript, claude_md, schema, errors) — 59 test, production'da çalışıyor.

---

## Task 0: Tauri v2 CLI + Proje İskeleti

**Files:**
- Modify: `Cargo.toml` (workspace members'a `crates/ctx-lab-app` ekle)
- Create: `crates/ctx-lab-app/` (Tauri init ile oluşturulacak)
- Create: `frontend/` (Vite + React + TypeScript)

**Step 1: Tauri CLI kur**

Run: `cargo install tauri-cli --version "^2"`
Expected: `cargo-tauri` binary kurulur

**Step 2: Tauri projesi oluştur**

Run: `cargo tauri init` (cwd: proje kökü)

Interactive prompts (otomatik cevapla):
- App name: `ctx-lab`
- Window title: `ctx-lab`
- Frontend dev URL: `http://localhost:5173`
- Frontend dist dir: `../frontend/dist`
- Frontend dev command: `npm run dev`
- Frontend build command: `npm run build`

NOT: Tauri init çıktısı `src-tauri/` dizinini oluşturur. Biz bunu `crates/ctx-lab-app/` olarak taşıyacağız.

**Step 3: Tauri crate'ini doğru yere taşı**

```bash
# Tauri init src-tauri/ oluşturur, biz workspace yapısına uygun taşıyoruz
mv src-tauri crates/ctx-lab-app
```

Sonra `crates/ctx-lab-app/Cargo.toml`'u düzenle:
- `[package]` name: `ctx-lab-app`
- `[dependencies]`'e ekle: `ctx-lab-core = { path = "../ctx-lab-core" }`
- Workspace dependency'leri kullan: `serde.workspace = true`, `serde_json.workspace = true`, `chrono.workspace = true`, `anyhow.workspace = true`
- Yeni dependency'ler ekle: `rusqlite = { version = "0.32", features = ["bundled"] }`, `notify = "7"`, `sysinfo = "0.33"`

Root `Cargo.toml` workspace members'a `"crates/ctx-lab-app"` ekle.
Workspace dependencies'e ekle: `rusqlite`, `notify`, `sysinfo`, `tauri`, `tauri-build`.

**Step 4: Frontend iskeleti (Vite + React + TypeScript + Tailwind)**

```bash
cd frontend
npm create vite@latest . -- --template react-ts
npm install
npm install react-router-dom @tauri-apps/api@^2 lucide-react date-fns i18next react-i18next
npm install -D tailwindcss @tailwindcss/vite
```

Minimal `frontend/src/App.tsx`:
```tsx
function App() {
  return <div className="p-4"><h1 className="text-2xl font-bold">ctx-lab</h1></div>;
}
export default App;
```

`frontend/src/main.css`'e Tailwind import:
```css
@import "tailwindcss";
```

`frontend/vite.config.ts`'e Tailwind plugin:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
});
```

**Step 5: tauri.conf.json'u düzelt**

`crates/ctx-lab-app/tauri.conf.json` dosyasında:
- `identifier`: `"com.ctxlab.app"`
- `build.frontendDist`: `"../../frontend/dist"`
- `build.devUrl`: `"http://localhost:5173"`
- `build.beforeDevCommand`: `"cd ../../frontend && npm run dev"`
- `build.beforeBuildCommand`: `"cd ../../frontend && npm run build"`

**Step 6: Build doğrulama**

Run: `cd frontend && npm run build && cd .. && cargo tauri build --debug 2>&1 | tail -20`
Expected: Tauri app build başarılı, `target/debug/ctx-lab-app` veya `.app` bundle oluşur

**Step 7: Commit**

```bash
git add -A && git commit -m "feat(app): add Tauri v2 skeleton with React frontend"
```

---

## Task 1: SQLite Schema + Migration (db.rs)

**Files:**
- Create: `crates/ctx-lab-app/src/db.rs`
- Modify: `crates/ctx-lab-app/src/main.rs` (db modülünü declare et)

**Step 1: Write the failing test**

`crates/ctx-lab-app/src/db.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_initialize_db_creates_tables() {
        let tmp = TempDir::new().unwrap();
        let db_path = tmp.path().join("test.db");
        let conn = initialize_db(&db_path).unwrap();
        // Verify tables exist
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert!(tables.contains(&"projects".to_string()));
        assert!(tables.contains(&"sessions".to_string()));
        assert!(tables.contains(&"roadmap_items".to_string()));
        assert!(tables.contains(&"processed_events".to_string()));
        assert!(tables.contains(&"machines".to_string()));
    }

    #[test]
    fn test_initialize_db_sets_wal_mode() {
        let tmp = TempDir::new().unwrap();
        let conn = initialize_db(&tmp.path().join("test.db")).unwrap();
        let mode: String = conn.pragma_query_value(None, "journal_mode", |r| r.get(0)).unwrap();
        assert_eq!(mode.to_lowercase(), "wal");
    }

    #[test]
    fn test_initialize_db_idempotent() {
        let tmp = TempDir::new().unwrap();
        let db_path = tmp.path().join("test.db");
        initialize_db(&db_path).unwrap();
        let conn2 = initialize_db(&db_path).unwrap();
        let version: u32 = conn2.pragma_query_value(None, "user_version", |r| r.get(0)).unwrap();
        assert_eq!(version, CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn test_project_summary_view_exists() {
        let tmp = TempDir::new().unwrap();
        let conn = initialize_db(&tmp.path().join("test.db")).unwrap();
        // Insert a project and verify view works
        conn.execute(
            "INSERT INTO projects (id, name, status, created_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params!["proj_1", "Test", "active", "2026-01-01T00:00:00Z"],
        ).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM project_summary", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
    }
}
```

**Step 2: Run test to verify it fails**

Run: `cargo test -p ctx-lab-app -- db::tests -v`
Expected: FAIL — `initialize_db` not defined

**Step 3: Write implementation**

`crates/ctx-lab-app/src/db.rs`:
```rust
use anyhow::Result;
use rusqlite::Connection;
use std::path::Path;

pub const CURRENT_SCHEMA_VERSION: u32 = 1;

const SCHEMA_V1: &str = r#"
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    archived_at TEXT,
    description TEXT DEFAULT '',
    total_sessions INTEGER DEFAULT 0,
    total_duration_minutes INTEGER DEFAULT 0,
    last_session_at TEXT,
    last_machine TEXT,
    progress_percent REAL DEFAULT 0.0,
    meta_toml_path TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
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
    recovered INTEGER DEFAULT 0,
    redaction_count INTEGER DEFAULT 0,
    source_path TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_machine ON sessions(machine);

CREATE TABLE IF NOT EXISTS transcript_highlights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    content TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS roadmap_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL REFERENCES projects(id),
    phase TEXT,
    item_text TEXT NOT NULL,
    status TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_roadmap_project ON roadmap_items(project_id);

CREATE TABLE IF NOT EXISTS decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL REFERENCES projects(id),
    date TEXT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS machines (
    hostname TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    registered_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS processed_events (
    event_file TEXT PRIMARY KEY,
    processed_at TEXT DEFAULT (datetime('now'))
);

CREATE VIEW IF NOT EXISTS project_summary AS
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
"#;

pub fn initialize_db(db_path: &Path) -> Result<Connection> {
    let conn = Connection::open(db_path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;

    let version: u32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

    if version == 0 {
        conn.execute_batch(SCHEMA_V1)?;
        conn.pragma_update(None, "user_version", CURRENT_SCHEMA_VERSION)?;
    } else if version < CURRENT_SCHEMA_VERSION {
        for v in version..CURRENT_SCHEMA_VERSION {
            apply_migration(&conn, v, v + 1)?;
        }
        conn.pragma_update(None, "user_version", CURRENT_SCHEMA_VERSION)?;
    }

    Ok(conn)
}

fn apply_migration(conn: &Connection, from: u32, to: u32) -> Result<()> {
    match (from, to) {
        _ => anyhow::bail!("Unknown migration: v{} → v{}", from, to),
    }
}
```

**Step 4: Run test to verify it passes**

Run: `cargo test -p ctx-lab-app -- db::tests -v`
Expected: 4 tests PASS

**Step 5: Commit**

```bash
git add -A && git commit -m "feat(app): add SQLite schema v1 with migration support (4 tests)"
```

---

## Task 2: Reconcile — Full Rebuild + Incremental Update

**Files:**
- Create: `crates/ctx-lab-app/src/reconcile.rs`
- Modify: `crates/ctx-lab-app/src/main.rs` (modül ekle)

**Step 1: Write the failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::initialize_db;
    use tempfile::TempDir;

    fn setup_test_env() -> (TempDir, Connection) {
        let tmp = TempDir::new().unwrap();
        let db = initialize_db(&tmp.path().join("test.db")).unwrap();
        // Create minimal project structure
        let proj_dir = tmp.path().join("projects").join("test-project");
        std::fs::create_dir_all(proj_dir.join("sessions")).unwrap();
        // Write meta.toml
        let meta = r#"
schema_version = 1

[project]
id = "proj_test"
name = "Test Project"
status = "active"
created_at = "2026-01-01T00:00:00Z"
description = ""

[paths]
"#;
        std::fs::write(proj_dir.join("meta.toml"), meta).unwrap();
        (tmp, db)
    }

    #[test]
    fn test_full_rebuild_imports_project() {
        let (tmp, conn) = setup_test_env();
        let report = full_rebuild(&conn, tmp.path()).unwrap();
        assert_eq!(report.added, 1);
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_full_rebuild_imports_sessions() {
        let (tmp, conn) = setup_test_env();
        // Write a session JSON
        let session_json = serde_json::json!({
            "schema_version": 1,
            "id": "ses_001",
            "project_id": "proj_test",
            "machine": "mac",
            "started_at": "2026-01-01T10:00:00Z",
            "summary": "test session",
            "summary_source": "git_only",
            "files_changed": 3
        });
        let session_path = tmp.path().join("projects/test-project/sessions/20260101_mac_100000_ses_001.json");
        std::fs::write(&session_path, serde_json::to_string_pretty(&session_json).unwrap()).unwrap();
        let report = full_rebuild(&conn, tmp.path()).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
        assert!(report.added >= 2); // 1 project + 1 session
    }

    #[test]
    fn test_full_rebuild_imports_roadmap() {
        let (tmp, conn) = setup_test_env();
        let roadmap = "## Phase 1\n- [x] Done item\n- [>] Active item\n- [ ] Pending\n";
        std::fs::write(tmp.path().join("projects/test-project/roadmap.md"), roadmap).unwrap();
        full_rebuild(&conn, tmp.path()).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM roadmap_items", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 3);
        // Check progress was updated
        let progress: f64 = conn.query_row(
            "SELECT progress_percent FROM projects WHERE id = 'proj_test'", [], |r| r.get(0)
        ).unwrap();
        assert!((progress - 33.0).abs() < 1.0);
    }

    #[test]
    fn test_full_rebuild_idempotent() {
        let (tmp, conn) = setup_test_env();
        full_rebuild(&conn, tmp.path()).unwrap();
        full_rebuild(&conn, tmp.path()).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_incremental_update_session() {
        let (tmp, conn) = setup_test_env();
        full_rebuild(&conn, tmp.path()).unwrap();
        // Add a new session file
        let session_json = serde_json::json!({
            "schema_version": 1,
            "id": "ses_new",
            "project_id": "proj_test",
            "machine": "mac",
            "started_at": "2026-01-02T10:00:00Z",
            "summary": "new session",
            "summary_source": "git_only"
        });
        let path = tmp.path().join("projects/test-project/sessions/20260102_mac_ses_new.json");
        std::fs::write(&path, serde_json::to_string(&session_json).unwrap()).unwrap();
        incremental_update(&conn, &path, tmp.path()).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
    }
}
```

**Step 2: Run tests to verify they fail**

Run: `cargo test -p ctx-lab-app -- reconcile::tests -v`
Expected: FAIL — module not found

**Step 3: Write implementation**

`crates/ctx-lab-app/src/reconcile.rs` — Key functions:
- `full_rebuild(conn, ctx_lab_dir)` — Truncate all tables, scan `projects/*/meta.toml`, import sessions, roadmaps, machines
- `incremental_update(conn, changed_path, ctx_lab_dir)` — Detect file type by path, INSERT OR REPLACE
- `reconcile(conn, ctx_lab_dir)` — Diff fs vs SQLite, return `ReconcileReport`

Uses `ctx_lab_core::models::Session`, `ctx_lab_core::models::ProjectMeta`, `ctx_lab_core::roadmap::parse_roadmap`, `ctx_lab_core::roadmap::progress_percent`.

```rust
pub struct ReconcileReport {
    pub added: u32,
    pub removed: u32,
    pub updated: u32,
    pub errors: Vec<String>,
}
```

**Step 4: Run tests**

Run: `cargo test -p ctx-lab-app -- reconcile::tests -v`
Expected: 5 tests PASS

**Step 5: Commit**

```bash
git add -A && git commit -m "feat(app): add reconcile — full rebuild + incremental update (5 tests)"
```

---

## Task 3: Event Consumer — İdempotent Processing

**Files:**
- Create: `crates/ctx-lab-app/src/events.rs`
- Modify: `crates/ctx-lab-app/src/main.rs` (modül ekle)

**Step 1: Write the failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::initialize_db;
    use tempfile::TempDir;

    #[test]
    fn test_process_event_inserts_and_marks_processed() {
        let tmp = TempDir::new().unwrap();
        let conn = initialize_db(&tmp.path().join("test.db")).unwrap();
        // Insert project first (FK)
        conn.execute(
            "INSERT INTO projects (id, name, status, created_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params!["proj_test", "Test", "active", "2026-01-01T00:00:00Z"],
        ).unwrap();
        // Create event file
        let event = serde_json::json!({
            "event": "session_ended",
            "session_id": "ses_001",
            "project_id": "proj_test"
        });
        let event_path = tmp.path().join("test_event.json");
        std::fs::write(&event_path, serde_json::to_string(&event).unwrap()).unwrap();
        let result = process_event(&conn, &event_path, tmp.path());
        assert!(result.is_ok());
        // Check idempotency table
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM processed_events WHERE event_file = 'test_event.json'", [], |r| r.get(0)
        ).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_process_event_idempotent() {
        let tmp = TempDir::new().unwrap();
        let conn = initialize_db(&tmp.path().join("test.db")).unwrap();
        conn.execute(
            "INSERT INTO projects (id, name, status, created_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params!["proj_test", "Test", "active", "2026-01-01T00:00:00Z"],
        ).unwrap();
        let event = serde_json::json!({"event": "session_ended", "session_id": "ses_001", "project_id": "proj_test"});
        let event_path = tmp.path().join("evt.json");
        std::fs::write(&event_path, serde_json::to_string(&event).unwrap()).unwrap();
        process_event(&conn, &event_path, tmp.path()).unwrap();
        // Write again (simulating duplicate)
        std::fs::write(&event_path, serde_json::to_string(&event).unwrap()).unwrap();
        process_event(&conn, &event_path, tmp.path()).unwrap();
        // Should still be processed only once
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM processed_events", [], |r| r.get(0)
        ).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_process_event_deletes_file_after() {
        let tmp = TempDir::new().unwrap();
        let conn = initialize_db(&tmp.path().join("test.db")).unwrap();
        conn.execute(
            "INSERT INTO projects (id, name, status, created_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params!["proj_test", "Test", "active", "2026-01-01T00:00:00Z"],
        ).unwrap();
        let event = serde_json::json!({"event": "session_ended", "session_id": "ses_002", "project_id": "proj_test"});
        let event_path = tmp.path().join("evt2.json");
        std::fs::write(&event_path, serde_json::to_string(&event).unwrap()).unwrap();
        process_event(&conn, &event_path, tmp.path()).unwrap();
        assert!(!event_path.exists());
    }
}
```

**Step 2: Run tests to verify fail**

Run: `cargo test -p ctx-lab-app -- events::tests -v`
Expected: FAIL

**Step 3: Write implementation**

`crates/ctx-lab-app/src/events.rs`:
```rust
pub fn process_event(conn: &Connection, event_path: &Path, ctx_lab_dir: &Path) -> Result<()> {
    let filename = event_path.file_name()
        .and_then(|f| f.to_str())
        .ok_or_else(|| anyhow::anyhow!("invalid event path"))?;

    // Idempotency check
    let already: bool = conn.query_row(
        "SELECT COUNT(*) FROM processed_events WHERE event_file = ?",
        [filename], |row| row.get::<_, i64>(0),
    )? > 0;
    if already { return Ok(()); }

    // Parse event
    let content = std::fs::read_to_string(event_path)?;
    let event: serde_json::Value = serde_json::from_str(&content)?;
    let event_type = event.get("event").and_then(|e| e.as_str()).unwrap_or("");

    match event_type {
        "session_started" | "session_ended" => {
            // Route to incremental_update via the session file
            if let Some(session_id) = event.get("session_id").and_then(|s| s.as_str()) {
                if let Some(project_id) = event.get("project_id").and_then(|p| p.as_str()) {
                    // Find and process the session JSON
                    // ...
                }
            }
        }
        _ => { /* unknown event, log and skip */ }
    }

    // Mark processed
    conn.execute("INSERT INTO processed_events (event_file) VALUES (?)", [filename])?;
    // Delete event file
    std::fs::remove_file(event_path).ok();
    Ok(())
}
```

**Step 4: Run tests**

Run: `cargo test -p ctx-lab-app -- events::tests -v`
Expected: 3 tests PASS

**Step 5: Commit**

```bash
git add -A && git commit -m "feat(app): add idempotent event consumer (3 tests)"
```

---

## Task 4: File Watcher (notify + polling fallback)

**Files:**
- Create: `crates/ctx-lab-app/src/watcher.rs`

**Step 1: Write the failing test**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use tempfile::TempDir;

    #[test]
    fn test_polling_detects_new_file() {
        let tmp = TempDir::new().unwrap();
        let events_dir = tmp.path().join(".events");
        std::fs::create_dir_all(&events_dir).unwrap();
        let (tx, rx) = mpsc::channel();
        // Start polling in background
        let poll_dir = tmp.path().to_path_buf();
        std::thread::spawn(move || {
            poll_directory(&poll_dir.join(".events"), tx, std::time::Duration::from_millis(50));
        });
        // Wait for polling to initialize
        std::thread::sleep(std::time::Duration::from_millis(100));
        // Create a file
        std::fs::write(events_dir.join("test.json"), "{}").unwrap();
        // Should receive event within 200ms
        let event = rx.recv_timeout(std::time::Duration::from_millis(500));
        assert!(event.is_ok());
        match event.unwrap() {
            WatchEvent::NewEvent(path) => assert!(path.ends_with("test.json")),
            _ => panic!("expected NewEvent"),
        }
    }
}
```

**Step 2: Run test to verify fail**

Run: `cargo test -p ctx-lab-app -- watcher::tests -v`
Expected: FAIL

**Step 3: Write implementation**

`crates/ctx-lab-app/src/watcher.rs` with:
- `WatchEvent` enum: `NewEvent(PathBuf)`, `DataChanged(PathBuf)`
- `start_watcher(ctx_lab_dir, tx)` — spawns notify thread + polling thread
- `poll_directory(dir, tx, interval)` — standalone polling loop (testable)

**Step 4: Run test**

Run: `cargo test -p ctx-lab-app -- watcher::tests -v`
Expected: PASS

**Step 5: Commit**

```bash
git add -A && git commit -m "feat(app): add file watcher with notify + polling fallback (1 test)"
```

---

## Task 5: Tauri IPC Commands (commands.rs)

**Files:**
- Create: `crates/ctx-lab-app/src/commands.rs`
- Modify: `crates/ctx-lab-app/src/main.rs` (register commands)

**Step 1: Write the failing tests**

Test her IPC command'ı doğrudan Rust fonksiyonu olarak çağırarak (Tauri state mock ile):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::initialize_db;
    use tempfile::TempDir;

    fn setup() -> (TempDir, DbPool) {
        let tmp = TempDir::new().unwrap();
        let conn = initialize_db(&tmp.path().join("test.db")).unwrap();
        // Insert test data
        conn.execute(
            "INSERT INTO projects (id, name, status, created_at, progress_percent) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params!["proj_1", "Test Project", "active", "2026-01-01T00:00:00Z", 50.0],
        ).unwrap();
        conn.execute(
            "INSERT INTO sessions (id, project_id, machine, started_at, summary, summary_source, duration_minutes) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params!["ses_1", "proj_1", "macbook", "2026-01-01T10:00:00Z", "Did stuff", "git_only", 30],
        ).unwrap();
        let pool = DbPool::new(tmp.path().join("test.db")).unwrap();
        (tmp, pool)
    }

    #[test]
    fn test_get_projects_returns_active() {
        let (_tmp, pool) = setup();
        let projects = get_projects_inner(&pool).unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].name, "Test Project");
    }

    #[test]
    fn test_get_project_detail() {
        let (_tmp, pool) = setup();
        let detail = get_project_detail_inner(&pool, "proj_1".into()).unwrap();
        assert_eq!(detail.name, "Test Project");
        assert_eq!(detail.recent_sessions.len(), 1);
    }

    #[test]
    fn test_get_sessions() {
        let (_tmp, pool) = setup();
        let sessions = get_sessions_inner(&pool, "proj_1".into(), 10).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].summary, "Did stuff");
    }
}
```

**Step 2: Run test to verify fail**

**Step 3: Write implementation**

`commands.rs` with:
- `DbPool` — `rusqlite::Connection` wrapper with `std::sync::Mutex` (Tauri state requires Send+Sync)
- Inner functions (testable without Tauri): `get_projects_inner`, `get_project_detail_inner`, `get_sessions_inner`, `get_roadmap_inner`, `rebuild_cache_inner`
- Tauri command wrappers: `#[tauri::command] fn get_projects(...)` that delegate to inner functions
- Serde structs: `ProjectSummary`, `ProjectDetail`, `SessionInfo`, `RoadmapData` (serialize for frontend)

**Step 4: Run tests**

Run: `cargo test -p ctx-lab-app -- commands::tests -v`
Expected: 3 tests PASS

**Step 5: Commit**

```bash
git add -A && git commit -m "feat(app): add Tauri IPC commands — get_projects, get_detail, get_sessions (3 tests)"
```

---

## Task 6: Tauri main.rs — App Setup, State, Watcher Integration

**Files:**
- Modify: `crates/ctx-lab-app/src/main.rs`

**Step 1: Write Tauri app bootstrap**

```rust
mod db;
mod reconcile;
mod events;
mod watcher;
mod commands;

use commands::DbPool;
use std::sync::mpsc;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let ctx_lab_dir = ctx_lab_core::storage::ctx_lab_dir()?;
            let db_path = ctx_lab_dir.join("cache.db");

            // Initialize DB
            let pool = DbPool::new(&db_path)?;

            // Full rebuild on first run (or if cache.db was deleted)
            {
                let conn = pool.get()?;
                reconcile::full_rebuild(&conn, &ctx_lab_dir)?;
            }

            // Start file watcher
            let (tx, rx) = mpsc::channel();
            watcher::start_watcher(ctx_lab_dir.clone(), tx);

            // Watcher consumer thread
            let pool_clone = pool.clone();
            let dir_clone = ctx_lab_dir.clone();
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                for event in rx {
                    match event {
                        watcher::WatchEvent::NewEvent(path) => {
                            if let Ok(conn) = pool_clone.get() {
                                let _ = events::process_event(&conn, &path, &dir_clone);
                                // Emit refresh event to frontend
                                let _ = app_handle.emit("ctx-lab-refresh", ());
                            }
                        }
                        watcher::WatchEvent::DataChanged(path) => {
                            if let Ok(conn) = pool_clone.get() {
                                let _ = reconcile::incremental_update(&conn, &path, &dir_clone);
                                let _ = app_handle.emit("ctx-lab-refresh", ());
                            }
                        }
                    }
                }
            });

            app.manage(pool);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_projects,
            commands::get_project_detail,
            commands::get_sessions,
            commands::get_roadmap,
            commands::rebuild_cache,
            commands::get_settings,
            commands::update_settings,
            commands::open_in_editor,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**Step 2: Build verification**

Run: `cargo build -p ctx-lab-app`
Expected: Compiles without errors

**Step 3: Commit**

```bash
git add -A && git commit -m "feat(app): wire Tauri main — DB init, watcher, event consumer, IPC handlers"
```

---

## Task 7: Frontend — TypeScript Types + Tauri IPC Wrapper

**Files:**
- Create: `frontend/src/lib/types.ts`
- Create: `frontend/src/lib/tauri.ts`

**Step 1: Write TypeScript interfaces**

`frontend/src/lib/types.ts` — matches Rust structs exactly:
```typescript
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
  recent_sessions: SessionInfo[];
  decisions: Decision[];
}

export interface SessionInfo {
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
```

**Step 2: Write Tauri IPC wrapper**

`frontend/src/lib/tauri.ts`:
```typescript
import { invoke } from "@tauri-apps/api/core";
import type { ProjectSummary, ProjectDetail, SessionInfo, RoadmapData } from "./types";

export const api = {
  getProjects: () => invoke<ProjectSummary[]>("get_projects"),
  getProjectDetail: (projectId: string) => invoke<ProjectDetail>("get_project_detail", { projectId }),
  getSessions: (projectId: string, limit: number = 20) => invoke<SessionInfo[]>("get_sessions", { projectId, limit }),
  getRoadmap: (projectId: string) => invoke<RoadmapData>("get_roadmap", { projectId }),
  rebuildCache: () => invoke<{ added: number; removed: number; updated: number }>("rebuild_cache"),
  openInEditor: (projectId: string) => invoke<void>("open_in_editor", { projectId }),
};
```

**Step 3: Build verification**

Run: `cd frontend && npx tsc --noEmit`
Expected: No type errors

**Step 4: Commit**

```bash
git add -A && git commit -m "feat(frontend): add TypeScript types and Tauri IPC wrapper"
```

---

## Task 8: Frontend — React Hooks (useProjects, useSessions, useRoadmap)

**Files:**
- Create: `frontend/src/hooks/useProjects.ts`
- Create: `frontend/src/hooks/useSessions.ts`
- Create: `frontend/src/hooks/useRoadmap.ts`
- Create: `frontend/src/hooks/useTauriEvent.ts`

**Step 1: Write custom hooks**

`useProjects.ts`:
```typescript
import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/tauri";
import { useTauriEvent } from "./useTauriEvent";
import type { ProjectSummary } from "../lib/types";

export function useProjects() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api.getProjects();
      setProjects(data);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useTauriEvent("ctx-lab-refresh", refresh);

  return { projects, loading, error, refresh };
}
```

`useTauriEvent.ts`:
```typescript
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

export function useTauriEvent(event: string, handler: () => void) {
  useEffect(() => {
    const unlisten = listen(event, handler);
    return () => { unlisten.then(fn => fn()); };
  }, [event, handler]);
}
```

Similar patterns for `useSessions.ts` and `useRoadmap.ts`.

**Step 2: Build verification**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add -A && git commit -m "feat(frontend): add React hooks — useProjects, useSessions, useRoadmap, useTauriEvent"
```

---

## Task 9: Frontend — Dashboard Page (Hero Screen)

**Files:**
- Create: `frontend/src/pages/Dashboard.tsx`
- Create: `frontend/src/components/ProjectCard.tsx`
- Create: `frontend/src/components/QuickResume.tsx`
- Create: `frontend/src/components/ProgressBar.tsx`
- Modify: `frontend/src/App.tsx` (router setup)

**Step 1: Write components**

`ProgressBar.tsx` — Simple percentage bar with Tailwind.

`ProjectCard.tsx` — Kart: proje adı, son özet (2 satır truncate), progress bar, son makine+tarih, "Aç" butonu.

`QuickResume.tsx` — En son çalışılan proje büyük kart: son oturum özeti, "Devam Et" butonu (VSCode açar).

`Dashboard.tsx`:
```tsx
import { useProjects } from "../hooks/useProjects";
import { ProjectCard } from "../components/ProjectCard";
import { QuickResume } from "../components/QuickResume";

export function Dashboard() {
  const { projects, loading } = useProjects();
  if (loading) return <div className="p-8 text-center">Loading...</div>;

  const active = projects.filter(p => p.status === "active");
  const lastProject = active[0]; // sorted by last_session_at DESC

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">ctx-lab</h1>
      {lastProject && <QuickResume project={lastProject} />}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
        {active.map(p => <ProjectCard key={p.id} project={p} />)}
      </div>
    </div>
  );
}
```

`App.tsx`:
```tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Dashboard } from "./pages/Dashboard";
import { ProjectDetail } from "./pages/ProjectDetail";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/project/:id" element={<ProjectDetail />} />
      </Routes>
    </BrowserRouter>
  );
}
export default App;
```

**Step 2: Build verification**

Run: `cd frontend && npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add -A && git commit -m "feat(frontend): add Dashboard page — ProjectCard, QuickResume, ProgressBar"
```

---

## Task 10: Frontend — Project Detail Page

**Files:**
- Create: `frontend/src/pages/ProjectDetail.tsx`
- Create: `frontend/src/components/SessionTimeline.tsx`
- Create: `frontend/src/components/RoadmapView.tsx`
- Create: `frontend/src/components/DecisionHistory.tsx`

**Step 1: Write components**

`RoadmapView.tsx` — Fazlar + items. Status'a göre renk/ikon: done=green check, active=blue arrow, pending=gray circle, suspended=yellow pause, blocked=red exclamation.

`SessionTimeline.tsx` — Son 20 session, her biri: tarih, makine badge, süre, özet (truncated), files_changed.

`DecisionHistory.tsx` — Kronolojik kararlar listesi.

`ProjectDetail.tsx`:
```tsx
import { useParams } from "react-router-dom";
import { useState, useEffect } from "react";
import { api } from "../lib/tauri";
import { RoadmapView } from "../components/RoadmapView";
import { SessionTimeline } from "../components/SessionTimeline";
import { DecisionHistory } from "../components/DecisionHistory";
import type { ProjectDetail as ProjectDetailType } from "../lib/types";

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<ProjectDetailType | null>(null);

  useEffect(() => {
    if (id) api.getProjectDetail(id).then(setDetail);
  }, [id]);

  if (!detail) return <div className="p-8">Loading...</div>;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <h1 className="text-2xl font-bold mb-4">{detail.name}</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RoadmapView roadmap={detail.roadmap} />
        <SessionTimeline sessions={detail.recent_sessions} />
      </div>
      {detail.decisions.length > 0 && <DecisionHistory decisions={detail.decisions} />}
    </div>
  );
}
```

**Step 2: Build verification**

Run: `cd frontend && npm run build`
Expected: Succeeds

**Step 3: Commit**

```bash
git add -A && git commit -m "feat(frontend): add ProjectDetail page — RoadmapView, SessionTimeline, DecisionHistory"
```

---

## Task 11: Frontend — i18n + Dark Mode

**Files:**
- Create: `frontend/src/i18n.ts`
- Create: `frontend/public/locales/en/translation.json`
- Modify: `frontend/src/main.tsx` (i18n import)
- Modify: Dashboard + ProjectDetail (useTranslation)

**Step 1: Setup i18next**

`frontend/src/i18n.ts`:
```typescript
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

i18n.use(initReactI18next).init({
  resources: {
    en: {
      translation: {
        "dashboard.title": "ctx-lab",
        "dashboard.quickResume": "Continue where you left off",
        "dashboard.noProjects": "No projects yet",
        "project.roadmap": "Roadmap",
        "project.sessions": "Sessions",
        "project.decisions": "Decisions",
        "common.loading": "Loading...",
        "common.openEditor": "Open in Editor",
      }
    }
  },
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
```

Dark mode: Tailwind `dark:` classes already in components. Add a toggle in layout that sets `document.documentElement.classList.toggle('dark')` and persists to localStorage.

**Step 2: Build verification**

Run: `cd frontend && npm run build`
Expected: Succeeds

**Step 3: Commit**

```bash
git add -A && git commit -m "feat(frontend): add i18n (EN) and dark mode toggle"
```

---

## Task 12: System Tray (tray.rs)

**Files:**
- Create: `crates/ctx-lab-app/src/tray.rs`
- Modify: `crates/ctx-lab-app/src/main.rs` (tray setup)

**Step 1: Write implementation**

`tray.rs`:
```rust
use tauri::{
    tray::{TrayIconBuilder, MouseButton, MouseButtonState},
    menu::{MenuBuilder, MenuItemBuilder},
    Manager,
};

pub fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let open_dashboard = MenuItemBuilder::with_id("open", "Open Dashboard").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&open_dashboard)
        .separator()
        .item(&quit)
        .build()?;

    TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("ctx-lab")
        .on_menu_event(move |app, event| {
            match event.id().as_ref() {
                "open" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "quit" => { app.exit(0); }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up, ..
            } = event {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}
```

**Step 2: Wire in main.rs**

Add to `.setup(|app|)`:
```rust
tray::setup_tray(app)?;
```

`tauri.conf.json`'da system tray ayarları: `"tray": { "iconPath": "icons/icon.png" }`

**Step 3: Build verification**

Run: `cargo build -p ctx-lab-app`
Expected: Compiles

**Step 4: Commit**

```bash
git add -A && git commit -m "feat(app): add system tray — open dashboard, quit menu"
```

---

## Task 13: Reconcile Job (Periodic Timer)

**Files:**
- Modify: `crates/ctx-lab-app/src/main.rs` (reconcile timer thread)
- Modify: `crates/ctx-lab-app/src/reconcile.rs` (add `reconcile()` function)

**Step 1: Write the failing test for reconcile()**

```rust
#[test]
fn test_reconcile_finds_missing_sessions() {
    let (tmp, conn) = setup_test_env();
    full_rebuild(&conn, tmp.path()).unwrap();
    // Add a session file after rebuild
    let session = serde_json::json!({
        "schema_version": 1, "id": "ses_late", "project_id": "proj_test",
        "machine": "mac", "started_at": "2026-01-05T10:00:00Z",
        "summary": "late session", "summary_source": "git_only"
    });
    std::fs::write(
        tmp.path().join("projects/test-project/sessions/late.json"),
        serde_json::to_string(&session).unwrap()
    ).unwrap();
    let report = reconcile(&conn, tmp.path()).unwrap();
    assert_eq!(report.added, 1);
}
```

**Step 2: Implement reconcile()**

Diff fs session list vs SQLite session list, INSERT missing, DELETE orphaned.

**Step 3: Wire periodic timer in main.rs**

```rust
// Reconcile every 10 minutes
let pool_reconcile = pool.clone();
let dir_reconcile = ctx_lab_dir.clone();
std::thread::spawn(move || {
    loop {
        std::thread::sleep(std::time::Duration::from_secs(600));
        if let Ok(conn) = pool_reconcile.get() {
            let _ = reconcile::reconcile(&conn, &dir_reconcile);
        }
    }
});
```

**Step 4: Run test**

Run: `cargo test -p ctx-lab-app -- reconcile::tests::test_reconcile -v`
Expected: PASS

**Step 5: Commit**

```bash
git add -A && git commit -m "feat(app): add periodic reconcile job (10 min interval)"
```

---

## Task 14: Process Watcher (Katman 3 Heartbeat)

**Files:**
- Create: `crates/ctx-lab-app/src/process_watcher.rs`

**Step 1: Write implementation**

```rust
use sysinfo::System;

pub fn is_claude_running() -> bool {
    let s = System::new_all();
    s.processes().values().any(|p| {
        let name = p.name().to_string_lossy().to_lowercase();
        name.contains("claude")
    })
}

pub fn start_process_watcher(enabled: bool, tx: std::sync::mpsc::Sender<bool>) {
    if !enabled { return; }
    std::thread::spawn(move || {
        let mut was_running = false;
        loop {
            std::thread::sleep(std::time::Duration::from_secs(600));
            let running = is_claude_running();
            if was_running && !running {
                let _ = tx.send(false); // Claude stopped
            }
            was_running = running;
        }
    });
}
```

Default: config.toml'da `process_watcher_enabled = false` (v1'de opt-in).

**Step 2: Commit**

```bash
git add -A && git commit -m "feat(app): add process watcher (Claude heartbeat, default disabled)"
```

---

## Task 15: Hook Binary Integration — `.events/` IPC Bridge

**Files:**
- Modify: `crates/ctx-lab-hook/src/session_start.rs` (write event to `.events/`)
- Modify: `crates/ctx-lab-hook/src/checkpoint.rs` (write event to `.events/`)
- Modify: `crates/ctx-lab-hook/src/stop.rs` (write event to `.events/`)
- Modify: `crates/ctx-lab-hook/src/session_end.rs` (write event to `.events/`)

**Step 1: Add event emission to hook commands**

Her hook subcommand'ı `.events/` dizinine küçük bir JSON yazar (Tauri file watcher bunu algılayıp SQLite'ı günceller):

```rust
// Shared helper — crates/ctx-lab-core/src/storage.rs'e eklenebilir veya hook'ta inline
fn emit_event(event_type: &str, session_id: &str, project_id: &str) -> Result<()> {
    let events_dir = ctx_lab_core::storage::ctx_lab_dir()?.join(".events");
    std::fs::create_dir_all(&events_dir)?;
    let filename = format!(
        "{}_{}.json",
        chrono::Utc::now().format("%Y%m%d_%H%M%S_%3f"),
        uuid::Uuid::new_v4().to_string().split('-').next().unwrap_or("x")
    );
    let event = serde_json::json!({
        "event": event_type,
        "session_id": session_id,
        "project_id": project_id,
        "timestamp": chrono::Utc::now().to_rfc3339()
    });
    ctx_lab_core::storage::atomic_write(
        &events_dir.join(&filename),
        serde_json::to_string(&event)?.as_bytes()
    )
}
```

Add calls:
- `session_start.rs` → `emit_event("session_started", session_id, project_id)`
- `session_end.rs` → `emit_event("session_ended", session_id, project_id)`
- `stop.rs` → `emit_event("stop", session_id, project_id)` (optional)
- `checkpoint.rs` → no event (too frequent, watcher already monitors data changes)

**Step 2: Test**

Run: `cargo test --workspace`
Expected: All existing 74+ tests still pass

**Step 3: Commit**

```bash
git add -A && git commit -m "feat(hook): emit .events/ IPC files for Tauri app integration"
```

---

## Task 16: Settings Page (Frontend)

**Files:**
- Create: `frontend/src/pages/Settings.tsx`
- Modify: `frontend/src/App.tsx` (add route)

**Step 1: Write Settings page**

Privacy mode dropdown, checkpoint interval slider, theme toggle, "Rebuild Cache" button, hook doctor output.

**Step 2: Build**

Run: `cd frontend && npm run build`

**Step 3: Commit**

```bash
git add -A && git commit -m "feat(frontend): add Settings page — privacy, theme, rebuild cache"
```

---

## Task 17: End-to-End Integration Test

**Files:**
- Create: `crates/ctx-lab-app/tests/e2e_test.rs`

**Step 1: Write E2E test**

```rust
#[test]
fn test_full_flow_session_to_dashboard() {
    // 1. Init data dir
    // 2. Create a project (meta.toml)
    // 3. Initialize DB
    // 4. Full rebuild
    // 5. Verify project in SQLite
    // 6. Simulate session_start event → emit_event
    // 7. Write session JSON
    // 8. Process event
    // 9. Verify session in SQLite
    // 10. Verify project_summary view updated
}
```

**Step 2: Run**

Run: `cargo test -p ctx-lab-app --test e2e_test -v`
Expected: PASS

**Step 3: Commit**

```bash
git add -A && git commit -m "test(app): add end-to-end integration test — session to dashboard flow"
```

---

## Task 18: Final Build + Smoke Test

**Step 1: Full workspace test**

Run: `cargo test --workspace`
Expected: All tests pass (target: ~90+ tests)

**Step 2: Clippy**

Run: `cargo clippy --workspace -- -D warnings`
Expected: No warnings

**Step 3: Release build**

Run: `cargo tauri build`
Expected: `.app` bundle created

**Step 4: Manual smoke test**

1. Open ctx-lab app — Dashboard görünmeli
2. Projeler kartlarla listelenmeli
3. Bir projeye tıkla — roadmap + sessions görünmeli
4. System tray'de ctx-lab ikonu olmalı
5. Yeni bir Claude Code oturumu aç → `.events/` tetiklenmeli → dashboard auto-refresh

**Step 5: Commit**

```bash
git add -A && git commit -m "chore: Faz B complete — Tauri app, SQLite, dashboard, system tray"
git push
```

---

## Summary

| Task | Bileşen | Tahmini Test |
|------|---------|-------------|
| 0 | Tauri v2 + Frontend iskeleti | build check |
| 1 | SQLite schema + migration | 4 test |
| 2 | Reconcile (full + incremental) | 5 test |
| 3 | Event consumer (idempotent) | 3 test |
| 4 | File watcher (notify + poll) | 1 test |
| 5 | Tauri IPC commands | 3 test |
| 6 | Main.rs wiring | build check |
| 7 | TS types + IPC wrapper | type check |
| 8 | React hooks | type check |
| 9 | Dashboard page | build check |
| 10 | Project Detail page | build check |
| 11 | i18n + dark mode | build check |
| 12 | System tray | build check |
| 13 | Reconcile job (periodic) | 1 test |
| 14 | Process watcher | build check |
| 15 | Hook → .events/ bridge | existing tests |
| 16 | Settings page | build check |
| 17 | E2E integration test | 1 test |
| 18 | Final build + smoke | manual |

**Toplam:** 19 task, ~18+ yeni test, ~18 commit
