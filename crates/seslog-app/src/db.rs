use anyhow::{bail, Context, Result};
use rusqlite::Connection;
use std::path::Path;

/// Current schema version. Bump when adding migrations.
pub const CURRENT_SCHEMA_VERSION: u32 = 1;

/// DDL for schema version 1.
pub const SCHEMA_V1: &str = r#"
CREATE TABLE IF NOT EXISTS projects (
    id                      TEXT PRIMARY KEY NOT NULL,
    name                    TEXT NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'active',
    created_at              TEXT NOT NULL DEFAULT (datetime('now')),
    archived_at             TEXT,
    description             TEXT,
    total_sessions          INTEGER NOT NULL DEFAULT 0,
    total_duration_minutes  INTEGER NOT NULL DEFAULT 0,
    last_session_at         TEXT,
    last_machine            TEXT,
    progress_percent        INTEGER NOT NULL DEFAULT 0,
    meta_toml_path          TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
    id                  TEXT PRIMARY KEY NOT NULL,
    project_id          TEXT NOT NULL REFERENCES projects(id),
    machine             TEXT NOT NULL,
    started_at          TEXT NOT NULL,
    ended_at            TEXT,
    duration_minutes    INTEGER,
    end_reason          TEXT,
    summary             TEXT,
    summary_source      TEXT,
    next_steps          TEXT,
    files_changed       TEXT,
    recovered           INTEGER NOT NULL DEFAULT 0,
    redaction_count     INTEGER NOT NULL DEFAULT 0,
    source_path         TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transcript_highlights (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL REFERENCES sessions(id),
    content     TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS roadmap_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  TEXT NOT NULL REFERENCES projects(id),
    phase       TEXT,
    item_text   TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS decisions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  TEXT NOT NULL REFERENCES projects(id),
    date        TEXT,
    title       TEXT NOT NULL,
    description TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS machines (
    hostname        TEXT PRIMARY KEY NOT NULL,
    platform        TEXT,
    registered_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS processed_events (
    event_file      TEXT PRIMARY KEY NOT NULL,
    processed_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sessions_project  ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started  ON sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_machine  ON sessions(machine);
CREATE INDEX IF NOT EXISTS idx_roadmap_project   ON roadmap_items(project_id);

-- Aggregated project summary view
CREATE VIEW IF NOT EXISTS project_summary AS
SELECT
    p.id,
    p.name,
    p.status,
    p.created_at,
    p.progress_percent,
    COUNT(s.id)              AS session_count,
    COALESCE(SUM(s.duration_minutes), 0) AS total_minutes,
    (SELECT s2.summary
     FROM sessions s2
     WHERE s2.project_id = p.id
     ORDER BY s2.started_at DESC
     LIMIT 1)                AS last_summary,
    (SELECT s3.machine
     FROM sessions s3
     WHERE s3.project_id = p.id
     ORDER BY s3.started_at DESC
     LIMIT 1)                AS last_machine
FROM projects p
LEFT JOIN sessions s ON s.project_id = p.id
GROUP BY p.id;
"#;

/// Open (or create) the database at `db_path`, apply migrations, and return
/// a ready-to-use connection with WAL mode and foreign keys enabled.
pub fn initialize_db(db_path: &Path) -> Result<Connection> {
    let conn = Connection::open(db_path)
        .with_context(|| format!("Failed to open database at {}", db_path.display()))?;

    // Enable WAL journal mode for better concurrent-read performance.
    conn.pragma_update(None, "journal_mode", "wal")?;

    // Enforce foreign-key constraints.
    conn.pragma_update(None, "foreign_keys", "ON")?;

    // Read the current schema version stored in the database.
    let version: u32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

    if version == 0 {
        // Fresh database — apply the initial schema.
        conn.execute_batch(SCHEMA_V1)
            .context("Failed to apply SCHEMA_V1")?;
        conn.pragma_update(None, "user_version", CURRENT_SCHEMA_VERSION)?;
    } else if version < CURRENT_SCHEMA_VERSION {
        // Incremental migration path.
        apply_migration(&conn, version, CURRENT_SCHEMA_VERSION)?;
        conn.pragma_update(None, "user_version", CURRENT_SCHEMA_VERSION)?;
    }
    // If version == CURRENT_SCHEMA_VERSION, nothing to do.

    Ok(conn)
}

/// Apply incremental migrations from `from_version` to `to_version`.
/// Currently only version 1 exists, so any unknown migration range is an error.
pub fn apply_migration(conn: &Connection, from: u32, to: u32) -> Result<()> {
    // Placeholder: add match arms as new versions are introduced.
    let _ = conn; // suppress unused warning
    bail!(
        "Unknown migration path: v{} -> v{}. \
         Please update seslog-app to handle this migration.",
        from,
        to
    );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// Helper: create a temporary database and return (connection, temp_dir).
    /// We keep the TempDir alive so the file isn't deleted prematurely.
    fn setup() -> (Connection, TempDir) {
        let dir = TempDir::new().expect("failed to create temp dir");
        let db_path = dir.path().join("test.db");
        let conn = initialize_db(&db_path).expect("initialize_db failed");
        (conn, dir)
    }

    #[test]
    fn test_initialize_db_creates_tables() {
        let (conn, _dir) = setup();

        let tables: Vec<String> = conn
            .prepare(
                "SELECT name FROM sqlite_master \
                 WHERE type = 'table' AND name NOT LIKE 'sqlite_%' \
                 ORDER BY name",
            )
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        for expected in &[
            "projects",
            "sessions",
            "transcript_highlights",
            "roadmap_items",
            "decisions",
            "machines",
            "processed_events",
        ] {
            assert!(
                tables.contains(&expected.to_string()),
                "Missing table: {expected}"
            );
        }
    }

    #[test]
    fn test_initialize_db_sets_wal_mode() {
        let (conn, _dir) = setup();

        let mode: String =
            conn.pragma_query_value(None, "journal_mode", |row| row.get(0))
                .unwrap();

        assert_eq!(mode.to_lowercase(), "wal");
    }

    #[test]
    fn test_initialize_db_idempotent() {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("test.db");

        // First call
        let conn1 = initialize_db(&db_path).expect("first init failed");
        let v1: u32 = conn1
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(v1, 1);
        drop(conn1);

        // Second call on the same file
        let conn2 = initialize_db(&db_path).expect("second init failed");
        let v2: u32 = conn2
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(v2, 1);
    }

    #[test]
    fn test_project_summary_view_exists() {
        let (conn, _dir) = setup();

        // Insert a project so the view has something to return.
        conn.execute(
            "INSERT INTO projects (id, name) VALUES (?1, ?2)",
            rusqlite::params!["proj-1", "Test Project"],
        )
        .unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM project_summary", [], |row| {
                row.get(0)
            })
            .unwrap();

        assert_eq!(count, 1);
    }
}
