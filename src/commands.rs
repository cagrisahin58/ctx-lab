// IPC Commands module for ctx-lab
// Backend functions callable from the UI

use crate::db::{Database, get_all_projects_from_db, get_sessions_from_db, ProjectRow, SessionRow};
use crate::reconcile;
use rusqlite::params;
use std::path::PathBuf;

/// Get all projects
pub fn cmd_get_projects(db: &Database) -> Result<Vec<ProjectRow>, String> {
    let conn = db.connection();
    get_all_projects_from_db(&conn)
        .map_err(|e| format!("Failed to get projects: {}", e))
}

/// Get project details
pub fn cmd_get_project_detail(db: &Database, project_id: &str) -> Result<ProjectDetail, String> {
    // Validate project_id to prevent injection
    if project_id.is_empty() || project_id.len() > 100 {
        return Err("Invalid project ID".to_string());
    }

    let conn = db.connection();

    // Get project
    let projects = get_all_projects_from_db(&conn)
        .map_err(|e| format!("Failed to get project: {}", e))?;

    let project = projects.iter()
        .find(|p| p.id == project_id)
        .ok_or("Project not found")?;

    // Get sessions
    let sessions = get_sessions_from_db(&conn, project_id, 20)
        .map_err(|e| format!("Failed to get sessions: {}", e))?;

    // Get roadmap items
    let roadmap = get_roadmap_items(&conn, project_id)
        .map_err(|e| format!("Failed to get roadmap: {}", e))?;

    // Get decisions
    let decisions = get_decisions(&conn, project_id)
        .map_err(|e| format!("Failed to get decisions: {}", e))?;

    Ok(ProjectDetail {
        project: project.clone(),
        sessions,
        roadmap,
        decisions,
    })
}

/// Get sessions for a project
pub fn cmd_get_sessions(db: &Database, project_id: &str, limit: i32) -> Result<Vec<SessionRow>, String> {
    // Validate inputs
    if project_id.is_empty() || project_id.len() > 100 {
        return Err("Invalid project ID".to_string());
    }

    let limit = limit.max(0).min(100); // Clamp to 0-100

    let conn = db.connection();
    get_sessions_from_db(&conn, project_id, limit)
        .map_err(|e| format!("Failed to get sessions: {}", e))
}

/// Get roadmap items
pub fn cmd_get_roadmap(db: &Database, project_id: &str) -> Result<RoadmapData, String> {
    if project_id.is_empty() || project_id.len() > 100 {
        return Err("Invalid project ID".to_string());
    }

    let conn = db.connection();
    get_roadmap_items(&conn, project_id)
        .map_err(|e| format!("Failed to get roadmap: {}", e))
}

/// Toggle roadmap item status
pub fn cmd_toggle_roadmap_item(
    db: &Database,
    project_id: &str,
    item_text: &str,
    new_status: &str,
) -> Result<(), String> {
    // Security: validate inputs
    if project_id.is_empty() || project_id.len() > 100 {
        return Err("Invalid project ID".to_string());
    }
    if item_text.is_empty() || item_text.len() > 1000 {
        return Err("Invalid item text".to_string());
    }

    // Validate status
    let valid_statuses = ["done", "active", "pending", "suspended", "blocked"];
    if !valid_statuses.contains(&new_status) {
        return Err("Invalid status".to_string());
    }

    let conn = db.connection();

    conn.execute(
        "UPDATE roadmap_items SET status = ?1 WHERE project_id = ?2 AND item_text = ?3",
        params![new_status, project_id, item_text],
    ).map_err(|e| format!("Failed to update roadmap item: {}", e))?;

    // Update project progress
    conn.execute(
        "UPDATE projects SET
            progress_percent = (
                SELECT CAST(COUNT(CASE WHEN status = 'done' THEN 1 END) AS REAL) * 100.0 / NULLIF(COUNT(*), 0)
                FROM roadmap_items WHERE roadmap_items.project_id = projects.id
            )
         WHERE id = ?1",
        params![project_id],
    ).ok();

    Ok(())
}

/// Archive a project
pub fn cmd_archive_project(db: &Database, project_id: &str) -> Result<(), String> {
    if project_id.is_empty() || project_id.len() > 100 {
        return Err("Invalid project ID".to_string());
    }

    let conn = db.connection();

    conn.execute(
        "UPDATE projects SET status = 'archived', archived_at = datetime('now') WHERE id = ?1",
        params![project_id],
    ).map_err(|e| format!("Failed to archive project: {}", e))?;

    Ok(())
}

