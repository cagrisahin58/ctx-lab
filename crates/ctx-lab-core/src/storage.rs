use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
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
    let quarantine_dir = ctx_lab_dir()?.join("quarantine");
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
            eprintln!("[ctx-lab] WARN: corrupt file quarantined: {:?} -> {:?}: {}", path, quarantine_path, e);
            Ok(None)
        }
    }
}

pub fn ctx_lab_dir() -> Result<PathBuf> {
    let dir = dirs::home_dir()
        .ok_or_else(|| anyhow::anyhow!("HOME directory not found"))?
        .join(".ctx-lab");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn init_data_dir() -> Result<PathBuf> {
    let base = ctx_lab_dir()?;
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
        let base = tmp.path().join(".ctx-lab");
        init_data_dir_at(&base).unwrap();
        assert!(base.join("projects").is_dir());
        assert!(base.join("machines").is_dir());
        assert!(base.join("queue").is_dir());
        assert!(base.join(".events").is_dir());
        assert!(base.join("quarantine").is_dir());
        assert!(base.join("templates").is_dir());
    }
}
