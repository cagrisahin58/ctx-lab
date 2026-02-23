// State management for ctx-lab
use serde::{Deserialize, Serialize};

/// Project summary for dashboard
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub status: ProjectStatus,
    pub progress_percent: f64,
    pub last_session_at: Option<String>,
    pub last_machine: Option<String>,
    pub last_summary: Option<String>,
    pub session_count: i32,
    pub total_minutes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ProjectStatus {
    Active,
    Archived,
}

/// Session information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
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
    pub transcript_highlights: Vec<String>,
}

/// Roadmap data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoadmapData {
    pub items: Vec<RoadmapItem>,
    pub progress_percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoadmapItem {
    pub phase: Option<String>,
    pub item_text: String,
    pub status: RoadmapItemStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum RoadmapItemStatus {
    Done,
    Active,
    Pending,
    Suspended,
    Blocked,
}

/// Application state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub privacy_mode: String,
    pub checkpoint_interval_minutes: i32,
    pub notifications_enabled: bool,
    pub process_watcher_enabled: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            privacy_mode: "full".to_string(),
            checkpoint_interval_minutes: 30,
            notifications_enabled: true,
            process_watcher_enabled: false,
        }
    }
}

/// Demo projects for UI testing
pub fn get_demo_projects() -> Vec<Project> {
    vec![
        Project {
            id: "proj_1".to_string(),
            name: "hooks_minimax".to_string(),
            status: ProjectStatus::Active,
            progress_percent: 35.0,
            last_session_at: Some("2026-02-23 03:30".to_string()),
            last_machine: Some("cagrisahin-macbook".to_string()),
            last_summary: Some("Glassmorphism UI design completed, Dioxus setup in progress".to_string()),
            session_count: 12,
            total_minutes: 480,
        },
        Project {
            id: "proj_2".to_string(),
            name: "cv-pipeline".to_string(),
            status: ProjectStatus::Active,
            progress_percent: 72.0,
            last_session_at: Some("2026-02-22 18:45".to_string()),
            last_machine: Some("cagrisahin-macbook".to_string()),
            last_summary: Some("CV training pipeline optimized, inference latency reduced by 40%".to_string()),
            session_count: 45,
            total_minutes: 2100,
        },
        Project {
            id: "proj_3".to_string(),
            name: "lit-rag".to_string(),
            status: ProjectStatus::Active,
            progress_percent: 58.0,
            last_session_at: Some("2026-02-21 14:20".to_string()),
            last_machine: Some("workstation".to_string()),
            last_summary: Some("RAG evaluation metrics computed, recall@10 improved to 0.85".to_string()),
            session_count: 28,
            total_minutes: 1260,
        },
        Project {
            id: "proj_4".to_string(),
            name: "old-experiment".to_string(),
            status: ProjectStatus::Archived,
            progress_percent: 100.0,
            last_session_at: Some("2026-01-15 10:00".to_string()),
            last_machine: Some("cagrisahin-macbook".to_string()),
            last_summary: Some("Project completed and archived".to_string()),
            session_count: 15,
            total_minutes: 600,
        },
    ]
}

pub fn get_demo_sessions() -> Vec<Session> {
    vec![
        Session {
            id: "ses_1".to_string(),
            project_id: "proj_1".to_string(),
            machine: "cagrisahin-macbook".to_string(),
            started_at: "2026-02-23T03:30:00Z".to_string(),
            ended_at: Some("2026-02-23T04:30:00Z".to_string()),
            duration_minutes: Some(60),
            summary: "Glassmorphism UI design completed, Dioxus setup in progress".to_string(),
            next_steps: "Implement core components, test desktop build".to_string(),
            files_changed: 24,
            recovered: false,
            transcript_highlights: vec![
                "Created GlassPanel component with backdrop blur".to_string(),
                "Set up project structure with Cargo workspace".to_string(),
            ],
        },
        Session {
            id: "ses_2".to_string(),
            project_id: "proj_1".to_string(),
            machine: "cagrisahin-macbook".to_string(),
            started_at: "2026-02-22T20:00:00Z".to_string(),
            ended_at: Some("2026-02-22T21:30:00Z".to_string()),
            duration_minutes: Some(90),
            summary: "Analyzed existing spec documents, decided on Dioxus + Glassmorphism".to_string(),
            next_steps: "Design UI components, create Glassmorphism CSS".to_string(),
            files_changed: 8,
            recovered: false,
            transcript_highlights: vec![
                "Chose Dioxus over Tauri for native Rust UI".to_string(),
                "Selected Glassmorphism style with blur effects".to_string(),
            ],
        },
    ]
}
