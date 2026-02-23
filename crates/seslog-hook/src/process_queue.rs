use anyhow::Result;

pub fn run() -> Result<()> {
    eprintln!("[seslog] Processing queue...");
    let processed = seslog_core::queue::process_all(handle_queue_item)?;
    eprintln!("[seslog] Processed {} queue items", processed);
    Ok(())
}

/// Dispatch a queue item to the appropriate handler based on the `event` field.
///
/// Called by `seslog_core::queue::process_all` for each queued JSON file.
fn handle_queue_item(_event_name: &str, payload: serde_json::Value) -> Result<()> {
    dispatch_event(&payload)
}

/// Extract the `event` field from a queue payload and dispatch to the matching handler.
///
/// Exposed as a testable function separate from the `process_all` callback.
pub fn dispatch_event(payload: &serde_json::Value) -> Result<()> {
    let event = payload
        .get("event")
        .and_then(|e| e.as_str())
        .unwrap_or("unknown");
    match event {
        "checkpoint" => process_checkpoint(payload.clone()),
        "stop" => process_stop(payload.clone()),
        "session_end_enrich" => process_session_enrichment(payload.clone()),
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
    let slug = crate::utils::project_slug_from_cwd(cwd);
    let checkpoints_dir = base.join("projects").join(&slug).join("checkpoints");
    std::fs::create_dir_all(&checkpoints_dir)?;

    let now = chrono::Utc::now();
    let chk_id = format!("chk_{}", &uuid::Uuid::new_v4().to_string()[..8]);

    let checkpoint = seslog_core::models::Checkpoint {
        schema_version: seslog_core::models::SCHEMA_VERSION,
        id: chk_id.clone(),
        session_id: format!("ses_{}", session_id),
        project_id: crate::utils::read_project_id(&slug),
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

    // Token count and cost estimation
    let total_tokens = highlights.total_input_tokens + highlights.total_output_tokens;
    if total_tokens > 0 {
        session.token_count = Some(total_tokens);
        session.estimated_cost_usd = Some(
            seslog_core::transcript::estimate_cost_usd(
                highlights.total_input_tokens,
                highlights.total_output_tokens,
                highlights.model.as_deref(),
            )
        );
    }
    session.model = highlights.model.clone();

    session.tools_used = highlights.tools_used;
    session.transcript_highlights = highlights.user_messages;

    // Manual summary (from `seslog summary`) takes priority
    if session.summary_source != Some(seslog_core::models::SummarySource::Manual)
        && !transcript_summary.what_was_done.is_empty()
    {
        session.summary = transcript_summary.what_was_done;
        session.summary_source = Some(seslog_core::models::SummarySource::TranscriptGit);
    }
    // else: keep existing summary (e.g. git diff fallback or manual)
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
    let slug = crate::utils::project_slug_from_cwd(cwd);
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
    if let Err(e) = seslog_core::claude_md::update_claude_md(std::path::Path::new(cwd), &block) {
        eprintln!("[seslog] WARN: update_claude_md failed: {}", e);
    }

    seslog_core::storage::write_json(session_path, &session)?;
    eprintln!("[seslog] Session enriched: {}", session.id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dispatch_stop_event() {
        let payload = serde_json::json!({
            "event": "stop",
            "session_id": "abc-123",
            "transcript_path": "/tmp/t.jsonl",
            "timestamp": "2026-01-01T00:00:00Z"
        });
        // process_stop just prints and returns Ok
        let result = dispatch_event(&payload);
        assert!(result.is_ok());
    }

    #[test]
    fn test_dispatch_unknown_event() {
        let payload = serde_json::json!({
            "event": "some_future_event",
            "session_id": "abc"
        });
        // Unknown events are logged but not an error
        let result = dispatch_event(&payload);
        assert!(result.is_ok());
    }

    #[test]
    fn test_dispatch_missing_event_field() {
        let payload = serde_json::json!({
            "session_id": "abc"
        });
        // Missing event => "unknown" => handled gracefully
        let result = dispatch_event(&payload);
        assert!(result.is_ok());
    }

    #[test]
    fn test_dispatch_enrichment_missing_session_file() {
        let payload = serde_json::json!({
            "event": "session_end_enrich",
            "session_id": "abc"
        });
        // Missing session_file field causes an error
        let result = dispatch_event(&payload);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("missing session_file"));
    }
}
