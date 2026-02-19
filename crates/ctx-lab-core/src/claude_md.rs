use std::path::Path;
use anyhow::Result;

pub const CTX_LAB_START: &str = "<!-- ctx-lab:start -->";
pub const CTX_LAB_END: &str = "<!-- ctx-lab:end -->";

pub fn update_claude_md(project_dir: &Path, block_content: &str) -> Result<()> {
    let claude_md = project_dir.join("CLAUDE.md");
    let existing = std::fs::read_to_string(&claude_md).unwrap_or_default();
    let new_block = format!("{}\n{}\n{}", CTX_LAB_START, block_content, CTX_LAB_END);
    let updated = if existing.contains(CTX_LAB_START) && existing.contains(CTX_LAB_END) {
        let start_idx = existing.find(CTX_LAB_START).unwrap();
        let end_idx = existing.find(CTX_LAB_END).unwrap() + CTX_LAB_END.len();
        format!("{}{}{}", &existing[..start_idx], new_block, &existing[end_idx..])
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
    if let (Some(start), Some(end)) = (existing.find(CTX_LAB_START), existing.find(CTX_LAB_END)) {
        let before = existing[..start].trim_end();
        let after = existing[end + CTX_LAB_END.len()..].trim_start();
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
        update_claude_md(tmp.path(), "Hello from ctx-lab").unwrap();
        let content = std::fs::read_to_string(tmp.path().join("CLAUDE.md")).unwrap();
        assert!(content.contains(CTX_LAB_START));
        assert!(content.contains("Hello from ctx-lab"));
        assert!(content.contains(CTX_LAB_END));
    }

    #[test]
    fn test_update_existing_with_markers_replaces_block() {
        let tmp = TempDir::new().unwrap();
        let claude_md = tmp.path().join("CLAUDE.md");
        std::fs::write(&claude_md, format!(
            "User content above\n\n{}\nOld block\n{}\n\nUser content below",
            CTX_LAB_START, CTX_LAB_END
        )).unwrap();
        update_claude_md(tmp.path(), "New block").unwrap();
        let content = std::fs::read_to_string(&claude_md).unwrap();
        assert!(content.contains("User content above"));
        assert!(content.contains("New block"));
        assert!(!content.contains("Old block"));
        assert!(content.contains("User content below"));
    }

    #[test]
    fn test_update_existing_without_markers_appends() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(tmp.path().join("CLAUDE.md"), "Existing user content").unwrap();
        update_claude_md(tmp.path(), "ctx-lab info").unwrap();
        let content = std::fs::read_to_string(tmp.path().join("CLAUDE.md")).unwrap();
        assert!(content.starts_with("Existing user content"));
        assert!(content.contains(CTX_LAB_START));
    }

    #[test]
    fn test_remove_block() {
        let tmp = TempDir::new().unwrap();
        let claude_md = tmp.path().join("CLAUDE.md");
        std::fs::write(&claude_md, format!(
            "Keep this\n\n{}\nRemove this\n{}\n\nKeep this too",
            CTX_LAB_START, CTX_LAB_END
        )).unwrap();
        remove_claude_md_block(tmp.path()).unwrap();
        let content = std::fs::read_to_string(&claude_md).unwrap();
        assert!(content.contains("Keep this"));
        assert!(!content.contains(CTX_LAB_START));
    }

    #[test]
    fn test_remove_block_deletes_empty_file() {
        let tmp = TempDir::new().unwrap();
        let claude_md = tmp.path().join("CLAUDE.md");
        std::fs::write(&claude_md, format!("{}\nOnly ctx-lab content\n{}", CTX_LAB_START, CTX_LAB_END)).unwrap();
        remove_claude_md_block(tmp.path()).unwrap();
        assert!(!claude_md.exists());
    }
}
