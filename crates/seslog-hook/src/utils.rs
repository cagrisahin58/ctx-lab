/// Derive a project slug from the current working directory.
/// Uses the last path component (directory name) as the slug.
pub fn project_slug_from_cwd(cwd: &str) -> String {
    std::path::Path::new(cwd)
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown-project".into())
}

/// Read the real project ID from meta.toml (falls back to `proj_{slug}` if missing).
pub fn read_project_id(slug: &str) -> String {
    let base = match seslog_core::storage::seslog_dir() {
        Ok(b) => b,
        Err(_) => return format!("proj_{}", slug),
    };
    let meta_path = base.join("projects").join(slug).join("meta.toml");
    let content = match std::fs::read_to_string(&meta_path) {
        Ok(c) => c,
        Err(_) => return format!("proj_{}", slug),
    };
    let meta: seslog_core::models::ProjectMeta = match toml::from_str(&content) {
        Ok(m) => m,
        Err(_) => return format!("proj_{}", slug),
    };
    meta.project.id
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_project_slug_from_cwd() {
        assert_eq!(project_slug_from_cwd("/home/user/projects/my-project"), "my-project");
        assert_eq!(project_slug_from_cwd("/Users/cagri/PROJELER/adeb-sci"), "adeb-sci");
    }
}
