//! End-to-end integration tests for seslog-app.
//!
//! These tests exercise the full flow from filesystem data through the SQLite
//! cache layer and back out through the query functions, verifying that all
//! layers work together correctly.

use std::fs;
use std::path::Path;

use seslog_app::commands::DbConnector;
use seslog_app::db;
use seslog_app::events;
use seslog_app::reconcile;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Create a minimal seslog directory structure inside `root` with one project.
///
/// Layout:
/// ```text
/// root/
///   projects/
///     test-project/
///       meta.toml
///       sessions/
///   .events/
/// ```
fn create_project_structure(root: &Path) {
    let project_dir = root.join("projects").join("test-project");
    fs::create_dir_all(project_dir.join("sessions")).unwrap();
    fs::create_dir_all(root.join(".events")).unwrap();

    let meta_toml = r#"schema_version = 1

[project]
id = "e2e_proj"
name = "E2E Test Project"
status = "active"
created_at = "2026-02-20T00:00:00Z"

[paths]
"#;
    fs::write(project_dir.join("meta.toml"), meta_toml).unwrap();
}

/// Write a session JSON file to the project's sessions directory.
fn write_session_file(root: &Path) {
    let session_json = r#"{
    "schema_version": 1,
    "id": "ses_e2e",
    "project_id": "e2e_proj",
    "machine": "test-machine",
    "started_at": "2026-02-20T10:00:00Z",
    "ended_at": "2026-02-20T10:30:00Z",
    "duration_minutes": 30,
    "summary": "E2E test session",
    "summary_source": "transcript+git",
    "transcript_highlights": ["test highlight"],
    "next_steps": "Continue testing"
}"#;
    let session_path = root
        .join("projects")
        .join("test-project")
        .join("sessions")
        .join("ses_e2e.json");
    fs::write(session_path, session_json).unwrap();
}

/// Write a roadmap.md with 3 items (1 done, 1 active, 1 pending).
fn write_roadmap_file(root: &Path) {
    let roadmap_md = "\
## Phase 1
- [x] Setup project
- [>] Implement core
- [ ] Write tests
";
    let roadmap_path = root
        .join("projects")
        .join("test-project")
        .join("roadmap.md");
    fs::write(roadmap_path, roadmap_md).unwrap();
}

/// Write an event file to the .events/ directory.
fn write_event_file(root: &Path) -> std::path::PathBuf {
    let event_json = r#"{
    "event": "session_ended",
    "session_id": "ses_e2e",
    "project_id": "e2e_proj",
    "timestamp": "2026-02-20T10:30:00Z"
}"#;
    let event_path = root.join(".events").join("evt_e2e.json");
    fs::write(&event_path, event_json).unwrap();
    event_path
}

// ---------------------------------------------------------------------------
// Test: Full flow — filesystem to DB to query
// ---------------------------------------------------------------------------

