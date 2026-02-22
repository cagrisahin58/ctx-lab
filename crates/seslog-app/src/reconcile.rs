use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use std::fs;
use std::path::Path;

use seslog_core::models::{MachineProfile, ProjectMeta, Session};
use seslog_core::roadmap::{self, ItemStatus};

/// Summary of what changed during a reconcile pass.
#[derive(Debug, Default)]
pub struct ReconcileReport {
    pub added: u32,
    pub removed: u32,
    pub updated: u32,
    pub errors: Vec<String>,
}

/// Wipe all tables and re-import everything from the filesystem.
pub fn full_rebuild(conn: &Connection, data_dir: &Path) -> Result<ReconcileReport> {
    let mut report = ReconcileReport::default();

    // 1. Clear all tables in reverse FK order.
    conn.execute_batch(
        "DELETE FROM transcript_highlights;
         DELETE FROM decisions;
         DELETE FROM roadmap_items;
         DELETE FROM sessions;
         DELETE FROM projects;
         DELETE FROM machines;",
    )
    .context("Failed to clear tables")?;

    // 2. Scan projects/{slug}/meta.toml
    let projects_dir = data_dir.join("projects");
    if projects_dir.is_dir() {
        let mut entries: Vec<_> = fs::read_dir(&projects_dir)
            .context("Failed to read projects dir")?
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().map(|ft| ft.is_dir()).unwrap_or(false))
            .collect();
        entries.sort_by_key(|e| e.file_name());

        for entry in entries {
            let slug_dir = entry.path();
            let meta_path = slug_dir.join("meta.toml");

            if !meta_path.exists() {
                continue;
            }

            match import_project(conn, &meta_path) {
                Ok(project_id) => {
                    report.added += 1;

                    // 3. Scan sessions/*.json for this project
                    let sessions_dir = slug_dir.join("sessions");
                    if sessions_dir.is_dir() {
                        match import_sessions(conn, &sessions_dir, &project_id) {
                            Ok(count) => report.added += count,
                            Err(e) => report.errors.push(format!(
                                "sessions import for {}: {}",
                                project_id, e
                            )),
                        }
                    }

                    // 4. Parse roadmap.md if it exists
                    let roadmap_path = slug_dir.join("roadmap.md");
                    if roadmap_path.exists() {
                        match import_roadmap(conn, &roadmap_path, &project_id) {
                            Ok(count) => report.added += count,
                            Err(e) => report.errors.push(format!(
                                "roadmap import for {}: {}",
                                project_id, e
                            )),
                        }
                    }
                }
                Err(e) => {
                    report.errors.push(format!(
                        "project import from {}: {}",
                        meta_path.display(),
                        e
                    ));
                }
            }
        }
    }

    // 5. Scan machines/*.toml
    let machines_dir = data_dir.join("machines");
    if machines_dir.is_dir() {
        let mut entries: Vec<_> = fs::read_dir(&machines_dir)
            .context("Failed to read machines dir")?
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.path()
                    .extension()
                    .map(|ext| ext == "toml")
                    .unwrap_or(false)
            })
            .collect();
        entries.sort_by_key(|e| e.file_name());

        for entry in entries {
            match import_machine(conn, &entry.path()) {
                Ok(()) => report.added += 1,
                Err(e) => report.errors.push(format!(
                    "machine import from {}: {}",
                    entry.path().display(),
                    e
                )),
            }
        }
    }

    Ok(report)
}

