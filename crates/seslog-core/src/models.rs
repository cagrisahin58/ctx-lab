use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const SCHEMA_VERSION: u32 = 1;

// --- Summary Source ---

/// How the session summary was generated.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SummarySource {
    /// User explicitly wrote the summary via `seslog summary "text"`.
    Manual,
    /// Summary was derived from the Claude Code transcript combined with git diff data.
    #[serde(rename = "transcript+git")]
    TranscriptGit,
    /// Summary was derived solely from git diff/commit data (no transcript available).
    GitOnly,
    /// Fallback summary when no transcript or meaningful git data was available.
    Minimal,
}

/// Deserialize `Option<SummarySource>` leniently: unknown string values
/// are treated as `None` instead of causing a deserialization error.
/// This ensures backward compatibility with older session files that
/// may contain arbitrary summary_source strings.
fn deserialize_summary_source<'de, D>(deserializer: D) -> Result<Option<SummarySource>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let opt: Option<serde_json::Value> = Option::deserialize(deserializer)?;
    match opt {
        None => Ok(None),
        Some(v) => Ok(serde_json::from_value(v).ok()),
    }
}

// --- Session ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub schema_version: u32,
    pub id: String,
    pub project_id: String,
    pub machine: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub duration_minutes: Option<u32>,
    pub end_reason: Option<String>,
    pub summary: String,
    /// How the summary text was produced. See [`SummarySource`] for valid values:
    /// `Manual`, `TranscriptGit`, `GitOnly`, `Minimal`.
    #[serde(default, deserialize_with = "deserialize_summary_source")]
    pub summary_source: Option<SummarySource>,
    #[serde(default)]
    pub transcript_highlights: Vec<String>,
    #[serde(default)]
    pub roadmap_changes: Vec<RoadmapChange>,
    #[serde(default)]
    pub decisions: Vec<String>,
    #[serde(default)]
    pub next_steps: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub tools_used: Vec<String>,
    #[serde(default)]
    pub files_changed: u32,
    #[serde(default)]
    pub git_commits: Vec<String>,
    #[serde(default)]
    pub checkpoints_merged: Vec<String>,
    /// Whether this session record was reconstructed from partial data
    /// (e.g. after a crash or interrupted enrichment pipeline).
    #[serde(default)]
    pub recovered: bool,
    /// Number of secrets (API keys, tokens, passwords) that were redacted
    /// from the summary and transcript highlights by the sanitizer.
    #[serde(default)]
    pub redaction_count: u32,
    #[serde(default)]
    pub token_count: Option<u64>,
    #[serde(default)]
    pub estimated_cost_usd: Option<f64>,
    #[serde(default)]
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoadmapChange {
    pub action: String,
    pub item: String,
    #[serde(default)]
    pub phase: Option<u32>,
}

// --- Checkpoint ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Checkpoint {
    pub schema_version: u32,
    pub id: String,
    pub session_id: String,
    pub project_id: String,
    pub machine: String,
    pub timestamp: DateTime<Utc>,
    pub git_diff_stat: Option<String>,
    #[serde(default)]
    pub files_changed: Vec<String>,
    #[serde(default)]
    pub recent_commits: Vec<String>,
    pub source: String,
}

// --- Project ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectMeta {
    pub schema_version: u32,
    pub project: ProjectInfo,
    pub paths: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectInfo {
    pub id: String,
    pub name: String,
    pub status: String,
    pub created_at: DateTime<Utc>,
    #[serde(default)]
    pub archived_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub description: String,
}

// --- Machine ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MachineProfile {
    pub schema_version: u32,
    pub hostname: String,
    pub platform: String,
    pub registered_at: DateTime<Utc>,
}

// --- Hook Stdin Payloads ---