/// Unarchive a project
pub fn cmd_unarchive_project(db: &Database, project_id: &str) -> Result<(), String> {
    if project_id.is_empty() || project_id.len() > 100 {
        return Err("Invalid project ID".to_string());
    }

    let conn = db.connection();

    conn.execute(
        "UPDATE projects SET status = 'active', archived_at = NULL WHERE id = ?1",
        params![project_id],
    ).map_err(|e| format!("Failed to unarchive project: {}", e))?;

    Ok(())
}

/// Rebuild cache from file system
pub fn cmd_rebuild_cache(db: &Database, ctx_lab_dir: Option<PathBuf>) -> Result<ReconcileReportDto, String> {
    let dir = ctx_lab_dir.unwrap_or_else(|| {
        dirs::home_dir()
            .map(|h| h.join(".ctx-lab"))
            .unwrap_or_else(|| PathBuf::from(".ctx-lab"))
    });

    let report = reconcile::full_rebuild(db, &dir)
        .map_err(|e| format!("Failed to rebuild cache: {}", e))?;

    Ok(ReconcileReportDto {
        added: report.added,
        removed: report.removed,
        updated: report.updated,
        errors: report.errors,
    })
}

/// Get app settings
pub fn cmd_get_settings() -> AppSettings {
    AppSettings {
        privacy_mode: "full".to_string(),
        checkpoint_interval_minutes: 30,
        notifications_enabled: true,
        process_watcher_enabled: false,
    }
}

/// Update app settings
pub fn cmd_update_settings(settings: AppSettings) -> Result<(), String> {
    // Validate settings
    let valid_modes = ["full", "summary-only", "metadata-only"];
    if !valid_modes.contains(&settings.privacy_mode.as_str()) {
        return Err("Invalid privacy mode".to_string());
    }

    // Settings would be persisted to config.toml in real implementation
    tracing::info!("Settings updated: {:?}", settings);
    Ok(())
}

/// Helper: Get roadmap items from database
fn get_roadmap_items(conn: &rusqlite::Connection, project_id: &str) -> Result<RoadmapData, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT phase, item_text, status, sort_order FROM roadmap_items
         WHERE project_id = ?1 ORDER BY sort_order"
    )?;

    let items: Vec<RoadmapItem> = stmt.query_map([project_id], |row| {
        Ok(RoadmapItem {
            phase: row.get(0)?,
            item_text: row.get(1)?,
            status: row.get(2)?,
            sort_order: row.get(3)?,
        })
    })?.filter_map(|r| r.ok()).collect();

    // Calculate progress
    let total = items.len() as f64;
    let done = items.iter().filter(|i| i.status == "done").count() as f64;
    let progress = if total > 0.0 { (done / total) * 100.0 } else { 0.0 };

    Ok(RoadmapData { items, progress_percent: progress })
}

/// Helper: Get decisions from database
fn get_decisions(conn: &rusqlite::Connection, project_id: &str) -> Result<Vec<Decision>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT date, title, description, sort_order FROM decisions
         WHERE project_id = ?1 ORDER BY sort_order"
    )?;

    let decisions = stmt.query_map([project_id], |row| {
        Ok(Decision {
            date: row.get(0)?,
            title: row.get(1)?,
            description: row.get(2)?,
            sort_order: row.get(3)?,
        })
    })?.filter_map(|r| r.ok()).collect();

    Ok(decisions)
}

// Response types

#[derive(Debug, Clone)]
pub struct ProjectDetail {
    pub project: ProjectRow,
    pub sessions: Vec<SessionRow>,
    pub roadmap: RoadmapData,
    pub decisions: Vec<Decision>,
}

#[derive(Debug, Clone)]
pub struct RoadmapData {
    pub items: Vec<RoadmapItem>,
    pub progress_percent: f64,
}

#[derive(Debug, Clone)]
pub struct RoadmapItem {
    pub phase: Option<String>,
    pub item_text: String,
    pub status: String,
    pub sort_order: i32,
}

#[derive(Debug, Clone)]
pub struct Decision {
    pub date: Option<String>,
    pub title: String,
    pub description: String,
    pub sort_order: i32,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AppSettings {
    pub privacy_mode: String,
    pub checkpoint_interval_minutes: i32,
    pub notifications_enabled: bool,
    pub process_watcher_enabled: bool,
}

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct ReconcileReportDto {
    pub added: u32,
    pub removed: u32,
    pub updated: u32,
    pub errors: Vec<String>,
}
