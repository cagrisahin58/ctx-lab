use anyhow::Result;
use std::io::Read;

pub fn run() -> Result<()> {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    let payload: seslog_core::models::PostToolUsePayload = serde_json::from_str(&input)?;

    let base = seslog_core::storage::seslog_dir()?;
    let debounce_file = base.join(format!(".last-checkpoint-{}", payload.session_id));

    // Debounce check
    if let Ok(content) = std::fs::read_to_string(&debounce_file) {
        if let Ok(last_ts) = content.trim().parse::<i64>() {
            let now = chrono::Utc::now().timestamp();
            let config = seslog_core::config::load_config(&base.join("config.toml"))?;
            let interval_secs = (config.checkpoint_interval_minutes as i64) * 60;
            if now - last_ts < interval_secs {
                return Ok(()); // debounced
            }
        }
    }

    // Update debounce timestamp
    seslog_core::storage::atomic_write(
        &debounce_file,
        chrono::Utc::now().timestamp().to_string().as_bytes(),
    )?;

    // Enqueue
    let queue_payload = serde_json::json!({
        "event": "checkpoint",
        "session_id": payload.session_id,
        "cwd": payload.cwd,
        "transcript_path": payload.transcript_path,
        "tool_name": payload.tool_name,
        "timestamp": chrono::Utc::now().to_rfc3339(),
    });
    seslog_core::queue::enqueue("checkpoint", &payload.session_id, &queue_payload)?;
    Ok(())
}
