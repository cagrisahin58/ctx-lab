use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::params;

// ---------------------------------------------------------------------------
// DbPool — lightweight connection factory for SQLite
// ---------------------------------------------------------------------------

pub struct DbPool {
    db_path: PathBuf,
}

impl DbPool {
    pub fn new(db_path: &Path) -> anyhow::Result<Self> {
        // Initialize DB to ensure schema exists
        crate::db::initialize_db(db_path)?;
        Ok(Self {
            db_path: db_path.to_path_buf(),
        })
    }

    pub fn get(&self) -> anyhow::Result<rusqlite::Connection> {
        let conn = rusqlite::Connection::open(&self.db_path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        Ok(conn)
    }
}

// ---------------------------------------------------------------------------
// Serde response structs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize)]
pub struct ProjectSummaryResponse {
    pub id: String,
    pub name: String,
    pub status: String,
    pub progress_percent: f64,
    pub last_session_at: Option<String>,
    pub last_machine: Option<String>,
    pub last_summary: Option<String>,
    pub session_count: i64,
    pub total_minutes: i64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SessionResponse {
    pub id: String,
    pub project_id: String,
    pub machine: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub duration_minutes: Option<i64>,
    pub summary: String,
    pub next_steps: String,
    pub files_changed: i64,
    pub recovered: bool,
    pub transcript_highlights: Vec<String>,
    pub token_count: Option<i64>,
    pub estimated_cost_usd: Option<f64>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct RoadmapItemResponse {
    pub phase: Option<String>,
    pub item_text: String,
    pub status: String,
    pub item_id: Option<String>,
    pub depends_on: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct RoadmapResponse {
    pub items: Vec<RoadmapItemResponse>,
    pub progress_percent: f64,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ProjectDetailResponse {
    #[serde(flatten)]
    pub summary: ProjectSummaryResponse,
    pub roadmap: RoadmapResponse,
    pub recent_sessions: Vec<SessionResponse>,
}

// ---------------------------------------------------------------------------
// Inner functions (testable without Tauri)
// ---------------------------------------------------------------------------

pub fn get_projects_inner(pool: &DbPool) -> anyhow::Result<Vec<ProjectSummaryResponse>> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, name, status, progress_percent,
                last_machine, last_summary, session_count, total_minutes
         FROM project_summary",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(ProjectSummaryResponse {
            id: row.get(0)?,
            name: row.get(1)?,
            status: row.get(2)?,
            progress_percent: row.get(3)?,
            last_session_at: None, // view does not include this; filled below
            last_machine: row.get(4)?,
            last_summary: row.get(5)?,
            session_count: row.get(6)?,
            total_minutes: row.get(7)?,
        })
    })?;

    let mut projects = Vec::new();
    for row in rows {
        let mut p = row?;
        // Fetch last_session_at from the sessions table.
        let last_at: Option<String> = conn
            .query_row(
                "SELECT started_at FROM sessions WHERE project_id = ?1
                 ORDER BY started_at DESC LIMIT 1",
                params![p.id],
                |r| r.get(0),
            )
            .ok();
        p.last_session_at = last_at;
        projects.push(p);
    }

    Ok(projects)
}

pub fn get_project_detail_inner(
    pool: &DbPool,
    project_id: String,
) -> anyhow::Result<ProjectDetailResponse> {
    // 1. Project summary
    let conn = pool.get()?;
    let summary = conn.query_row(
        "SELECT id, name, status, progress_percent,
                last_machine, last_summary, session_count, total_minutes
         FROM project_summary WHERE id = ?1",
        params![project_id],
        |row| {
            Ok(ProjectSummaryResponse {
                id: row.get(0)?,
                name: row.get(1)?,
                status: row.get(2)?,
                progress_percent: row.get(3)?,
                last_session_at: None,
                last_machine: row.get(4)?,
                last_summary: row.get(5)?,
                session_count: row.get(6)?,
                total_minutes: row.get(7)?,
            })
        },
    )?;
    drop(conn);

    // Fill last_session_at
    let mut summary = summary;
    let conn2 = pool.get()?;
    summary.last_session_at = conn2
        .query_row(
            "SELECT started_at FROM sessions WHERE project_id = ?1
             ORDER BY started_at DESC LIMIT 1",
            params![project_id],
            |r| r.get(0),
        )
        .ok();
    drop(conn2);

    // 2. Roadmap
    let roadmap = get_roadmap_inner(pool, project_id.clone())?;

    // 3. Recent sessions (last 20)
    let recent_sessions = get_sessions_inner(pool, project_id, 20)?;

    Ok(ProjectDetailResponse {
        summary,
        roadmap,
        recent_sessions,
    })
}

