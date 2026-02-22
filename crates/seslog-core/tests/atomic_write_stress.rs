use seslog_core::storage;
use std::thread;
use tempfile::TempDir;

#[test]
fn test_concurrent_writes_no_corruption() {
    let tmp = TempDir::new().unwrap();
    let mut handles = vec![];
    for i in 0..10 {
        let dir = tmp.path().to_path_buf();
        handles.push(thread::spawn(move || {
            let path = dir.join(format!("file_{}.json", i));
            let data = serde_json::json!({"thread": i, "data": "x".repeat(1000)});
            storage::write_json(&path, &data).unwrap();
            // Verify valid JSON
            let content = std::fs::read_to_string(&path).unwrap();
            let _: serde_json::Value = serde_json::from_str(&content).unwrap();
        }));
    }
    for h in handles {
        h.join().unwrap();
    }
}
