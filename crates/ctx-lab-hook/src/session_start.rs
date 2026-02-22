use anyhow::Result;
use ctx_lab_core::models::*;
use std::io::Read;

pub fn run() -> Result<()> {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    let payload: SessionStartPayload = serde_json::from_str(&input)?;

    let base = ctx_lab_core::storage::ctx_lab_dir()?;

    // Git-based sync: pull on startup
    match ctx_lab_core::git_ops::sync_pull(&base) {
        Ok(ctx_lab_core::git_ops::SyncResult::Synced) => eprintln!("[ctx-lab] Synced from remote"),
        Ok(ctx_lab_core::git_ops::SyncResult::Conflict(msg)) => eprintln!("[ctx-lab] {}", msg),
        Ok(ctx_lab_core::git_ops::SyncResult::Offline(e)) => eprintln!("[ctx-lab] Offline: {}", e),
        Ok(_) => {}
        Err(e) => eprintln!("[ctx-lab] Sync pull error: {}", e),
    }

    let slug = project_slug_from_cwd(&payload.cwd);
    let project_dir = base.join("projects").join(&slug);
    std::fs::create_dir_all(&project_dir)?;

    // Auto-register new project
    let meta_path = project_dir.join("meta.toml");
    if !meta_path.exists() {
        let meta = ProjectMeta {
            schema_version: SCHEMA_VERSION,
            project: ProjectInfo {
                id: format!("proj_{}", &uuid::Uuid::new_v4().to_string()[..8]),
                name: slug.clone(),
                status: "active".into(),
                created_at: chrono::Utc::now(),
                archived_at: None,
                description: String::new(),
            },
            paths: {
                let mut m = std::collections::HashMap::new();
                let hostname = hostname::get().map(|h| h.to_string_lossy().to_string()).unwrap_or_else(|_| "unknown".into());
                m.insert(hostname, payload.cwd.clone());
                m
            },
        };
        let toml_str = toml::to_string_pretty(&meta)?;
        ctx_lab_core::storage::atomic_write(&meta_path, toml_str.as_bytes())?;
    }

    // Read last session summary
    let last_summary = read_last_session_summary(&project_dir);

    // Read roadmap
    let roadmap_path = project_dir.join("roadmap.md");
    let roadmap_content = std::fs::read_to_string(&roadmap_path).unwrap_or_default();
    let has_roadmap = !roadmap_content.trim().is_empty();
    let active_step = ctx_lab_core::roadmap::active_item(&roadmap_content).map(|i| i.text);
    let progress = if has_roadmap { Some(format!("{}%", ctx_lab_core::roadmap::progress_percent(&roadmap_content))) } else { None };

    // Build context
    let context = build_additional_context(last_summary.as_deref(), active_step.as_deref(), progress.as_deref(), has_roadmap);

    // Update CLAUDE.md
    let block = build_claude_md_block(last_summary.as_deref(), active_step.as_deref(), &roadmap_content);
    let _ = ctx_lab_core::claude_md::update_claude_md(std::path::Path::new(&payload.cwd), &block);

    // Emit event via shared bridge
    crate::event_bridge::emit_event("session_started", &payload.session_id, &slug).ok();

    // Output to stdout
    print!("{}", format_output(&context));
    Ok(())
}

pub fn project_slug_from_cwd(cwd: &str) -> String {
    std::path::Path::new(cwd).file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_else(|| "unknown-project".into())
}

/// Read the real project ID from meta.toml (falls back to `proj_{slug}` if missing).
pub fn read_project_id(slug: &str) -> String {
    let base = match ctx_lab_core::storage::ctx_lab_dir() {
        Ok(b) => b,
        Err(_) => return format!("proj_{}", slug),
    };
    let meta_path = base.join("projects").join(slug).join("meta.toml");
    let content = match std::fs::read_to_string(&meta_path) {
        Ok(c) => c,
        Err(_) => return format!("proj_{}", slug),
    };
    let meta: ctx_lab_core::models::ProjectMeta = match toml::from_str(&content) {
        Ok(m) => m,
        Err(_) => return format!("proj_{}", slug),
    };
    meta.project.id
}

fn read_last_session_summary(project_dir: &std::path::Path) -> Option<String> {
    let sessions_dir = project_dir.join("sessions");
    let mut entries: Vec<_> = std::fs::read_dir(&sessions_dir).ok()?.filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|ext| ext == "json")).collect();
    entries.sort_by_key(|e| e.file_name());
    let last = entries.last()?;
    let content = std::fs::read_to_string(last.path()).ok()?;
    let session: serde_json::Value = serde_json::from_str(&content).ok()?;
    session.get("summary").and_then(|s| s.as_str()).map(|s| s.to_string())
}

