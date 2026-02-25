// Reconcile module for ctx-lab
// Handles file system to SQLite synchronization

use crate::db::Database;
use rusqlite::params;
use std::path::{Path, PathBuf};
use std::fs;

/// Full rebuild of database from file system
pub fn full_rebuild(db: &Database, ctx_lab_dir: &Path) -> anyhow::Result<ReconcileReport> {
    let mut report = ReconcileReport::default();
    let conn = db.connection();

    // Clear existing data
    conn.execute("DELETE FROM transcript_highlights", [])?;
    conn.execute("DELETE FROM sessions", [])?;
    conn.execute("DELETE FROM roadmap_items", [])?;
    conn.execute("DELETE FROM decisions", [])?;
    conn.execute("DELETE FROM projects", [])?;

    // Scan projects directory
    let projects_dir = ctx_lab_dir.join("projects");
    if projects_dir.exists() {
        for entry in fs::read_dir(&projects_dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.is_dir() {
                let project_name = path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("unknown");

                // Parse meta.toml
                let meta_path = path.join("meta.toml");
                if meta_path.exists() {
                    if let Ok(content) = fs::read_to_string(&meta_path) {
                        if let Ok(meta) = content.parse::<toml::Value>() {
                            let project_id = format!("proj_{}", uuid::Uuid::new_v4());

                            let name = meta.get("project")
                                .and_then(|v| v.get("name"))
                                .and_then(|v| v.as_str())
                                .unwrap_or(project_name);

                            let status = meta.get("project")
                                .and_then(|v| v.get("status"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("active");

                            conn.execute(
                                "INSERT INTO projects (id, name, status, created_at, total_sessions, total_duration_minutes)
                                 VALUES (?1, ?2, ?3, ?4, 0, 0)",
                                params![
                                    project_id,
                                    name,
                                    status,
                                    chrono::Utc::now().to_rfc3339()
                                ],
                            )?;

                            report.added += 1;

                            // Parse sessions
                            let sessions_dir = path.join("sessions");
                            if sessions_dir.exists() {
                                if let Ok(entries) = fs::read_dir(&sessions_dir) {
                                    for session_entry in entries.flatten() {
                                        let session_path = session_entry.path();
                                        if session_path.extension().map_or(false, |e| e == "json") {
                                            if let Ok(content) = fs::read_to_string(&session_path) {
                                                if let Ok(session) = serde_json::from_str::<serde_json::Value>(&content) {
                                                    let session_id = session.get("session_id")
                                                        .and_then(|v| v.as_str())
                                                        .map(|s| s.to_string())
                                                        .unwrap_or_else(|| format!("ses_{}", uuid::Uuid::new_v4()));

                                                    let machine = session.get("machine")
                                                        .and_then(|v| v.as_str())
                                                        .unwrap_or("unknown");

                                                    let started_at = session.get("started_at")
                                                        .and_then(|v| v.as_str())
                                                        .unwrap_or("");

                                                    let summary = session.get("summary")
                                                        .and_then(|v| v.as_str())
                                                        .unwrap_or("");

                                                    let duration = session.get("duration_minutes")
                                                        .and_then(|v| v.as_i64());

                                                    let files_changed = session.get("files_changed")
                                                        .and_then(|v| v.as_i64())
                                                        .unwrap_or(0) as i32;

                                                    conn.execute(
                                                        "INSERT INTO sessions (id, project_id, machine, started_at, duration_minutes, summary, files_changed)
                                                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                                                        params![
                                                            session_id,
                                                            project_id,
                                                            machine,
                                                            started_at,
                                                            duration,
                                                            summary,
                                                            files_changed
                                                        ],
                                                    )?;
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            // Parse roadmap
                            let roadmap_path = path.join("roadmap.md");
                            if roadmap_path.exists() {
                                if let Ok(content) = fs::read_to_string(&roadmap_path) {
                                    parse_roadmap(&conn, &project_id, &content)?;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Update aggregates
    update_project_aggregates(&conn)?;

    Ok(report)
}

/// Parse roadmap markdown and insert into database
fn parse_roadmap(conn: &rusqlite::Connection, project_id: &str, content: &str) -> anyhow::Result<()> {
    let mut current_phase = String::new();
    let mut order = 0;

    for line in content.lines() {
        let trimmed = line.trim();

        // Phase header
        if trimmed.starts_with("## ") {
            current_phase = trimmed.trim_start_matches("## ").to_string();
            order = 0;
            continue;
        }

        // Item line
        if trimmed.starts_with("- ") || trimmed.starts_with("* ") {
            let item = trimmed.trim_start_matches("- ").trim_start_matches("* ");

            // Extract status
            let (status, text) = if item.starts_with("[x] ") {
                ("done", item.trim_start_matches("[x] "))
            } else if item.starts_with("[>] ") {
                ("active", item.trim_start_matches("[>] "))
            } else if item.starts_with("[~] ") {
                ("suspended", item.trim_start_matches("[~] "))
            } else if item.starts_with("[!] ") {
                ("blocked", item.trim_start_matches("[!] "))
            } else {
                ("pending", item)
            };

            conn.execute(
                "INSERT INTO roadmap_items (project_id, phase, item_text, status, sort_order)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![project_id, current_phase, text, status, order],
            )?;

            order += 1;
        }
    }

    Ok(())
}

/// Update project aggregate fields
fn update_project_aggregates(conn: &rusqlite::Connection) -> anyhow::Result<()> {
    conn.execute(
        "UPDATE projects SET
            total_sessions = (SELECT COUNT(*) FROM sessions WHERE sessions.project_id = projects.id),
            total_duration_minutes = (SELECT COALESCE(SUM(duration_minutes), 0) FROM sessions WHERE sessions.project_id = projects.id),
            last_session_at = (SELECT MAX(started_at) FROM sessions WHERE sessions.project_id = projects.id),
            last_machine = (SELECT machine FROM sessions WHERE sessions.project_id = projects.id ORDER BY started_at DESC LIMIT 1)
         WHERE EXISTS (SELECT 1 FROM sessions WHERE sessions.project_id = projects.id)",
        [],
    )?;

    // Update progress from roadmap
    conn.execute(
        "UPDATE projects SET
            progress_percent = (
                SELECT CAST(COUNT(CASE WHEN status = 'done' THEN 1 END) AS REAL) * 100.0 / NULLIF(COUNT(*), 0)
                FROM roadmap_items
                WHERE roadmap_items.project_id = projects.id
            )
         WHERE EXISTS (SELECT 1 FROM roadmap_items WHERE roadmap_items.project_id = projects.id)",
        [],
    )?;

    Ok(())
}

/// Incremental update - process changed file
pub fn incremental_update(db: &Database, changed_path: &Path) -> anyhow::Result<()> {
    // Implementation depends on file type
    // For now, just trigger a full rebuild if needed
    tracing::info!("Incremental update for: {:?}", changed_path);
    Ok(())
}

/// Reconcile report
#[derive(Debug, Default)]
pub struct ReconcileReport {
    pub added: u32,
    pub removed: u32,
    pub updated: u32,
    pub errors: Vec<String>,
}

impl ReconcileReport {
    fn add_error(&mut self, err: String) {
        self.errors.push(err);
    }

    fn add_added(&mut self) {
        self.added += 1;
    }
}
