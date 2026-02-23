use anyhow::Result;
use std::io::Read;

/// Parse raw JSON input into a `StopPayload`.
///
/// Extracted from `run()` so it can be unit-tested without stdin.
pub fn parse_payload(input: &str) -> Result<seslog_core::models::StopPayload> {
    Ok(serde_json::from_str(input)?)
}

/// Returns `true` when the stop hook detects a re-entrant invocation
/// (loop protection). The hook should exit early in this case.
pub fn is_loop(payload: &seslog_core::models::StopPayload) -> bool {
    payload.stop_hook_active == Some(true)
}

pub fn run() -> Result<()> {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    let payload = parse_payload(&input)?;

    // Loop protection
    if is_loop(&payload) {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_payload_valid() {
        let json = r#"{
            "session_id": "abc-123",
            "transcript_path": "/tmp/transcript.jsonl",
            "stop_hook_active": false
        }"#;
        let payload = parse_payload(json).unwrap();
        assert_eq!(payload.session_id, "abc-123");
        assert_eq!(payload.stop_hook_active, Some(false));
    }

    #[test]
    fn test_parse_payload_minimal() {
        let json = r#"{
            "session_id": "def-456",
            "transcript_path": "/tmp/t.jsonl"
        }"#;
        let payload = parse_payload(json).unwrap();
        assert_eq!(payload.session_id, "def-456");
        assert!(payload.stop_hook_active.is_none());
    }

    #[test]
    fn test_parse_payload_invalid_json() {
        assert!(parse_payload("broken").is_err());
    }

    #[test]
    fn test_parse_payload_missing_required() {
        let json = r#"{"session_id": "x"}"#;
        assert!(parse_payload(json).is_err());
    }

    #[test]
    fn test_loop_protection_active() {
        let json = r#"{
            "session_id": "x",
            "transcript_path": "/tmp/t.jsonl",
            "stop_hook_active": true
        }"#;
        let payload = parse_payload(json).unwrap();
        assert!(is_loop(&payload));
    }

    #[test]
    fn test_loop_protection_inactive() {
        let json = r#"{
            "session_id": "x",
            "transcript_path": "/tmp/t.jsonl",
            "stop_hook_active": false
        }"#;
        let payload = parse_payload(json).unwrap();
        assert!(!is_loop(&payload));
    }

    #[test]
    fn test_loop_protection_absent() {
        let json = r#"{
            "session_id": "x",
            "transcript_path": "/tmp/t.jsonl"
        }"#;
        let payload = parse_payload(json).unwrap();
        assert!(!is_loop(&payload));
    }
}