/// Incrementally update a single changed file.
pub fn incremental_update(
    conn: &Connection,
    changed_path: &Path,
    data_dir: &Path,
) -> Result<()> {
    // Determine what kind of file changed by inspecting the path components.
    let rel = changed_path
        .strip_prefix(data_dir)
        .unwrap_or(changed_path);
    let components: Vec<&str> = rel
        .components()
        .filter_map(|c| c.as_os_str().to_str())
        .collect();

    // Pattern: projects/{slug}/sessions/{file}.json
    if components.len() >= 4
        && components[0] == "projects"
        && components[2] == "sessions"
        && changed_path
            .extension()
            .map(|e| e == "json")
            .unwrap_or(false)
    {
        let session_json = fs::read_to_string(changed_path)
            .with_context(|| format!("Reading session file {}", changed_path.display()))?;
        let session: Session = serde_json::from_str(&session_json)
            .with_context(|| format!("Parsing session {}", changed_path.display()))?;
        upsert_session(conn, &session, changed_path)?;
        return Ok(());
    }

    // Pattern: projects/{slug}/roadmap.md
    if components.len() >= 3
        && components[0] == "projects"
        && changed_path
            .file_name()
            .map(|f| f == "roadmap.md")
            .unwrap_or(false)
    {
        let slug_dir = changed_path.parent().unwrap();
        let meta_path = slug_dir.join("meta.toml");
        if meta_path.exists() {
            let meta_toml = fs::read_to_string(&meta_path)?;
            let meta: ProjectMeta = toml::from_str(&meta_toml)?;
            let project_id = &meta.project.id;

            // Delete existing roadmap items for this project, then re-import.
            conn.execute(
                "DELETE FROM roadmap_items WHERE project_id = ?1",
                params![project_id],
            )?;
            import_roadmap(conn, changed_path, project_id)?;
        }
        return Ok(());
    }

    // Pattern: projects/{slug}/meta.toml
    if components.len() >= 3
        && components[0] == "projects"
        && changed_path
            .file_name()
            .map(|f| f == "meta.toml")
            .unwrap_or(false)
    {
        import_project(conn, changed_path)?;
        return Ok(());
    }

    Ok(())
}

/// Diff filesystem vs SQLite, fix drift.
///
/// For v1 simplicity this just delegates to `full_rebuild`.
/// Future versions can compare file lists and only update deltas.
pub fn reconcile(conn: &Connection, data_dir: &Path) -> Result<ReconcileReport> {
    full_rebuild(conn, data_dir)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Parse a meta.toml and INSERT OR REPLACE into the projects table.
/// Returns the project id.
fn import_project(conn: &Connection, meta_path: &Path) -> Result<String> {
    let content = fs::read_to_string(meta_path)
        .with_context(|| format!("Reading {}", meta_path.display()))?;
    let meta: ProjectMeta =
        toml::from_str(&content).with_context(|| format!("Parsing {}", meta_path.display()))?;

    let p = &meta.project;
    conn.execute(
        "INSERT OR REPLACE INTO projects
            (id, name, status, created_at, archived_at, description, meta_toml_path)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            p.id,
            p.name,
            p.status,
            p.created_at.to_rfc3339(),
            p.archived_at.map(|a| a.to_rfc3339()),
            p.description,
            meta_path.to_string_lossy().to_string(),
        ],
    )?;

    Ok(p.id.clone())
}

/// Import all session JSON files from a sessions directory.
/// Returns the number of sessions imported.
fn import_sessions(conn: &Connection, sessions_dir: &Path, _project_id: &str) -> Result<u32> {
    let mut count = 0u32;

    let mut entries: Vec<_> = fs::read_dir(sessions_dir)?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .map(|ext| ext == "json")
                .unwrap_or(false)
        })
        .collect();
    entries.sort_by_key(|e| e.file_name());

    for entry in entries {
        let path = entry.path();
        let content = fs::read_to_string(&path)?;
        let session: Session = serde_json::from_str(&content)
            .with_context(|| format!("Parsing session {}", path.display()))?;
        upsert_session(conn, &session, &path)?;
        count += 1;
    }

    Ok(count)
}