#[test]
fn test_full_flow_session_to_dashboard() {
    let tmp = tempfile::TempDir::new().unwrap();
    let root = tmp.path();

    // Step 1-3: Create project structure with meta.toml
    create_project_structure(root);

    // Step 4: Initialize DB
    let db_path = root.join("cache.db");
    let conn = db::initialize_db(&db_path).unwrap();

    // Step 5: Full rebuild — verify project lands in SQLite
    let report = reconcile::full_rebuild(&conn, root).unwrap();
    assert!(report.errors.is_empty(), "rebuild errors: {:?}", report.errors);
    assert!(report.added >= 1, "expected at least 1 item added");

    let project_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM projects WHERE id = 'e2e_proj'", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(project_count, 1, "project should exist in DB after rebuild");

    // Step 6: Write session JSON
    write_session_file(root);

    // Step 7-8: Write event file and process it
    let event_path = write_event_file(root);
    assert!(event_path.exists(), "event file should exist before processing");

    events::process_event(&conn, &event_path, root).unwrap();

    // Step 9a: Session exists in DB with correct summary
    let summary: String = conn
        .query_row(
            "SELECT summary FROM sessions WHERE id = 'ses_e2e'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(summary, "E2E test session");

    // Step 9b: Session has transcript highlight
    let highlight_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM transcript_highlights WHERE session_id = 'ses_e2e'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(highlight_count, 1, "session should have 1 transcript highlight");

    let highlight_text: String = conn
        .query_row(
            "SELECT content FROM transcript_highlights WHERE session_id = 'ses_e2e'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(highlight_text, "test highlight");

    // Step 9c: Event file was deleted
    assert!(
        !event_path.exists(),
        "event file should be deleted after processing"
    );

    // Step 9d: Event was marked as processed
    let processed_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM processed_events WHERE event_file = 'evt_e2e.json'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(processed_count, 1, "event should be in processed_events");

    // Step 9e: project_summary view returns correct data
    let (view_name, view_session_count): (String, i64) = conn
        .query_row(
            "SELECT name, session_count FROM project_summary WHERE id = 'e2e_proj'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(view_name, "E2E Test Project");
    assert_eq!(view_session_count, 1, "project_summary should show 1 session");
}

// ---------------------------------------------------------------------------
// Test: Rebuild cache via command-layer functions
// ---------------------------------------------------------------------------

#[test]
fn test_rebuild_cache_via_commands() {
    let tmp = tempfile::TempDir::new().unwrap();
    let root = tmp.path();

    // Setup: project + session
    create_project_structure(root);
    write_session_file(root);

    // Create DbConnector pointing at the temp DB
    let db_path = root.join("cache.db");
    let pool = DbConnector::new(&db_path).unwrap();

    // Rebuild by directly calling full_rebuild (rebuild_cache_inner uses the
    // real ~/.seslog/ directory, so we bypass it for testing).
    {
        let conn = pool.get().unwrap();
        let report = reconcile::full_rebuild(&conn, root).unwrap();
        assert!(report.errors.is_empty(), "rebuild errors: {:?}", report.errors);
        assert!(report.added >= 2, "expected project + session to be added");
    }

    // Verify via get_projects_inner
    let projects = seslog_app::commands::get_projects_inner(&pool).unwrap();
    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0].id, "e2e_proj");
    assert_eq!(projects[0].name, "E2E Test Project");
    assert_eq!(projects[0].session_count, 1);

    // Verify via get_sessions_inner
    let sessions =
        seslog_app::commands::get_sessions_inner(&pool, "e2e_proj".into(), 10).unwrap();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].id, "ses_e2e");
    assert_eq!(sessions[0].summary, "E2E test session");
    assert_eq!(sessions[0].machine, "test-machine");
    assert_eq!(sessions[0].duration_minutes, Some(30));
    assert_eq!(sessions[0].transcript_highlights, vec!["test highlight"]);

    // Verify via get_roadmap_inner — no roadmap.md, so empty
    let roadmap = seslog_app::commands::get_roadmap_inner(&pool, "e2e_proj".into()).unwrap();
    assert!(roadmap.items.is_empty(), "roadmap should be empty without roadmap.md");
    assert_eq!(roadmap.progress_percent, 0.0);
}

// ---------------------------------------------------------------------------
// Test: Roadmap shows in project detail
// ---------------------------------------------------------------------------

#[test]
fn test_roadmap_shows_in_project_detail() {
    let tmp = tempfile::TempDir::new().unwrap();
    let root = tmp.path();

    // Setup: project + session + roadmap
    create_project_structure(root);
    write_session_file(root);
    write_roadmap_file(root);

    // Initialize DB and run full rebuild
    let db_path = root.join("cache.db");
    let pool = DbConnector::new(&db_path).unwrap();
    {
        let conn = pool.get().unwrap();
        let report = reconcile::full_rebuild(&conn, root).unwrap();
        assert!(report.errors.is_empty(), "rebuild errors: {:?}", report.errors);
    }

    // Fetch project detail
    let detail =
        seslog_app::commands::get_project_detail_inner(&pool, "e2e_proj".into()).unwrap();

    // Summary has correct name
    assert_eq!(detail.summary.name, "E2E Test Project");

    // Progress should be ~33% (1 done out of 3 items)
    assert!(
        (detail.summary.progress_percent - 33.0).abs() <= 2.0,
        "expected ~33% progress, got {}%",
        detail.summary.progress_percent
    );

    // Roadmap has 3 items with correct statuses
    assert_eq!(
        detail.roadmap.items.len(),
        3,
        "roadmap should have 3 items"
    );
    assert_eq!(detail.roadmap.items[0].item_text, "Setup project");
    assert_eq!(detail.roadmap.items[0].status, "done");
    assert_eq!(detail.roadmap.items[1].item_text, "Implement core");
    assert_eq!(detail.roadmap.items[1].status, "active");
    assert_eq!(detail.roadmap.items[2].item_text, "Write tests");
    assert_eq!(detail.roadmap.items[2].status, "pending");

    // Recent sessions has 1 session
    assert_eq!(
        detail.recent_sessions.len(),
        1,
        "project detail should have 1 recent session"
    );
    assert_eq!(detail.recent_sessions[0].id, "ses_e2e");
    assert_eq!(detail.recent_sessions[0].summary, "E2E test session");
}
