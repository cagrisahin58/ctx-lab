use anyhow::Result;

/// Emit an IPC event to the `.events/` directory so the Tauri app can pick it up.
///
/// Event files are written atomically with a timestamped unique filename.
pub fn emit_event(event_type: &str, session_id: &str, project_id: &str) -> Result<()> {
    let events_dir = seslog_core::storage::seslog_dir()?.join(".events");
    std::fs::create_dir_all(&events_dir)?;

    let filename = format!(
        "{}_{}.json",
        chrono::Utc::now().format("%Y%m%d_%H%M%S_%3f"),
        &uuid::Uuid::new_v4().to_string()[..8]
    );

    let event = serde_json::json!({
        "event": event_type,
        "session_id": session_id,
        "project_id": project_id,
        "timestamp": chrono::Utc::now().to_rfc3339()
    });

    seslog_core::storage::atomic_write(
        &events_dir.join(&filename),
        serde_json::to_string(&event)?.as_bytes(),
    )
}
