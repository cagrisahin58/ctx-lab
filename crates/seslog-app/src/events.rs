use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use std::fs;
use std::path::Path;

/// Process a single event file idempotently.
///
/// 1. Extract filename from `event_path`.
/// 2. Check `processed_events` table — if already processed, return Ok(()).
/// 3. Read & parse the event JSON.
/// 4. Dispatch based on the `"event"` field.
/// 5. Mark the event as processed in the DB.
/// 6. Delete the event file from disk.
pub fn process_event(conn: &Connection, event_path: &Path, data_dir: &Path) -> Result<()> {
    let filename = event_path
        .file_name()
        .and_then(|f| f.to_str())
        .context("Event path has no filename")?
        .to_string();

    // Idempotency check — skip if already processed.
    let already: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM processed_events WHERE event_file = ?1",
        params![filename],
        |row| row.get(0),
    )?;

    if already {
        return Ok(());
    }

    // Read and parse the event JSON.
    let content = fs::read_to_string(event_path)
        .with_context(|| format!("Reading event file {}", event_path.display()))?;
    let json: serde_json::Value = serde_json::from_str(&content)
        .with_context(|| format!("Parsing event JSON {}", event_path.display()))?;

    let event_type = json
        .get("event")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let project_id = json.get("project_id").and_then(|v| v.as_str());
    let session_id = json.get("session_id").and_then(|v| v.as_str());

    match event_type {
        "session_started" => {
            if let (Some(pid), Some(sid)) = (project_id, session_id) {
                let session_path = find_session_file(data_dir, pid, sid);
                if let Some(path) = session_path {
                    crate::reconcile::incremental_update(conn, &path, data_dir)?;
                }
            }
        }
        "session_ended" => {
            if let (Some(pid), Some(sid)) = (project_id, session_id) {
                let session_path = find_session_file(data_dir, pid, sid);
                if let Some(path) = session_path {
                    crate::reconcile::incremental_update(conn, &path, data_dir)?;
                }
                // Update project aggregates (total_sessions, total_duration, last_session_at, last_machine).
                update_project_aggregates(conn, pid)?;
            }
        }
        other => {
            eprintln!("events: unknown event type '{}', skipping", other);
        }
    }

    // Mark processed.
    conn.execute(
        "INSERT OR IGNORE INTO processed_events (event_file) VALUES (?1)",
        params![filename],
    )?;

    // Delete the event file from disk.
    if event_path.exists() {
        fs::remove_file(event_path)
            .with_context(|| format!("Deleting event file {}", event_path.display()))?;
    }

    Ok(())
}

/// Locate the session JSON file for a given project/session inside data_dir.
///
/// Convention: `projects/{slug}/sessions/{session_id}.json`
/// We need to find the project slug directory that contains a `meta.toml`
/// whose `project.id` matches `project_id`.
fn find_session_file(data_dir: &Path, project_id: &str, session_id: &str) -> Option<std::path::PathBuf> {
    let projects_dir = data_dir.join("projects");
    if !projects_dir.is_dir() {
        return None;
    }

    let entries = fs::read_dir(&projects_dir).ok()?;
    for entry in entries.flatten() {
        if !entry.file_type().ok()?.is_dir() {
            continue;
        }
        let meta_path = entry.path().join("meta.toml");
        if !meta_path.exists() {
            continue;
        }
        // Quick check: read meta.toml and see if it contains the project_id.
        if let Ok(meta_content) = fs::read_to_string(&meta_path) {
            if let Ok(meta) = toml::from_str::<seslog_core::models::ProjectMeta>(&meta_content) {
                if meta.project.id == project_id {
                    let session_path =
                        entry.path().join("sessions").join(format!("{}.json", session_id));
                    if session_path.exists() {
                        return Some(session_path);
                    }
                }
            }
        }
    }

    None
}