pub fn get_sessions_inner(
    pool: &DbPool,
    project_id: String,
    limit: u32,
) -> anyhow::Result<Vec<SessionResponse>> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, project_id, machine, started_at, ended_at,
                duration_minutes, summary, next_steps, files_changed, recovered,
                token_count, estimated_cost_usd, model
         FROM sessions
         WHERE project_id = ?1
         ORDER BY started_at DESC
         LIMIT ?2",
    )?;

    let rows = stmt.query_map(params![project_id, limit], |row| {
        let files_str: String = row.get::<_, Option<String>>(8)?.unwrap_or_default();
        let files_changed: i64 = files_str.parse().unwrap_or(0);
        let recovered_int: i32 = row.get(9)?;

        Ok(SessionResponse {
            id: row.get(0)?,
            project_id: row.get(1)?,
            machine: row.get(2)?,
            started_at: row.get(3)?,
            ended_at: row.get(4)?,
            duration_minutes: row.get(5)?,
            summary: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
            next_steps: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
            files_changed,
            recovered: recovered_int != 0,
            transcript_highlights: Vec::new(), // filled below
            token_count: row.get(10)?,
            estimated_cost_usd: row.get(11)?,
            model: row.get(12)?,
        })
    })?;

    let mut sessions: Vec<SessionResponse> = rows.collect::<Result<_, _>>()?;

    // Fetch transcript highlights per session
    for session in &mut sessions {
        let mut hl_stmt = conn.prepare(
            "SELECT content FROM transcript_highlights
             WHERE session_id = ?1
             ORDER BY sort_order",
        )?;
        let highlights: Vec<String> = hl_stmt
            .query_map(params![session.id], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        session.transcript_highlights = highlights;
    }

    Ok(sessions)
}