/// INSERT OR REPLACE a single session and its transcript_highlights.
fn upsert_session(conn: &Connection, session: &Session, source_path: &Path) -> Result<()> {
    let files_changed_str = session.files_changed.to_string();
    let next_steps = &session.next_steps;

    conn.execute(
        "INSERT OR REPLACE INTO sessions
            (id, project_id, machine, started_at, ended_at,
             duration_minutes, end_reason, summary, summary_source,
             next_steps, files_changed, recovered, redaction_count, source_path)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            session.id,
            session.project_id,
            session.machine,
            session.started_at.to_rfc3339(),
            session.ended_at.map(|e| e.to_rfc3339()),
            session.duration_minutes,
            session.end_reason,
            session.summary,
            session.summary_source,
            next_steps,
            files_changed_str,
            session.recovered as i32,
            session.redaction_count,
            source_path.to_string_lossy().to_string(),
        ],
    )?;

    // Remove old highlights for this session then re-insert.
    conn.execute(
        "DELETE FROM transcript_highlights WHERE session_id = ?1",
        params![session.id],
    )?;

    for (i, highlight) in session.transcript_highlights.iter().enumerate() {
        conn.execute(
            "INSERT INTO transcript_highlights (session_id, content, sort_order)
             VALUES (?1, ?2, ?3)",
            params![session.id, highlight, i as i32],
        )?;
    }

    Ok(())
}

/// Parse a roadmap.md and insert items into roadmap_items table.
/// Also updates progress_percent on the project.
/// Returns the number of roadmap items inserted.
fn import_roadmap(conn: &Connection, roadmap_path: &Path, project_id: &str) -> Result<u32> {
    let content = fs::read_to_string(roadmap_path)
        .with_context(|| format!("Reading {}", roadmap_path.display()))?;

    let data = roadmap::parse_roadmap_data(&content);
    let items = data.items;
    let progress = data.progress_percent as i32;

    for (i, item) in items.iter().enumerate() {
        let status_str = match item.status {
            ItemStatus::Done => "done",
            ItemStatus::Active => "active",
            ItemStatus::Pending => "pending",
            ItemStatus::Suspended => "suspended",
            ItemStatus::Blocked => "blocked",
        };
        let depends_on_json = if item.depends_on.is_empty() {
            None
        } else {
            serde_json::to_string(&item.depends_on).ok()
        };
        conn.execute(
            "INSERT INTO roadmap_items (project_id, phase, item_text, status, sort_order, item_id, depends_on)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![project_id, item.phase, item.text, status_str, i as i32,
                    item.id, depends_on_json],
        )?;
    }

    // Update progress on the project row.
    conn.execute(
        "UPDATE projects SET progress_percent = ?1 WHERE id = ?2",
        params![progress, project_id],
    )?;

    Ok(items.len() as u32)
}