/// Re-compute aggregate columns on the projects row from sessions data.
fn update_project_aggregates(conn: &Connection, project_id: &str) -> Result<()> {
    conn.execute(
        "UPDATE projects SET
            total_sessions = (SELECT COUNT(*) FROM sessions WHERE project_id = ?1),
            total_duration_minutes = (SELECT COALESCE(SUM(duration_minutes), 0) FROM sessions WHERE project_id = ?1),
            last_session_at = (SELECT started_at FROM sessions WHERE project_id = ?1 ORDER BY started_at DESC LIMIT 1),
            last_machine = (SELECT machine FROM sessions WHERE project_id = ?1 ORDER BY started_at DESC LIMIT 1)
         WHERE id = ?1",
        params![project_id],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::initialize_db;
    use tempfile::TempDir;

    /// Set up a temp seslog directory with DB, a project, and a session file.
    /// Returns (TempDir, Connection, path-to-events-dir).
    fn setup() -> (TempDir, Connection, std::path::PathBuf) {
        let dir = TempDir::new().expect("failed to create temp dir");

        // Initialize DB.
        let db_path = dir.path().join("test.db");
        let conn = initialize_db(&db_path).expect("initialize_db failed");

        // Create project structure.
        let project_dir = dir.path().join("projects").join("test-project");
        fs::create_dir_all(project_dir.join("sessions")).unwrap();

        // Write a minimal meta.toml.
        let meta_toml = r#"schema_version = 1

[project]
id = "proj_test"
name = "Test Project"
status = "active"
created_at = "2026-01-01T00:00:00Z"

[paths]
"#;
        fs::write(project_dir.join("meta.toml"), meta_toml).unwrap();

        // Insert project into DB so FK constraints are satisfied.
        conn.execute(
            "INSERT INTO projects (id, name) VALUES (?1, ?2)",
            params!["proj_test", "Test Project"],
        )
        .unwrap();

        // Write a session JSON that the event handler will reference.
        let session_json = r#"{
            "schema_version": 1,
            "id": "ses_001",
            "project_id": "proj_test",
            "machine": "macbook",
            "started_at": "2026-01-15T10:00:00Z",
            "summary": "Did some work",
            "summary_source": "transcript+git",
            "transcript_highlights": ["highlight 1"]
        }"#;
        fs::write(
            project_dir.join("sessions").join("ses_001.json"),
            session_json,
        )
        .unwrap();

        // Create an events directory.
        let events_dir = dir.path().join(".events");
        fs::create_dir_all(&events_dir).unwrap();

        (dir, conn, events_dir)
    }

    /// Helper: write an event JSON file and return its path.
    fn write_event(events_dir: &Path, filename: &str) -> std::path::PathBuf {
        let event_json = r#"{
            "event": "session_ended",
            "session_id": "ses_001",
            "project_id": "proj_test",
            "timestamp": "2026-01-01T10:00:00Z"
        }"#;
        let path = events_dir.join(filename);
        fs::write(&path, event_json).unwrap();
        path
    }

    #[test]
    fn test_process_event_inserts_and_marks_processed() {
        let (dir, conn, events_dir) = setup();
        let event_path = write_event(&events_dir, "evt_001.json");

        process_event(&conn, &event_path, dir.path()).unwrap();

        // Verify: processed_events table has 1 row with the event filename.
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM processed_events WHERE event_file = 'evt_001.json'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_process_event_idempotent() {
        let (dir, conn, events_dir) = setup();
        let event_path = write_event(&events_dir, "evt_002.json");

        // First call — processes and deletes the file.
        process_event(&conn, &event_path, dir.path()).unwrap();

        // Re-create the file so the second call can read it (first call deleted it).
        write_event(&events_dir, "evt_002.json");

        // Second call — should be a no-op due to idempotency check.
        process_event(&conn, &event_path, dir.path()).unwrap();

        // Verify: still exactly 1 row.
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM processed_events WHERE event_file = 'evt_002.json'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_process_event_deletes_file_after() {
        let (dir, conn, events_dir) = setup();
        let event_path = write_event(&events_dir, "evt_003.json");

        assert!(event_path.exists(), "event file should exist before processing");

        process_event(&conn, &event_path, dir.path()).unwrap();

        assert!(
            !event_path.exists(),
            "event file should be deleted after processing"
        );
    }
}
