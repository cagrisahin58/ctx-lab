use std::path::Path;
use anyhow::Result;
use crate::storage;

pub fn enqueue(event: &str, session_id: &str, payload: &serde_json::Value) -> Result<()> {
    let queue_dir = storage::ctx_lab_dir()?.join("queue");
    enqueue_to(&queue_dir, event, session_id, payload)
}

pub fn enqueue_to(queue_dir: &Path, event: &str, session_id: &str, payload: &serde_json::Value) -> Result<()> {
    std::fs::create_dir_all(queue_dir)?;
    let filename = format!(
        "{}_{}_{}_{}.json",
        chrono::Utc::now().format("%Y%m%d_%H%M%S_%3f"),
        event,
        session_id,
        &uuid::Uuid::new_v4().to_string()[..8]
    );
    storage::write_json(&queue_dir.join(&filename), payload)
}

pub fn process_all<F>(handler: F) -> Result<u32>
where F: FnMut(&str, serde_json::Value) -> Result<()>
{
    let queue_dir = storage::ctx_lab_dir()?.join("queue");
    process_all_from(&queue_dir, handler)
}

pub fn process_all_from<F>(queue_dir: &Path, mut handler: F) -> Result<u32>
where F: FnMut(&str, serde_json::Value) -> Result<()>
{
    let mut entries: Vec<_> = std::fs::read_dir(queue_dir)?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map_or(false, |ext| ext == "json"))
        .collect();
    entries.sort_by_key(|e| e.file_name());

    let mut processed = 0;
    for entry in entries {
        let path = entry.path();
        match storage::safe_read_json_with_quarantine::<serde_json::Value>(
            &path,
            &queue_dir.parent().unwrap_or(queue_dir).join("quarantine"),
        ) {
            Ok(Some(payload)) => {
                let event = path.file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("unknown");
                if let Err(e) = handler(event, payload) {
                    eprintln!("[ctx-lab] ERROR processing queue item {:?}: {}", path, e);
                    continue;
                }
                std::fs::remove_file(&path)?;
                processed += 1;
            }
            Ok(None) => {}
            Err(e) => eprintln!("[ctx-lab] ERROR reading queue item {:?}: {}", path, e),
        }
    }
    Ok(processed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_enqueue_creates_file() {
        let tmp = TempDir::new().unwrap();
        let queue_dir = tmp.path().join("queue");
        std::fs::create_dir_all(&queue_dir).unwrap();
        let payload = serde_json::json!({"session_id": "ses_1"});
        enqueue_to(&queue_dir, "session_end", "ses_1", &payload).unwrap();
        let entries: Vec<_> = std::fs::read_dir(&queue_dir).unwrap().filter_map(|e| e.ok()).collect();
        assert_eq!(entries.len(), 1);
        let name = entries[0].file_name().to_string_lossy().to_string();
        assert!(name.contains("session_end"));
        assert!(name.ends_with(".json"));
    }

    #[test]
    fn test_process_all_chronological_order() {
        let tmp = TempDir::new().unwrap();
        let queue_dir = tmp.path().join("queue");
        std::fs::create_dir_all(&queue_dir).unwrap();
        std::fs::write(queue_dir.join("20260101_000001_000_a_ses1_aaaa.json"), r#"{"order":1}"#).unwrap();
        std::fs::write(queue_dir.join("20260101_000002_000_b_ses1_bbbb.json"), r#"{"order":2}"#).unwrap();
        let mut order = vec![];
        process_all_from(&queue_dir, |_event, payload| {
            order.push(payload["order"].as_i64().unwrap());
            Ok(())
        }).unwrap();
        assert_eq!(order, vec![1, 2]);
        let remaining: Vec<_> = std::fs::read_dir(&queue_dir).unwrap().filter_map(|e| e.ok()).collect();
        assert_eq!(remaining.len(), 0);
    }

    #[test]
    fn test_process_all_skips_failed_items() {
        let tmp = TempDir::new().unwrap();
        let queue_dir = tmp.path().join("queue");
        std::fs::create_dir_all(&queue_dir).unwrap();
        std::fs::write(queue_dir.join("20260101_000001_000_ok_ses1_aaaa.json"), r#"{"ok":true}"#).unwrap();
        std::fs::write(queue_dir.join("20260101_000002_000_fail_ses1_bbbb.json"), r#"{"ok":false}"#).unwrap();
        let processed = process_all_from(&queue_dir, |_event, payload| {
            if payload["ok"].as_bool() == Some(true) { Ok(()) }
            else { Err(anyhow::anyhow!("simulated failure")) }
        }).unwrap();
        assert_eq!(processed, 1);
        let remaining: Vec<_> = std::fs::read_dir(&queue_dir).unwrap().filter_map(|e| e.ok()).collect();
        assert_eq!(remaining.len(), 1);
    }
}
