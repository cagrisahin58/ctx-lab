use anyhow::Result;
use std::io::Read;

/// Parse raw JSON input into a `PostToolUsePayload`.
///
/// Extracted from `run()` so it can be unit-tested without stdin.
pub fn parse_payload(input: &str) -> Result<seslog_core::models::PostToolUsePayload> {
    Ok(serde_json::from_str(input)?)
}

/// Check whether a checkpoint should be debounced (skipped) based on the
/// last timestamp stored in `debounce_file` and the configured `interval_secs`.
///
/// Returns `true` when the elapsed time since the last checkpoint is
/// less than the required interval, meaning the checkpoint should be skipped.
pub fn is_debounced(debounce_file: &std::path::Path, interval_secs: i64) -> bool {
    if let Ok(content) = std::fs::read_to_string(debounce_file) {
        if let Ok(last_ts) = content.trim().parse::<i64>() {
            let now = chrono::Utc::now().timestamp();
            return now - last_ts < interval_secs;
        }
    }
    false
}

pub fn run() -> Result<()> {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    let payload = parse_payload(&input)?;

    let base = seslog_core::storage::seslog_dir()?;
    let debounce_file = base.join(format!(".last-checkpoint-{}", payload.session_id));

    // Debounce check
    let config = seslog_core::config::load_config(&base.join("config.toml"))?;
    let interval_secs = (config.checkpoint_interval_minutes as i64) * 60;
    if is_debounced(&debounce_file, interval_secs) {
        return Ok(()); // debounced
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_parse_payload_valid() {
        let json = r#"{
            "session_id": "abc-123",
            "transcript_path": "/tmp/transcript.jsonl",
            "cwd": "/home/user/project",
            "tool_name": "Write",
            "tool_input": {"path": "/tmp/test.txt"},
            "tool_response": "ok"
        }"#;
        let payload = parse_payload(json).unwrap();
        assert_eq!(payload.session_id, "abc-123");
        assert_eq!(payload.tool_name, Some("Write".into()));
    }

    #[test]
    fn test_parse_payload_minimal() {
        let json = r#"{
            "session_id": "def-456",
            "transcript_path": "/tmp/t.jsonl",
            "cwd": "/tmp"
        }"#;
        let payload = parse_payload(json).unwrap();
        assert_eq!(payload.session_id, "def-456");
        assert!(payload.tool_name.is_none());
        assert!(payload.tool_input.is_none());
        assert!(payload.tool_response.is_none());
    }

    #[test]
    fn test_parse_payload_invalid_json() {
        let result = parse_payload("{invalid");
        assert!(result.is_err());
    }

    #[test]
    fn test_debounce_no_file_returns_false() {
        let tmp = TempDir::new().unwrap();
        let debounce_file = tmp.path().join(".last-checkpoint-test");
        assert!(!is_debounced(&debounce_file, 600));
    }

    #[test]
    fn test_debounce_recent_timestamp_returns_true() {
        let tmp = TempDir::new().unwrap();
        let debounce_file = tmp.path().join(".last-checkpoint-test");
        let now = chrono::Utc::now().timestamp();
        std::fs::write(&debounce_file, now.to_string()).unwrap();
        // 10-minute interval, timestamp is fresh => debounced
        assert!(is_debounced(&debounce_file, 600));
    }

    #[test]
    fn test_debounce_old_timestamp_returns_false() {
        let tmp = TempDir::new().unwrap();
        let debounce_file = tmp.path().join(".last-checkpoint-test");
        let old = chrono::Utc::now().timestamp() - 700; // 700s ago, interval = 600s
        std::fs::write(&debounce_file, old.to_string()).unwrap();
        assert!(!is_debounced(&debounce_file, 600));
    }

    #[test]
    fn test_debounce_corrupt_content_returns_false() {
        let tmp = TempDir::new().unwrap();
        let debounce_file = tmp.path().join(".last-checkpoint-test");
        std::fs::write(&debounce_file, "not-a-number").unwrap();
        assert!(!is_debounced(&debounce_file, 600));
    }
}
