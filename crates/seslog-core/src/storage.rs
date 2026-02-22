use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use anyhow::Result;

pub fn atomic_write(path: &Path, content: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp_path = path.with_extension("tmp");
    let mut file = fs::File::create(&tmp_path)?;
    file.write_all(content)?;
    file.sync_all()?;
    fs::rename(&tmp_path, path)?;
    Ok(())
}

pub fn write_json<T: serde::Serialize>(path: &Path, value: &T) -> Result<()> {
    let json = serde_json::to_string_pretty(value)?;
    atomic_write(path, json.as_bytes())
}

pub fn safe_read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<Option<T>> {
    let quarantine_dir = seslog_dir()?.join("quarantine");
    safe_read_json_with_quarantine(path, &quarantine_dir)
}

pub fn safe_read_json_with_quarantine<T: serde::de::DeserializeOwned>(
    path: &Path,
    quarantine_dir: &Path,
) -> Result<Option<T>> {
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    match serde_json::from_str::<T>(&content) {
        Ok(v) => Ok(Some(v)),
        Err(e) => {
            fs::create_dir_all(quarantine_dir)?;
            let quarantine_path = quarantine_dir.join(format!(
                "{}_{}",
                chrono::Utc::now().format("%Y%m%d_%H%M%S"),
                path.file_name().unwrap_or_default().to_string_lossy()
            ));
            fs::rename(path, &quarantine_path)?;
            eprintln!("[seslog] WARN: corrupt file quarantined: {:?} -> {:?}: {}", path, quarantine_path, e);
            Ok(None)
        }
    }
}

/// Returns the seslog data directory (`~/.seslog/`), migrating from `~/.ctx-lab/` if needed.
///
/// Migration is deferred if the old directory has active queue files (written in the last 30s).
pub fn seslog_dir() -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("HOME directory not found"))?;
    seslog_dir_with_home(&home)
}

/// Testable inner function that accepts a custom home directory.
pub fn seslog_dir_with_home(home: &Path) -> Result<PathBuf> {
    let new_dir = home.join(".seslog");
    let old_dir = home.join(".ctx-lab");

    // Guard: if old dir has active sessions (queue files written in last 30s), defer migration
    if old_dir.exists() && !new_dir.exists() {
        if has_active_queue(&old_dir) {
            eprintln!("[seslog] Active session detected, deferring migration. Using ~/.ctx-lab/");
            fs::create_dir_all(&old_dir)?;
            return Ok(old_dir);
        }
        fs::rename(&old_dir, &new_dir)?;
        eprintln!("[seslog] Migrated data: ~/.ctx-lab -> ~/.seslog");
    }
    fs::create_dir_all(&new_dir)?;
    Ok(new_dir)
}

fn has_active_queue(data_dir: &Path) -> bool {
    let queue_dir = data_dir.join("queue");
    let cutoff = SystemTime::now() - Duration::from_secs(30);
    queue_dir.read_dir().ok().map_or(false, |entries| {
        entries.filter_map(|e| e.ok())
            .any(|e| e.metadata().ok()
                .and_then(|m| m.modified().ok())
                .map_or(false, |t| t > cutoff))
    })
}

pub fn init_data_dir() -> Result<PathBuf> {
    let base = seslog_dir()?;
    init_data_dir_at(&base)?;
    Ok(base)
}

pub fn init_data_dir_at(base: &Path) -> Result<()> {
    for sub in &["projects", "machines", "templates", "queue", ".events", "quarantine"] {
        fs::create_dir_all(base.join(sub))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_atomic_write_creates_file() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("test.json");
        atomic_write(&path, b"hello").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "hello");
    }

    #[test]
    fn test_atomic_write_no_tmp_file_left() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("test.json");
        atomic_write(&path, b"data").unwrap();
        assert!(!path.with_extension("tmp").exists());
    }

    #[test]
    fn test_write_json_pretty_format() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("test.json");
        let data = serde_json::json!({"key": "value"});
        write_json(&path, &data).unwrap();
        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("  \"key\""));
    }

    #[test]
    fn test_safe_read_json_valid() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("test.json");
        fs::write(&path, r#"{"key":"value"}"#).unwrap();
        let result: Option<serde_json::Value> = safe_read_json_with_quarantine(&path, &tmp.path().join("q")).unwrap();
        assert!(result.is_some());
    }

    #[test]
    fn test_safe_read_json_missing_file() {
        let tmp = TempDir::new().unwrap();
        let result: Option<serde_json::Value> = safe_read_json_with_quarantine(
            &tmp.path().join("nope.json"),
            &tmp.path().join("q"),
        ).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_safe_read_json_corrupt_quarantines() {
        let tmp = TempDir::new().unwrap();
        let quarantine = tmp.path().join("quarantine");
        fs::create_dir_all(&quarantine).unwrap();
        let path = tmp.path().join("corrupt.json");
        fs::write(&path, "not json {{{").unwrap();
        let result: Option<serde_json::Value> = safe_read_json_with_quarantine(&path, &quarantine).unwrap();
        assert!(result.is_none());
        assert!(!path.exists());
        let entries: Vec<_> = fs::read_dir(&quarantine).unwrap().filter_map(|e| e.ok()).collect();
        assert_eq!(entries.len(), 1);
    }

    #[test]
    fn test_init_data_dir_creates_subdirs() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path().join(".seslog");
        init_data_dir_at(&base).unwrap();
        assert!(base.join("projects").is_dir());
        assert!(base.join("machines").is_dir());
        assert!(base.join("queue").is_dir());
        assert!(base.join(".events").is_dir());
        assert!(base.join("quarantine").is_dir());
        assert!(base.join("templates").is_dir());
    }

    #[test]
    fn test_migration_succeeds_when_no_active_queue() {
        let tmp = TempDir::new().unwrap();
        let home = tmp.path();
        let old = home.join(".ctx-lab");
        let new = home.join(".seslog");
        fs::create_dir_all(old.join("projects")).unwrap();
        fs::write(old.join("projects/test.json"), "{}").unwrap();

        let result = seslog_dir_with_home(home).unwrap();
        assert_eq!(result, new);
        assert!(new.join("projects/test.json").exists());
        assert!(!old.exists());
    }

    #[test]
    fn test_migration_deferred_when_active_queue() {
        let tmp = TempDir::new().unwrap();
        let home = tmp.path();
        let old = home.join(".ctx-lab");
        fs::create_dir_all(old.join("queue")).unwrap();
        fs::write(old.join("queue/active.json"), "{}").unwrap(); // just written = active

        let result = seslog_dir_with_home(home).unwrap();
        assert_eq!(result, old);
        assert!(old.exists());
        assert!(!home.join(".seslog").exists());
    }

    #[test]
    fn test_fresh_install_creates_seslog_dir() {
        let tmp = TempDir::new().unwrap();
        let home = tmp.path();
        // No .ctx-lab or .seslog exists

        let result = seslog_dir_with_home(home).unwrap();
        assert_eq!(result, home.join(".seslog"));
        assert!(result.exists());
    }

    #[test]
    fn test_existing_seslog_dir_not_affected_by_old() {
        let tmp = TempDir::new().unwrap();
        let home = tmp.path();
        let old = home.join(".ctx-lab");
        let new = home.join(".seslog");
        // Both exist — new dir takes precedence, old is NOT migrated
        fs::create_dir_all(&old).unwrap();
        fs::create_dir_all(&new).unwrap();

        let result = seslog_dir_with_home(home).unwrap();
        assert_eq!(result, new);
        // old dir still exists (not deleted since new already existed)
        assert!(old.exists());
    }
}