#[derive(Debug, Deserialize)]
pub struct SessionStartPayload {
    pub session_id: String,
    pub transcript_path: String,
    pub cwd: String,
    #[serde(default)]
    pub permission_mode: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PostToolUsePayload {
    pub session_id: String,
    pub transcript_path: String,
    pub cwd: String,
    #[serde(default)]
    pub tool_name: Option<String>,
    #[serde(default)]
    pub tool_input: Option<serde_json::Value>,
    #[serde(default)]
    pub tool_response: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct StopPayload {
    pub session_id: String,
    pub transcript_path: String,
    #[serde(default)]
    pub stop_hook_active: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct SessionEndPayload {
    pub session_id: String,
    pub transcript_path: String,
    pub cwd: String,
    #[serde(default)]
    pub reason: Option<String>,
}

// --- Hook Stdout ---

#[derive(Debug, Serialize)]
pub struct SessionStartOutput {
    #[serde(rename = "hookSpecificOutput")]
    pub hook_specific_output: HookSpecificOutput,
}

#[derive(Debug, Serialize)]
pub struct HookSpecificOutput {
    #[serde(rename = "hookEventName")]
    pub hook_event_name: String,
    #[serde(rename = "additionalContext")]
    pub additional_context: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_serialize_roundtrip() {
        let session = Session {
            schema_version: SCHEMA_VERSION,
            id: "ses_abc123".into(),
            project_id: "proj_test".into(),
            machine: "macbook".into(),
            started_at: chrono::Utc::now(),
            ended_at: None,
            duration_minutes: None,
            end_reason: None,
            summary: "test session".into(),
            summary_source: Some(SummarySource::TranscriptGit),
            transcript_highlights: vec![],
            roadmap_changes: vec![],
            decisions: vec![],
            next_steps: String::new(),
            tags: vec![],
            tools_used: vec![],
            files_changed: 0,
            git_commits: vec![],
            checkpoints_merged: vec![],
            recovered: false,
            redaction_count: 0,
            token_count: None,
            estimated_cost_usd: None,
            model: None,
        };
        let json = serde_json::to_string(&session).unwrap();
        let parsed: Session = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.id, "ses_abc123");
        assert_eq!(parsed.schema_version, SCHEMA_VERSION);
    }

    #[test]
    fn test_session_forward_compat_ignores_unknown_fields() {
        let json = r#"{
            "schema_version": 1,
            "id": "ses_x",
            "project_id": "proj_x",
            "machine": "m",
            "started_at": "2026-01-01T00:00:00Z",
            "summary": "s",
            "summary_source": "git_only",
            "future_field": "should be ignored"
        }"#;
        let session: Session = serde_json::from_str(json).unwrap();
        assert_eq!(session.id, "ses_x");
    }

    #[test]
    fn test_session_missing_optional_fields_use_defaults() {
        let json = r#"{
            "schema_version": 1,
            "id": "ses_y",
            "project_id": "proj_y",
            "machine": "m",
            "started_at": "2026-01-01T00:00:00Z",
            "summary": "s",
            "summary_source": "git_only"
        }"#;
        let session: Session = serde_json::from_str(json).unwrap();
        assert!(session.transcript_highlights.is_empty());
        assert!(!session.recovered);
        assert_eq!(session.files_changed, 0);
    }

    #[test]
    fn test_checkpoint_serialize_roundtrip() {
        let cp = Checkpoint {
            schema_version: SCHEMA_VERSION,
            id: "chk_abc".into(),
            session_id: "ses_abc".into(),
            project_id: "proj_x".into(),
            machine: "mac".into(),
            timestamp: chrono::Utc::now(),
            git_diff_stat: Some("+10 -5 across 3 files".into()),
            files_changed: vec!["src/main.rs".into()],
            recent_commits: vec![],
            source: "postToolUse_debounced".into(),
        };
        let json = serde_json::to_string(&cp).unwrap();
        let parsed: Checkpoint = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.id, "chk_abc");
    }

    #[test]
    fn test_hook_payload_parse_session_start() {
        let json = r#"{
            "session_id": "abc-123",
            "transcript_path": "/tmp/transcript.jsonl",
            "cwd": "/home/user/project"
        }"#;
        let payload: SessionStartPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.session_id, "abc-123");
        assert_eq!(payload.cwd, "/home/user/project");
    }

    #[test]
    fn test_session_start_output_format() {
        let output = SessionStartOutput {
            hook_specific_output: HookSpecificOutput {
                hook_event_name: "SessionStart".into(),
                additional_context: "test context".into(),
            },
        };
        let json = serde_json::to_string(&output).unwrap();
        assert!(json.contains("hookSpecificOutput"));
        assert!(json.contains("hookEventName"));
        assert!(json.contains("additionalContext"));
    }
}
