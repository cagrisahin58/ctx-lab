// Database module for ctx-lab
// SQLite schema and connection management

use rusqlite::{Connection, Result as SqliteResult};
use std::path::Path;
use std::sync::Mutex;

/// Database connection wrapper
pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    /// Initialize database at given path
    pub fn new(db_path: &Path) -> SqliteResult<Self> {
        // Create parent directories if needed
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }

        let conn = Connection::open(db_path)?;

        // Enable WAL mode for concurrent read/write
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;

        let db = Self {
            conn: Mutex::new(conn),
        };

        db.initialize_schema()?;

        Ok(db)
    }

    /// Get connection
    pub fn connection(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().unwrap()
    }

    /// Initialize schema
    fn initialize_schema(&self) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();

        // Projects table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS projects (
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
            )",
            [],
        )?;

        // Sessions table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
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
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (project_id) REFERENCES projects(id)
            )",
            [],
        )?;

        // Sessions indexes
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_sessions_machine ON sessions(machine)",
            [],
        )?;

        // Transcript highlights
        conn.execute(
            "CREATE TABLE IF NOT EXISTS transcript_highlights (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                content TEXT NOT NULL,
                sort_order INTEGER DEFAULT 0,
                FOREIGN KEY (session_id) REFERENCES sessions(id)
            )",
            [],
        )?;

        // Roadmap items
        conn.execute(
            "CREATE TABLE IF NOT EXISTS roadmap_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT NOT NULL,
                phase TEXT,
                item_text TEXT NOT NULL,
                status TEXT NOT NULL,
                sort_order INTEGER DEFAULT 0,
                FOREIGN KEY (project_id) REFERENCES projects(id)
            )",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_roadmap_project ON roadmap_items(project_id)",
            [],
        )?;

        // Decisions
        conn.execute(
            "CREATE TABLE IF NOT EXISTS decisions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT NOT NULL,
                date TEXT,
                title TEXT NOT NULL,
                description TEXT DEFAULT '',
                sort_order INTEGER DEFAULT 0,
                FOREIGN KEY (project_id) REFERENCES projects(id)
            )",
            [],
        )?;

        // Machines
        conn.execute(
            "CREATE TABLE IF NOT EXISTS machines (
                hostname TEXT PRIMARY KEY,
                platform TEXT NOT NULL,
                registered_at TEXT NOT NULL
            )",
            [],
        )?;

        // Processed events (idempotency tracking)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS processed_events (
                event_file TEXT PRIMARY KEY,
                processed_at TEXT DEFAULT (datetime('now'))
            )",
            [],
        )?;

        // Project summary view
        conn.execute(
            "CREATE VIEW IF NOT EXISTS project_summary AS
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
            ORDER BY last_session_at DESC",
            [],
        )?;

        Ok(())
    }
}

/// Get database path in user's data directory
pub fn get_default_db_path() -> std::path::PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    base.join("ctx-lab").join("cache.db")
}

/// Fetch all active projects from database
pub fn get_projects_from_db(conn: &Connection) -> SqliteResult<Vec<ProjectRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, status, progress_percent, last_session_at, last_machine, last_summary, session_count, total_minutes
         FROM project_summary
         ORDER BY last_session_at DESC"
    )?;

    let projects = stmt.query_map([], |row| {
        Ok(ProjectRow {
            id: row.get(0)?,
            name: row.get(1)?,
            status: row.get(2)?,
            progress_percent: row.get(3)?,
            last_session_at: row.get(4)?,
            last_machine: row.get(5)?,
            last_summary: row.get(6)?,
            session_count: row.get(7)?,
            total_minutes: row.get(8)?,
        })
    })?.filter_map(|r| r.ok()).collect();

    Ok(projects)
}

/// Fetch all projects including archived
pub fn get_all_projects_from_db(conn: &Connection) -> SqliteResult<Vec<ProjectRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, status, progress_percent, last_session_at, last_machine, last_summary, session_count, total_minutes
         FROM projects
         ORDER BY last_session_at DESC"
    )?;

    let projects = stmt.query_map([], |row| {
        Ok(ProjectRow {
            id: row.get(0)?,
            name: row.get(1)?,
            status: row.get(2)?,
            progress_percent: row.get(3)?,
            last_session_at: row.get(4)?,
            last_machine: row.get(5)?,
            last_summary: row.get(6)?,
            session_count: row.get(7)?,
            total_minutes: row.get(8)?,
        })
    })?.filter_map(|r| r.ok()).collect();

    Ok(projects)
}

/// Fetch sessions for a project
pub fn get_sessions_from_db(conn: &Connection, project_id: &str, limit: i32) -> SqliteResult<Vec<SessionRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, machine, started_at, ended_at, duration_minutes, summary, next_steps, files_changed, recovered
         FROM sessions
         WHERE project_id = ?1
         ORDER BY started_at DESC
         LIMIT ?2"
    )?;

    let sessions = stmt.query_map([project_id, &limit.to_string()], |row| {
        Ok(SessionRow {
            id: row.get(0)?,
            project_id: row.get(1)?,
            machine: row.get(2)?,
            started_at: row.get(3)?,
            ended_at: row.get(4)?,
            duration_minutes: row.get(5)?,
            summary: row.get(6)?,
            next_steps: row.get(7)?,
            files_changed: row.get(8)?,
            recovered: row.get(9)?,
        })
    })?.filter_map(|r| r.ok()).collect();

    Ok(sessions)
}

/// Project row from database
#[derive(Debug, Clone)]
pub struct ProjectRow {
    pub id: String,
    pub name: String,
    pub status: String,
    pub progress_percent: f64,
    pub last_session_at: Option<String>,
    pub last_machine: Option<String>,
    pub last_summary: Option<String>,
    pub session_count: i32,
    pub total_minutes: i64,
}

/// Session row from database
#[derive(Debug, Clone)]
pub struct SessionRow {
    pub id: String,
    pub project_id: String,
    pub machine: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub duration_minutes: Option<i64>,
    pub summary: String,
    pub next_steps: String,
    pub files_changed: i32,
    pub recovered: bool,
}