pub fn get_roadmap_inner(
    pool: &DbPool,
    project_id: String,
) -> anyhow::Result<RoadmapResponse> {
    let conn = pool.get()?;

    // Items
    let mut stmt = conn.prepare(
        "SELECT phase, item_text, status, item_id, depends_on
         FROM roadmap_items
         WHERE project_id = ?1
         ORDER BY sort_order",
    )?;

    let items: Vec<RoadmapItemResponse> = stmt
        .query_map(params![project_id], |row| {
            let depends_str: Option<String> = row.get(4)?;
            let depends_on: Vec<String> = depends_str
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default();
            Ok(RoadmapItemResponse {
                phase: row.get(0)?,
                item_text: row.get(1)?,
                status: row.get(2)?,
                item_id: row.get(3)?,
                depends_on,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    // Validate dependencies: check that all depends_on references exist as item_ids
    let known_ids: std::collections::HashSet<&str> = items.iter()
        .filter_map(|i| i.item_id.as_deref())
        .collect();
    let mut warnings = Vec::new();
    for item in &items {
        for dep in &item.depends_on {
            if !known_ids.contains(dep.as_str()) {
                let label = item.item_id.as_deref().unwrap_or(&item.item_text);
                warnings.push(format!(
                    "Item '{}' depends on '{}' which does not exist",
                    label, dep
                ));
            }
        }
    }

    // Progress percent from projects table
    let progress: f64 = conn
        .query_row(
            "SELECT progress_percent FROM projects WHERE id = ?1",
            params![project_id],
            |row| row.get(0),
        )
        .unwrap_or(0.0);

    Ok(RoadmapResponse {
        items,
        progress_percent: progress,
        warnings,
    })
}

pub fn rebuild_cache_inner(pool: &DbPool) -> anyhow::Result<crate::reconcile::ReconcileReport> {
    let conn = pool.get()?;
    let seslog_dir = seslog_core::storage::seslog_dir()?;
    crate::reconcile::full_rebuild(&conn, &seslog_dir)
}

// ---------------------------------------------------------------------------
// Tauri command wrappers
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_projects(
    pool: tauri::State<'_, Mutex<DbPool>>,
) -> Result<Vec<ProjectSummaryResponse>, String> {
    let pool = pool.lock().map_err(|e| e.to_string())?;
    get_projects_inner(&pool).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_project_detail(
    pool: tauri::State<'_, Mutex<DbPool>>,
    project_id: String,
) -> Result<ProjectDetailResponse, String> {
    let pool = pool.lock().map_err(|e| e.to_string())?;
    get_project_detail_inner(&pool, project_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_sessions(
    pool: tauri::State<'_, Mutex<DbPool>>,
    project_id: String,
    limit: u32,
) -> Result<Vec<SessionResponse>, String> {
    let pool = pool.lock().map_err(|e| e.to_string())?;
    get_sessions_inner(&pool, project_id, limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_roadmap(
    pool: tauri::State<'_, Mutex<DbPool>>,
    project_id: String,
) -> Result<RoadmapResponse, String> {
    let pool = pool.lock().map_err(|e| e.to_string())?;
    get_roadmap_inner(&pool, project_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rebuild_cache(
    pool: tauri::State<'_, Mutex<DbPool>>,
) -> Result<String, String> {
    let pool = pool.lock().map_err(|e| e.to_string())?;
    let report = rebuild_cache_inner(&pool).map_err(|e| e.to_string())?;
    Ok(format!(
        "Rebuild complete: added={}, removed={}, updated={}, errors={}",
        report.added, report.removed, report.updated, report.errors.len()
    ))
}

#[tauri::command]
pub fn open_in_editor(_project_id: String) -> Result<(), String> {
    // TODO: Read meta.toml, find path for current machine hostname,
    // run `code {path}` or `open -a "Visual Studio Code" {path}`
    Ok(())
}

#[tauri::command]
pub fn get_settings() -> Result<serde_json::Value, String> {
    let config_path = seslog_core::storage::seslog_dir()
        .map_err(|e| e.to_string())?
        .join("config.toml");
    let config =
        seslog_core::config::load_config(&config_path).map_err(|e| e.to_string())?;
    serde_json::to_value(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_settings(config: serde_json::Value) -> Result<(), String> {
    let config_path = seslog_core::storage::seslog_dir()
        .map_err(|e| e.to_string())?
        .join("config.toml");

    // Load existing config so non-exposed fields retain their values
    let mut app_config =
        seslog_core::config::load_config(&config_path).map_err(|e| e.to_string())?;

    // Apply only the fields the frontend sends
    if let Some(v) = config.get("privacy_mode").and_then(|v| v.as_str()) {
        app_config.privacy_mode = v.to_string();
    }
    if let Some(v) = config
        .get("checkpoint_interval_minutes")
        .and_then(|v| v.as_u64())
    {
        app_config.checkpoint_interval_minutes = v as u32;
    }
    if let Some(v) = config.get("sanitize_secrets").and_then(|v| v.as_bool()) {
        app_config.sanitize_secrets = v;
    }

    seslog_core::config::write_config(&config_path, &app_config).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup() -> (TempDir, DbPool) {
        let tmp = TempDir::new().unwrap();
        let db_path = tmp.path().join("test.db");
        let pool = DbPool::new(&db_path).unwrap();
        let conn = pool.get().unwrap();
        // Insert test project
        conn.execute(
            "INSERT INTO projects (id, name, status, created_at, progress_percent)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["proj_1", "Test Project", "active", "2026-01-01T00:00:00Z", 50.0],
        )
        .unwrap();
        // Insert test session
        conn.execute(
            "INSERT INTO sessions (id, project_id, machine, started_at, summary, summary_source, duration_minutes)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                "ses_1",
                "proj_1",
                "macbook",
                "2026-01-01T10:00:00Z",
                "Did stuff",
                "git_only",
                30
            ],
        )
        .unwrap();
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
    fn test_get_sessions() {
        let (_tmp, pool) = setup();
        let sessions = get_sessions_inner(&pool, "proj_1".into(), 10).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].summary, "Did stuff");
    }

    #[test]
    fn test_get_roadmap_empty() {
        let (_tmp, pool) = setup();
        let roadmap = get_roadmap_inner(&pool, "proj_1".into()).unwrap();
        assert!(roadmap.items.is_empty());
        assert_eq!(roadmap.progress_percent, 50.0); // from projects table
    }
}
