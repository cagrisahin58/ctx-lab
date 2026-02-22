use anyhow::Result;
use std::io::Read;

pub fn run() -> Result<()> {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    let payload: seslog_core::models::StopPayload = serde_json::from_str(&input)?;

    // Loop protection
    if payload.stop_hook_active == Some(true) {
        return Ok(());
    }

    let queue_payload = serde_json::json!({
        "event": "stop",
        "session_id": payload.session_id,
        "transcript_path": payload.transcript_path,
        "timestamp": chrono::Utc::now().to_rfc3339(),
    });
    seslog_core::queue::enqueue("stop", &payload.session_id, &queue_payload)?;
    Ok(())
}