pub fn build_additional_context(last_summary: Option<&str>, active_step: Option<&str>, progress: Option<&str>, has_roadmap: bool) -> String {
    let mut parts = vec!["[Seslog] Project context:".to_string()];
    if let Some(s) = last_summary { parts.push(format!("Last session: {}", s.chars().take(500).collect::<String>())); }
    if let Some(s) = active_step { parts.push(format!("Active roadmap step: {}", s)); }
    if let Some(p) = progress { parts.push(format!("Progress: {}", p)); }
    if !has_roadmap {
        parts.push("No roadmap yet. When the user says 'yol haritasi olustur' (create roadmap), analyze the project state and write a roadmap to ~/.ctx-lab/projects/<slug>/roadmap.md where <slug> is the basename of the current working directory. Use this exact format:\n## Phase Name\n- [x] Completed item\n- [>] Active item (currently working on)\n- [ ] Pending item\n- [~] Suspended item\n- [!] Blocked item".into());
    }
    parts.push("When the user says 'oturum ozet' (session summary):\n1. Summarize what was done and remaining work in 3-4 sentences, then run: ctx-lab-hook summary \"<your summary>\"\n2. If ~/.ctx-lab/projects/<slug>/roadmap.md exists (where <slug> is basename of cwd), update it: mark completed items as [x], the currently active item as [>], and pending items as [ ]. Write the updated file directly.".into());
    let mut result = parts.join("\n");
    if result.len() > 2000 { result = result.chars().take(1997).collect::<String>() + "..."; }
    result
}

fn build_claude_md_block(last_summary: Option<&str>, active_step: Option<&str>, roadmap_content: &str) -> String {
    let mut lines = vec!["## Project Status (auto-updated by Seslog)".to_string(), String::new()];
    if let Some(s) = last_summary { lines.push(format!("**Last Session:** {}", s.chars().take(300).collect::<String>())); }
    if let Some(s) = active_step { lines.push(format!("**Active Step:** {}", s)); }
    let items = ctx_lab_core::roadmap::parse_roadmap(roadmap_content);
    let relevant: Vec<_> = items.iter()
        .filter(|i| matches!(i.status, ctx_lab_core::roadmap::ItemStatus::Active | ctx_lab_core::roadmap::ItemStatus::Pending))
        .take(5).collect();
    if !relevant.is_empty() {
        lines.push(String::new());
        lines.push("### Upcoming".to_string());
        for item in relevant {
            let m = match item.status { ctx_lab_core::roadmap::ItemStatus::Active => "[>]", _ => "[ ]" };
            lines.push(format!("- {} {}", m, item.text));
        }
    }
    lines.join("\n")
}

pub fn format_output(context: &str) -> String {
    let output = SessionStartOutput {
        hook_specific_output: HookSpecificOutput {
            hook_event_name: "SessionStart".into(),
            additional_context: context.into(),
        },
    };
    serde_json::to_string(&output).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_project_slug_from_cwd() {
        assert_eq!(project_slug_from_cwd("/home/user/projects/my-project"), "my-project");
        assert_eq!(project_slug_from_cwd("/Users/cagri/PROJELER/adeb-sci"), "adeb-sci");
    }

    #[test]
    fn test_build_context_with_summary() {
        let ctx = build_additional_context(Some("Fixed auth bug"), Some("Feature engineering"), Some("33%"), true);
        assert!(ctx.contains("Fixed auth bug"));
        assert!(ctx.contains("Feature engineering"));
    }

    #[test]
    fn test_build_context_empty_roadmap() {
        let ctx = build_additional_context(None, None, None, false);
        assert!(ctx.contains("roadmap"));
    }

    #[test]
    fn test_build_context_truncation() {
        let long = "x".repeat(2000);
        let ctx = build_additional_context(Some(&long), Some("step"), Some("50%"), true);
        assert!(ctx.len() <= 2000);
    }

    #[test]
    fn test_format_output_json() {
        let output = format_output("test");
        let parsed: serde_json::Value = serde_json::from_str(&output).unwrap();
        assert_eq!(parsed["hookSpecificOutput"]["hookEventName"], "SessionStart");
        assert_eq!(parsed["hookSpecificOutput"]["additionalContext"], "test");
    }
}
