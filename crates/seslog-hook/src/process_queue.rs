use anyhow::Result;

pub fn run() -> Result<()> {
    eprintln!("[seslog] Processing queue...");
    let processed = seslog_core::queue::process_all(handle_queue_item)?;
    eprintln!("[seslog] Processed {} queue items", processed);
    Ok(())
}

fn handle_queue_item(_event_name: &str, payload: serde_json::Value) -> Result<()> {
    let event = payload
        .get("event")
        .and_then(|e| e.as_str())
        .unwrap_or("unknown");
    match event {
        "checkpoint" => process_checkpoint(payload),
        "stop" => process_stop(payload),
        "session_end_enrich" => process_session_enrichment(payload),
        _ => {
            eprintln!("[seslog] Unknown queue event: {}", event);
            Ok(())
        }
    }
}

fn process_checkpoint(payload: serde_json::Value) -> Result<()> {
    let session_id = payload["session_id"].as_str().unwrap_or("unknown");
    let cwd = payload["cwd"].as_str().unwrap_or(".");
    let cwd_path = std::path::Path::new(cwd);

    let base = seslog_core::storage::seslog_dir()?;
    let slug = crate::session_start::project_slug_from_cwd(cwd);
    let checkpoints_dir = base.join("projects").join(&slug).join("checkpoints");
    std::fs::create_dir_all(&checkpoints_dir)?;

    let now = chrono::Utc::now();
    let chk_id = format!("chk_{}", &uuid::Uuid::new_v4().to_string()[..8]);

    let checkpoint = seslog_core::models::Checkpoint {
        schema_version: seslog_core::models::SCHEMA_VERSION,
        id: chk_id.clone(),
        session_id: format!("ses_{}", session_id),
        project_id: crate::session_start::read_project_id(&slug),
        machine: hostname::get()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or_else(|_| "unknown".into()),
        timestamp: now,
        git_diff_stat: seslog_core::git_ops::diff_stat(cwd_path).unwrap_or(None),
        files_changed: seslog_core::git_ops::changed_files(cwd_path).unwrap_or_default(),
        recent_commits: seslog_core::git_ops::recent_commits(cwd_path, 3).unwrap_or_default(),
        source: "postToolUse_debounced".into(),
    };

    let path = checkpoints_dir.join(format!(
        "{}_{}.json",
        now.format("%Y%m%d_%H%M%S"),
        chk_id
    ));
    seslog_core::storage::write_json(&path, &checkpoint)?;
    eprintln!("[seslog] Checkpoint created: {}", chk_id);
    Ok(())
}

fn process_stop(payload: serde_json::Value) -> Result<()> {
    let session_id = payload["session_id"].as_str().unwrap_or("unknown");
    eprintln!("[seslog] Stop event processed for session {}", session_id);
    Ok(())
}

fn process_session_enrichment(payload: serde_json::Value) -> Result<()> {
    let session_file = payload["session_file"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("missing session_file"))?;
    let transcript_path = payload["transcript_path"].as_str().unwrap_or("");
    let cwd = payload["cwd"].as_str().unwrap_or(".");

    let session_path = std::path::Path::new(session_file);
    let mut session: seslog_core::models::Session =
        match seslog_core::storage::safe_read_json(session_path)? {
            Some(s) => s,
            None => return Ok(()),
        };

    let base = seslog_core::storage::seslog_dir()?;
    let config = seslog_core::config::load_config(&base.join("config.toml"))?;

    // Parse transcript
    let highlights = seslog_core::transcript::extract_highlights(
        std::path::Path::new(transcript_path),
        std::path::Path::new(cwd),
        config.transcript_max_messages as usize,
        (config.transcript_max_tokens * 4) as usize,
    );

    // Build structured summary from transcript highlights (must borrow before partial moves)
    let transcript_summary = seslog_core::transcript::build_summary(&highlights);

    session.tools_used = highlights.tools_used;
    session.transcript_highlights = highlights.user_messages;

    // Manual summary (from `seslog summary`) takes priority
    if session.summary_source != "manual" {
        if !transcript_summary.what_was_done.is_empty() {
            session.summary = transcript_summary.what_was_done;
            session.summary_source = "transcript+git".into();
        }
        // else: keep existing summary (e.g. git diff fallback)
    }
    if session.next_steps.is_empty() {
        session.next_steps = transcript_summary.next_steps;
    }

    // Sanitize
    if config.sanitize_secrets {
        let sanitized = seslog_core::sanitize::sanitize(&session.summary);
        session.summary = sanitized.text;
        session.redaction_count = sanitized.redaction_count;
        session.transcript_highlights = session
            .transcript_highlights
            .into_iter()
            .map(|h| seslog_core::sanitize::sanitize(&h).text)
            .collect();
        let sanitized_next = seslog_core::sanitize::sanitize(&session.next_steps);
        session.next_steps = sanitized_next.text;
        session.redaction_count += sanitized_next.redaction_count;
    }

    // Update CLAUDE.md
    let slug = crate::session_start::project_slug_from_cwd(cwd);
    let roadmap_path = base.join("projects").join(&slug).join("roadmap.md");
    let roadmap_content = std::fs::read_to_string(&roadmap_path).unwrap_or_default();
    let active_step = seslog_core::roadmap::active_item(&roadmap_content).map(|i| i.text);
    let block = format!(
        "## Project Status (auto-updated by Seslog)\n\n**Last Session:** {}\n**Summary:** {}\n{}",
        session
            .ended_at
            .map_or("unknown".into(), |t| t.format("%Y-%m-%d %H:%M").to_string()),
        session.summary,
        active_step.map_or(String::new(), |s| format!("**Active Step:** {}", s)),
    );
    let _ = seslog_core::claude_md::update_claude_md(std::path::Path::new(cwd), &block);

    seslog_core::storage::write_json(session_path, &session)?;
    eprintln!("[seslog] Session enriched: {}", session.id);
    Ok(())
}
