use anyhow::Result;
use std::io::Read;

pub fn run() -> Result<()> {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    let payload: seslog_core::models::SessionEndPayload = serde_json::from_str(&input)?;

    let base = seslog_core::storage::seslog_dir()?;
    let slug = crate::session_start::project_slug_from_cwd(&payload.cwd);
    let project_dir = base.join("projects").join(&slug);
    let sessions_dir = project_dir.join("sessions");
    std::fs::create_dir_all(&sessions_dir)?;

    let hostname = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "unknown".into());
    let now = chrono::Utc::now();

    // Quick git stats
    let cwd_path = std::path::Path::new(&payload.cwd);
    let diff_stat = seslog_core::git_ops::diff_stat(cwd_path).unwrap_or(None);
    let commits = seslog_core::git_ops::recent_commits(cwd_path, 3).unwrap_or_default();

    // Minimal session JSON
    let session = seslog_core::models::Session {
        schema_version: seslog_core::models::SCHEMA_VERSION,
        id: format!("ses_{}", &payload.session_id),
        project_id: crate::session_start::read_project_id(&slug),
        machine: hostname,
        started_at: now,
        ended_at: Some(now),
        duration_minutes: None,
        end_reason: payload.reason.clone(),
        summary: diff_stat.unwrap_or_else(|| "Session ended".into()),
        summary_source: "minimal".into(),
        transcript_highlights: vec![],
        roadmap_changes: vec![],
        decisions: vec![],
        next_steps: String::new(),
        tags: vec![],
        tools_used: vec![],
        files_changed: 0,
        git_commits: commits,
        checkpoints_merged: vec![],
        recovered: false,
        redaction_count: 0,
    };

    let session_file = sessions_dir.join(format!(
        "{}_{}_{}.json",
        now.format("%Y%m%d"),
        session.machine,
        &payload.session_id
    ));
    seslog_core::storage::write_json(&session_file, &session)?;

    // Emit event via shared bridge
    crate::event_bridge::emit_event("session_ended", &payload.session_id, &slug).ok();

    // Enqueue enrichment
    let queue_payload = serde_json::json!({
        "event": "session_end_enrich",
        "session_id": payload.session_id,
        "session_file": session_file.to_string_lossy(),
        "cwd": payload.cwd,
        "transcript_path": payload.transcript_path,
        "timestamp": now.to_rfc3339(),
    });
    seslog_core::queue::enqueue("session_end_enrich", &payload.session_id, &queue_payload)?;

    // Git-based sync: commit + push
    let short_summary: String = session.summary.chars().take(50).collect();
    let commit_msg = format!("session: {} — {}", slug, short_summary);
    match seslog_core::git_ops::sync_push(&base, &commit_msg) {
        Ok(seslog_core::git_ops::SyncResult::Synced) => eprintln!("[seslog] Pushed to remote"),
        Ok(seslog_core::git_ops::SyncResult::Offline(e)) => eprintln!("[seslog] Push skipped: {}", e),
        Ok(_) => {}
        Err(e) => eprintln!("[seslog] Sync push error: {}", e),
    }

    Ok(())
}
