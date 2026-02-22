use std::path::Path;
use anyhow::Result;

// New markers (always written)
pub const SESLOG_START: &str = "<!-- seslog:start -->";
pub const SESLOG_END: &str = "<!-- seslog:end -->";

// Old markers (read for backward compat, never written)
const OLD_START: &str = "<!-- ctx-lab:start -->";
const OLD_END: &str = "<!-- ctx-lab:end -->";

/// Find the start/end markers in content, trying new markers first, then old.
/// Returns (start_idx, end_of_end_idx) if found.
fn find_block(content: &str) -> Option<(usize, usize)> {
    // Try new markers first
    if let (Some(s), Some(e)) = (content.find(SESLOG_START), content.find(SESLOG_END)) {
        return Some((s, e + SESLOG_END.len()));
    }
    // Fall back to old markers
    if let (Some(s), Some(e)) = (content.find(OLD_START), content.find(OLD_END)) {
        return Some((s, e + OLD_END.len()));
    }
    None
}

pub fn update_claude_md(project_dir: &Path, block_content: &str) -> Result<()> {
    let claude_md = project_dir.join("CLAUDE.md");
    let existing = std::fs::read_to_string(&claude_md).unwrap_or_default();
    let new_block = format!("{}\n{}\n{}", SESLOG_START, block_content, SESLOG_END);
    let updated = if let Some((start, end)) = find_block(&existing) {
        format!("{}{}{}", &existing[..start], new_block, &existing[end..])
    } else if existing.is_empty() {
        new_block
    } else {
        format!("{}\n\n{}", existing.trim_end(), new_block)
    };
    crate::storage::atomic_write(&claude_md, updated.as_bytes())
}

pub fn remove_claude_md_block(project_dir: &Path) -> Result<()> {
    let claude_md = project_dir.join("CLAUDE.md");
    let existing = std::fs::read_to_string(&claude_md)?;
    if let Some((start, end)) = find_block(&existing) {
        let before = existing[..start].trim_end();
        let after = existing[end..].trim_start();
        let cleaned = if before.is_empty() { after.to_string() }
                      else { format!("{}\n{}", before, after) };
        if cleaned.trim().is_empty() {
            std::fs::remove_file(&claude_md)?;
        } else {
            crate::storage::atomic_write(&claude_md, cleaned.as_bytes())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_update_new_file() {
        let tmp = TempDir::new().unwrap();
        update_claude_md(tmp.path(), "Hello from seslog").unwrap();
        let content = std::fs::read_to_string(tmp.path().join("CLAUDE.md")).unwrap();
        assert!(content.contains(SESLOG_START));
        assert!(content.contains("Hello from seslog"));
        assert!(content.contains(SESLOG_END));
    }

    #[test]
    fn test_update_existing_with_new_markers_replaces_block() {
        let tmp = TempDir::new().unwrap();
        let claude_md = tmp.path().join("CLAUDE.md");
        std::fs::write(&claude_md, format!(
            "User content above\n\n{}\nOld block\n{}\n\nUser content below",
            SESLOG_START, SESLOG_END
        )).unwrap();
        update_claude_md(tmp.path(), "New block").unwrap();
        let content = std::fs::read_to_string(&claude_md).unwrap();
        assert!(content.contains("User content above"));
        assert!(content.contains("New block"));
        assert!(!content.contains("Old block"));
        assert!(content.contains("User content below"));
        // Always writes new markers
        assert!(content.contains(SESLOG_START));
        assert!(content.contains(SESLOG_END));
    }

    #[test]
    fn test_update_existing_with_old_markers_replaces_and_upgrades() {
        let tmp = TempDir::new().unwrap();
        let claude_md = tmp.path().join("CLAUDE.md");
        std::fs::write(&claude_md, format!(
            "User content above\n\n{}\nOld block\n{}\n\nUser content below",
            OLD_START, OLD_END
        )).unwrap();
        update_claude_md(tmp.path(), "New block").unwrap();
        let content = std::fs::read_to_string(&claude_md).unwrap();
        assert!(content.contains("User content above"));
        assert!(content.contains("New block"));
        assert!(!content.contains("Old block"));
        assert!(content.contains("User content below"));
        // Old markers replaced with new ones
        assert!(content.contains(SESLOG_START));
        assert!(content.contains(SESLOG_END));
        assert!(!content.contains(OLD_START));
        assert!(!content.contains(OLD_END));
    }

    #[test]
    fn test_update_existing_without_markers_appends() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(tmp.path().join("CLAUDE.md"), "Existing user content").unwrap();
        update_claude_md(tmp.path(), "seslog info").unwrap();
        let content = std::fs::read_to_string(tmp.path().join("CLAUDE.md")).unwrap();
        assert!(content.starts_with("Existing user content"));
        assert!(content.contains(SESLOG_START));
    }

    #[test]
    fn test_remove_block_new_markers() {
        let tmp = TempDir::new().unwrap();
        let claude_md = tmp.path().join("CLAUDE.md");
        std::fs::write(&claude_md, format!(
            "Keep this\n\n{}\nRemove this\n{}\n\nKeep this too",
            SESLOG_START, SESLOG_END
        )).unwrap();
        remove_claude_md_block(tmp.path()).unwrap();
        let content = std::fs::read_to_string(&claude_md).unwrap();
        assert!(content.contains("Keep this"));
        assert!(!content.contains(SESLOG_START));
    }

    #[test]
    fn test_remove_block_old_markers() {
        let tmp = TempDir::new().unwrap();
        let claude_md = tmp.path().join("CLAUDE.md");
        std::fs::write(&claude_md, format!(
            "Keep this\n\n{}\nRemove this\n{}\n\nKeep this too",
            OLD_START, OLD_END
        )).unwrap();
        remove_claude_md_block(tmp.path()).unwrap();
        let content = std::fs::read_to_string(&claude_md).unwrap();
        assert!(content.contains("Keep this"));
        assert!(!content.contains(OLD_START));
    }

    #[test]
    fn test_remove_block_deletes_empty_file() {
        let tmp = TempDir::new().unwrap();
        let claude_md = tmp.path().join("CLAUDE.md");
        std::fs::write(&claude_md, format!("{}\nOnly seslog content\n{}", SESLOG_START, SESLOG_END)).unwrap();
        remove_claude_md_block(tmp.path()).unwrap();
        assert!(!claude_md.exists());
    }
}
