use anyhow::Result;
use std::path::{Path, PathBuf};

/// Find the latest `.json` session file in a sessions directory.
///
/// Files are sorted lexicographically by name; the last one is returned.
/// Returns `None` when the directory is empty or contains no JSON files.
pub fn find_latest_session(sessions_dir: &Path) -> Result<Option<PathBuf>> {
    let mut entries: Vec<_> = std::fs::read_dir(sessions_dir)?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|ext| ext == "json"))
        .collect();
    entries.sort_by_key(|e| e.file_name());
    Ok(entries.last().map(|e| e.path()))
}

/// Write a manual summary into a session file, overriding any previous summary.
pub fn write_manual_summary(session_path: &Path, text: &str) -> Result<()> {
    let mut session: seslog_core::models::Session =
        seslog_core::storage::safe_read_json(session_path)?
            .ok_or_else(|| anyhow::anyhow!("failed to read session file"))?;

    session.summary = text.to_string();
    session.summary_source = Some(seslog_core::models::SummarySource::Manual);

    seslog_core::storage::write_json(session_path, &session)?;
    Ok(())
}

/// Manual summary command: seslog summary "text"
/// Finds the current project from cwd, writes summary to latest session JSON.
pub fn run(text: &str) -> Result<()> {
    let cwd = std::env::current_dir()?;
    let cwd_str = cwd.to_string_lossy().to_string();
    let slug = crate::utils::project_slug_from_cwd(&cwd_str);

    let base = seslog_core::storage::seslog_dir()?;
    let sessions_dir = base.join("projects").join(&slug).join("sessions");

    let session_path = find_latest_session(&sessions_dir)?
        .ok_or_else(|| anyhow::anyhow!("no session files found for project '{}'", slug))?;

    write_manual_summary(&session_path, text)?;
    eprintln!("[Seslog] Summary saved to {}", session_path.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn make_session_json(summary: &str) -> String {
        serde_json::to_string_pretty(&serde_json::json!({
            "schema_version": 1,
            "id": "ses_test",
            "project_id": "proj_test",
            "machine": "mac",
            "started_at": "2026-01-01T00:00:00Z",
            "summary": summary,
            "summary_source": "minimal"
        }))
        .unwrap()
    }

    #[test]
    fn test_find_latest_session_returns_last() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        std::fs::write(dir.join("20260101_mac_aaa.json"), make_session_json("first")).unwrap();
        std::fs::write(dir.join("20260102_mac_bbb.json"), make_session_json("second")).unwrap();
        let latest = find_latest_session(dir).unwrap().unwrap();
        assert!(latest.file_name().unwrap().to_string_lossy().contains("20260102"));
    }

    #[test]
    fn test_find_latest_session_empty_dir() {
        let tmp = TempDir::new().unwrap();
        let result = find_latest_session(tmp.path()).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_find_latest_session_ignores_non_json() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        std::fs::write(dir.join("notes.txt"), "not json").unwrap();
        std::fs::write(dir.join("session.json"), make_session_json("s")).unwrap();
        let latest = find_latest_session(dir).unwrap().unwrap();
        assert!(latest.file_name().unwrap().to_string_lossy().contains("session"));
    }

    #[test]
    fn test_find_latest_session_nonexistent_dir() {
        let result = find_latest_session(Path::new("/tmp/nonexistent_dir_xyz"));
        assert!(result.is_err());
    }

    #[test]
    fn test_write_manual_summary_updates_file() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("session.json");
        std::fs::write(&path, make_session_json("old summary")).unwrap();

        write_manual_summary(&path, "new manual summary").unwrap();

        let content = std::fs::read_to_string(&path).unwrap();
        let session: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert_eq!(session["summary"], "new manual summary");
        assert_eq!(session["summary_source"], "manual");
    }

    #[test]
    fn test_write_manual_summary_missing_file() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("nonexistent.json");
        let result = write_manual_summary(&path, "text");
        assert!(result.is_err());
    }
}
