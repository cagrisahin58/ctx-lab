use anyhow::Result;

/// Manual summary command: ctx-lab-hook summary "text"
/// Finds the current project from cwd, writes summary to latest session JSON.
pub fn run(text: &str) -> Result<()> {
    let cwd = std::env::current_dir()?;
    let cwd_str = cwd.to_string_lossy().to_string();
    let slug = crate::session_start::project_slug_from_cwd(&cwd_str);

    let base = ctx_lab_core::storage::ctx_lab_dir()?;
    let sessions_dir = base.join("projects").join(&slug).join("sessions");

    // Find latest session file
    let mut entries: Vec<_> = std::fs::read_dir(&sessions_dir)?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|ext| ext == "json"))
        .collect();
    entries.sort_by_key(|e| e.file_name());
    let last = entries
        .last()
        .ok_or_else(|| anyhow::anyhow!("no session files found for project '{}'", slug))?;

    let session_path = last.path();
    let mut session: ctx_lab_core::models::Session =
        ctx_lab_core::storage::safe_read_json(&session_path)?
            .ok_or_else(|| anyhow::anyhow!("failed to read session file"))?;

    // Manual summary takes priority
    session.summary = text.to_string();
    session.summary_source = "manual".into();

    ctx_lab_core::storage::write_json(&session_path, &session)?;
    eprintln!("[Seslog] Summary saved to {}", session_path.display());
    Ok(())
}