/// Parse a machine TOML and INSERT OR REPLACE into machines table.
fn import_machine(conn: &Connection, machine_path: &Path) -> Result<()> {
    let content = fs::read_to_string(machine_path)
        .with_context(|| format!("Reading {}", machine_path.display()))?;
    let machine: MachineProfile = toml::from_str(&content)
        .with_context(|| format!("Parsing {}", machine_path.display()))?;

    conn.execute(
        "INSERT OR REPLACE INTO machines (hostname, platform, registered_at)
         VALUES (?1, ?2, ?3)",
        params![
            machine.hostname,
            machine.platform,
            machine.registered_at.to_rfc3339(),
        ],
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

    /// Create a temp directory with seslog structure, an initialized DB, and
    /// a minimal project at projects/test-project/.
    fn setup_test_env() -> (TempDir, Connection) {
        let dir = TempDir::new().expect("failed to create temp dir");

        // Initialize DB
        let db_path = dir.path().join("test.db");
        let conn = initialize_db(&db_path).expect("initialize_db failed");

        // Create project structure
        let project_dir = dir.path().join("projects").join("test-project");
        fs::create_dir_all(project_dir.join("sessions")).unwrap();

        // Write a minimal meta.toml
        let meta_toml = r#"schema_version = 1

[project]
id = "proj_test"
name = "Test Project"
status = "active"
created_at = "2026-01-01T00:00:00Z"

[paths]
"#;
        fs::write(project_dir.join("meta.toml"), meta_toml).unwrap();

        (dir, conn)
    }

    #[test]
    fn test_full_rebuild_imports_project() {
        let (dir, conn) = setup_test_env();

        let report = full_rebuild(&conn, dir.path()).unwrap();
        assert!(report.added >= 1);
        assert!(report.errors.is_empty(), "errors: {:?}", report.errors);

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM projects", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_full_rebuild_imports_sessions() {
        let (dir, conn) = setup_test_env();

        // Write a session JSON
        let session_json = r#"{
            "schema_version": 1,
            "id": "ses_001",
            "project_id": "proj_test",
            "machine": "macbook",
            "started_at": "2026-01-15T10:00:00Z",
            "summary": "Did some work",
            "summary_source": "transcript+git",
            "transcript_highlights": ["highlight 1", "highlight 2"]
        }"#;
        let sessions_dir = dir.path().join("projects/test-project/sessions");
        fs::write(sessions_dir.join("ses_001.json"), session_json).unwrap();

        let report = full_rebuild(&conn, dir.path()).unwrap();
        assert!(report.errors.is_empty(), "errors: {:?}", report.errors);

        let session_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(session_count, 1);

        let highlight_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM transcript_highlights",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(highlight_count, 2);
    }

    #[test]
    fn test_full_rebuild_imports_roadmap() {
        let (dir, conn) = setup_test_env();

        // Write a roadmap.md with 3 items: 1 done, 1 active, 1 pending
        let roadmap_md = "\
## Phase 1
- [x] Setup project
- [>] Implement core
- [ ] Write tests
";
        let project_dir = dir.path().join("projects/test-project");
        fs::write(project_dir.join("roadmap.md"), roadmap_md).unwrap();

        let report = full_rebuild(&conn, dir.path()).unwrap();
        assert!(report.errors.is_empty(), "errors: {:?}", report.errors);

        let item_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM roadmap_items", [], |row| row.get(0))
            .unwrap();
        assert_eq!(item_count, 3);

        let progress: i64 = conn
            .query_row(
                "SELECT progress_percent FROM projects WHERE id = 'proj_test'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        // 1 out of 3 done = ~33%
        assert!(
            (progress - 33).abs() <= 1,
            "expected ~33%, got {}%",
            progress
        );
    }

    #[test]
    fn test_full_rebuild_idempotent() {
        let (dir, conn) = setup_test_env();

        full_rebuild(&conn, dir.path()).unwrap();
        full_rebuild(&conn, dir.path()).unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM projects", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_reconcile_finds_missing_sessions() {
        let (dir, conn) = setup_test_env();
        full_rebuild(&conn, dir.path()).unwrap();

        // Add a session file after initial rebuild
        let session = serde_json::json!({
            "schema_version": 1,
            "id": "ses_late",
            "project_id": "proj_test",
            "machine": "mac",
            "started_at": "2026-01-05T10:00:00Z",
            "summary": "late session",
            "summary_source": "git_only"
        });
        std::fs::write(
            dir.path()
                .join("projects/test-project/sessions/late.json"),
            serde_json::to_string(&session).unwrap(),
        )
        .unwrap();

        let report = reconcile(&conn, dir.path()).unwrap();
        assert!(report.added >= 1); // At least the late session was picked up
    }

    #[test]
    fn test_incremental_update_session() {
        let (dir, conn) = setup_test_env();

        // Initial full rebuild
        full_rebuild(&conn, dir.path()).unwrap();

        // Now add a new session JSON
        let session_json = r#"{
            "schema_version": 1,
            "id": "ses_inc_001",
            "project_id": "proj_test",
            "machine": "macbook",
            "started_at": "2026-02-01T10:00:00Z",
            "summary": "Incremental session",
            "summary_source": "transcript"
        }"#;
        let session_path = dir
            .path()
            .join("projects/test-project/sessions/ses_inc_001.json");
        fs::write(&session_path, session_json).unwrap();

        incremental_update(&conn, &session_path, dir.path()).unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }
}
