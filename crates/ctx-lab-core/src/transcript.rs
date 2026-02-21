use anyhow::Result;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::Path;

pub struct TranscriptHighlights {
    pub user_messages: Vec<String>,
    pub assistant_summaries: Vec<String>,
    pub tools_used: Vec<String>,
}

pub trait TranscriptSource {
    fn extract_highlights(&self, max_messages: usize, max_bytes: usize) -> Result<TranscriptHighlights>;
}

pub struct JsonlTranscriptSource<'a> {
    pub path: &'a Path,
}

pub struct GitDiffFallback<'a> {
    pub cwd: &'a Path,
}

/// Smart selector: try JSONL first, fallback to git diff
pub fn extract_highlights(transcript_path: &Path, cwd: &Path, max_messages: usize, max_bytes: usize) -> TranscriptHighlights {
    let jsonl = JsonlTranscriptSource { path: transcript_path };
    match jsonl.extract_highlights(max_messages, max_bytes) {
        Ok(h) if !h.user_messages.is_empty() || !h.tools_used.is_empty() || !h.assistant_summaries.is_empty() => return h,
        Ok(_) | Err(_) => {
            eprintln!("[ctx-lab] WARN: transcript parse failed, falling back to git diff");
        }
    }
    let fallback = GitDiffFallback { cwd };
    fallback.extract_highlights(max_messages, max_bytes)
        .unwrap_or_else(|_| TranscriptHighlights {
            user_messages: vec![],
            assistant_summaries: vec!["(transcript unavailable)".into()],
            tools_used: vec![],
        })
}

impl<'a> TranscriptSource for JsonlTranscriptSource<'a> {
    fn extract_highlights(&self, max_messages: usize, max_bytes: usize) -> Result<TranscriptHighlights> {
        parse_jsonl(self.path, max_messages, max_bytes)
    }
}

impl<'a> TranscriptSource for GitDiffFallback<'a> {
    fn extract_highlights(&self, _max_messages: usize, _max_bytes: usize) -> Result<TranscriptHighlights> {
        let commits = crate::git_ops::recent_commits(self.cwd, 5).unwrap_or_default();
        let diff = crate::git_ops::diff_stat(self.cwd).unwrap_or(None);
        let mut summaries = Vec::new();
        if let Some(d) = diff {
            summaries.push(format!("Changes: {}", d));
        }
        for c in &commits {
            summaries.push(c.clone());
        }
        if summaries.is_empty() {
            summaries.push("(no git activity found)".into());
        }
        Ok(TranscriptHighlights {
            user_messages: vec![],
            assistant_summaries: summaries,
            tools_used: vec![],
        })
    }
}

fn parse_jsonl(path: &Path, max_messages: usize, max_bytes: usize) -> Result<TranscriptHighlights> {
    let file = std::fs::File::open(path)?;
    let file_size = file.metadata()?.len();
    let reader = if file_size > max_bytes as u64 {
        let mut f = file;
        f.seek(SeekFrom::End(-(max_bytes as i64)))?;
        let mut reader = BufReader::new(f);
        let mut _discard = String::new();
        reader.read_line(&mut _discard)?;
        reader
    } else {
        BufReader::new(file)
    };

    let mut highlights = TranscriptHighlights {
        user_messages: Vec::new(),
        assistant_summaries: Vec::new(),
        tools_used: Vec::new(),
    };
    let mut message_count = 0;
    for line in reader.lines() {
        let line = line?;
        if line.trim().is_empty() { continue; }
        let entry = match serde_json::from_str::<serde_json::Value>(&line) {
            Ok(e) => e,
            Err(_) => continue,
        };

        let top_type = entry.get("type").and_then(|t| t.as_str()).unwrap_or("");

        // Skip non-conversation entries (progress, system, file snapshots, queue ops)
        match top_type {
            "progress" | "system" | "file-history-snapshot" | "queue-operation" => continue,
            _ => {}
        }

        // Skip entries with isMeta: true
        if entry.get("isMeta").and_then(|v| v.as_bool()).unwrap_or(false) {
            continue;
        }

        // Try real Claude Code format first: top-level "type" is "user"/"assistant",
        // actual content is inside "message" object with "role" and "content" fields.
        if let Some(message_obj) = entry.get("message").and_then(|m| m.as_object()) {
            let role = message_obj.get("role").and_then(|r| r.as_str()).unwrap_or("");
            let content = message_obj.get("content");

            match role {
                "user" => {
                    // String content = real user message; array = tool_results (skip)
                    if let Some(content_val) = content {
                        if let Some(text) = content_val.as_str() {
                            if !is_command_content(text) {
                                highlights.user_messages.push(text.chars().take(200).collect());
                            }
                        }
                        // Array content with tool_result entries: skip (not real user messages)
                    }
                }
                "assistant" => {
                    if let Some(arr) = content.and_then(|c| c.as_array()) {
                        for item in arr {
                            let item_type = item.get("type").and_then(|t| t.as_str()).unwrap_or("");
                            match item_type {
                                "text" => {
                                    if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                                        let first_sentence = text.split('.').next().unwrap_or(text);
                                        highlights.assistant_summaries.push(
                                            first_sentence.chars().take(200).collect()
                                        );
                                    }
                                }
                                "tool_use" => {
                                    if let Some(name) = item.get("name").and_then(|n| n.as_str()) {
                                        if !highlights.tools_used.contains(&name.to_string()) {
                                            highlights.tools_used.push(name.to_string());
                                        }
                                    }
                                }
                                // Skip "thinking" blocks and other types
                                _ => {}
                            }
                        }
                    }
                }
                _ => {}
            }
        } else {
            // Backward compat: flat format (role/type/message at top level)
            let role = entry.get("role").and_then(|r| r.as_str()).unwrap_or("");
            let msg_type = entry.get("type").and_then(|t| t.as_str()).unwrap_or("");
            match (role, msg_type) {
                ("user", _) => {
                    if let Some(text) = extract_text_flat(&entry) {
                        if !is_command_content(&text) {
                            highlights.user_messages.push(text.chars().take(200).collect());
                        }
                    }
                }
                ("assistant", "text") => {
                    if let Some(text) = extract_text_flat(&entry) {
                        let first = text.split('.').next().unwrap_or(&text);
                        highlights.assistant_summaries.push(first.chars().take(200).collect());
                    }
                }
                ("assistant", "tool_use") => {
                    if let Some(name) = entry.get("name").and_then(|n| n.as_str()) {
                        if !highlights.tools_used.contains(&name.to_string()) {
                            highlights.tools_used.push(name.to_string());
                        }
                    }
                }
                _ => {}
            }
        }

        message_count += 1;
        if message_count >= max_messages { break; }
    }
    Ok(highlights)
}

/// Check if user message content is a command (not a real user message)
fn is_command_content(text: &str) -> bool {
    text.contains("<command-name>") || text.contains("<local-command>")
}

/// Extract text from flat format entries (backward compat)
fn extract_text_flat(entry: &serde_json::Value) -> Option<String> {
    entry.get("message")
        .or_else(|| entry.get("content"))
        .and_then(|c| {
            if let Some(s) = c.as_str() {
                Some(s.to_string())
            } else if let Some(arr) = c.as_array() {
                Some(arr.iter()
                    .filter_map(|item| item.get("text").and_then(|t| t.as_str()))
                    .collect::<Vec<_>>().join(" "))
            } else { None }
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write_sample_transcript(dir: &Path) -> std::path::PathBuf {
        let path = dir.join("transcript.jsonl");
        let lines = [
            r#"{"role":"user","type":"text","message":"Fix the login bug"}"#,
            r#"{"role":"assistant","type":"text","message":"I'll fix the login bug. The issue is in auth.rs."}"#,
            r#"{"role":"assistant","type":"tool_use","name":"Read","input":{}}"#,
            r#"{"role":"user","type":"text","message":"Now add tests"}"#,
            r#"{"role":"assistant","type":"tool_use","name":"Write","input":{}}"#,
            r#"{"role":"assistant","type":"text","message":"Tests added and passing."}"#,
        ];
        std::fs::write(&path, lines.join("\n")).unwrap();
        path
    }

    #[test]
    fn test_parse_jsonl_extracts_user_messages() {
        let tmp = TempDir::new().unwrap();
        let path = write_sample_transcript(tmp.path());
        let highlights = extract_highlights(&path, tmp.path(), 100, 100_000);
        assert_eq!(highlights.user_messages.len(), 2);
        assert!(highlights.user_messages[0].contains("Fix the login bug"));
    }

    #[test]
    fn test_parse_jsonl_extracts_tools() {
        let tmp = TempDir::new().unwrap();
        let path = write_sample_transcript(tmp.path());
        let highlights = extract_highlights(&path, tmp.path(), 100, 100_000);
        assert!(highlights.tools_used.contains(&"Read".to_string()));
        assert!(highlights.tools_used.contains(&"Write".to_string()));
    }

    #[test]
    fn test_parse_jsonl_no_duplicate_tools() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("transcript.jsonl");
        let lines = [
            r#"{"role":"assistant","type":"tool_use","name":"Read","input":{}}"#,
            r#"{"role":"assistant","type":"tool_use","name":"Read","input":{}}"#,
        ];
        std::fs::write(&path, lines.join("\n")).unwrap();
        let highlights = extract_highlights(&path, tmp.path(), 100, 100_000);
        assert_eq!(highlights.tools_used.len(), 1);
    }

    #[test]
    fn test_missing_transcript_returns_fallback() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("nonexistent.jsonl");
        let highlights = extract_highlights(&path, tmp.path(), 100, 100_000);
        assert!(highlights.user_messages.is_empty() ||
            highlights.assistant_summaries.iter().any(|s| s.contains("unavailable")));
    }

    #[test]
    fn test_max_messages_limit() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("transcript.jsonl");
        let mut lines = Vec::new();
        for i in 0..50 {
            lines.push(format!(r#"{{"role":"user","type":"text","message":"msg {}"}}"#, i));
        }
        std::fs::write(&path, lines.join("\n")).unwrap();
        let highlights = extract_highlights(&path, tmp.path(), 5, 100_000);
        assert!(highlights.user_messages.len() <= 5);
    }

    // --- Tests for real Claude Code JSONL format ---

    fn fixture_path(name: &str) -> std::path::PathBuf {
        let mut p = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        p.pop(); // crates/
        p.pop(); // workspace root
        p.push("tests/fixtures/transcripts");
        p.push(name);
        p
    }

    #[test]
    fn test_parse_real_claude_code_format() {
        let path = fixture_path("real_claude_code.jsonl");
        assert!(path.exists(), "fixture file missing: {:?}", path);
        let highlights = parse_jsonl(&path, 500, 1_000_000).unwrap();

        // Should extract real user messages (not tool_result arrays, not isMeta)
        assert!(
            highlights.user_messages.iter().any(|m| m.contains("Fix the authentication bug")),
            "expected user message about auth bug, got: {:?}", highlights.user_messages
        );
        assert!(
            highlights.user_messages.iter().any(|m| m.contains("rate limiter")),
            "expected user message about rate limiter, got: {:?}", highlights.user_messages
        );

        // Should extract tools used
        assert!(
            highlights.tools_used.contains(&"Read".to_string()),
            "expected Read in tools_used, got: {:?}", highlights.tools_used
        );
        assert!(
            highlights.tools_used.contains(&"Edit".to_string()),
            "expected Edit in tools_used, got: {:?}", highlights.tools_used
        );
        assert!(
            highlights.tools_used.contains(&"Bash".to_string()),
            "expected Bash in tools_used, got: {:?}", highlights.tools_used
        );
        assert!(
            highlights.tools_used.contains(&"Write".to_string()),
            "expected Write in tools_used, got: {:?}", highlights.tools_used
        );

        // Should extract assistant text summaries
        assert!(
            !highlights.assistant_summaries.is_empty(),
            "expected assistant summaries, got none"
        );
        assert!(
            highlights.assistant_summaries.iter().any(|s| s.contains("authentication bug")),
            "expected summary about auth bug, got: {:?}", highlights.assistant_summaries
        );
    }

    #[test]
    fn test_skip_progress_and_system_entries() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("transcript.jsonl");
        let lines = [
            r#"{"type":"system","subtype":"init","content":"System prompt","isMeta":true}"#,
            r#"{"type":"progress","content":{"tool":"Read","status":"running"},"isMeta":true}"#,
            r#"{"type":"progress","content":{"tool":"Read","status":"completed"},"isMeta":true}"#,
            r#"{"type":"file-history-snapshot","content":{"path":"foo.rs","snapshot":"..."}}"#,
            r#"{"type":"queue-operation","content":{"operation":"hook-fired"}}"#,
            r#"{"type":"user","message":{"role":"user","content":"Real user message"}}"#,
        ];
        std::fs::write(&path, lines.join("\n")).unwrap();
        let highlights = parse_jsonl(&path, 500, 1_000_000).unwrap();

        // Only the real user message should be extracted
        assert_eq!(
            highlights.user_messages.len(), 1,
            "expected 1 user message, got: {:?}", highlights.user_messages
        );
        assert!(highlights.user_messages[0].contains("Real user message"));

        // No tools, no summaries from progress/system entries
        assert!(highlights.tools_used.is_empty(), "expected no tools, got: {:?}", highlights.tools_used);
        assert!(highlights.assistant_summaries.is_empty(), "expected no summaries, got: {:?}", highlights.assistant_summaries);
    }

    #[test]
    fn test_skip_tool_result_user_messages() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("transcript.jsonl");
        let lines = [
            r#"{"type":"user","message":{"role":"user","content":"Real question from human"}}"#,
            r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_01","content":"file contents here"}]}}"#,
            r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_02","content":"edit applied"}]}}"#,
            r#"{"type":"user","message":{"role":"user","content":"Another real question"}}"#,
        ];
        std::fs::write(&path, lines.join("\n")).unwrap();
        let highlights = parse_jsonl(&path, 500, 1_000_000).unwrap();

        // Only string content user messages, not tool_result arrays
        assert_eq!(
            highlights.user_messages.len(), 2,
            "expected 2 real user messages, got: {:?}", highlights.user_messages
        );
        assert!(highlights.user_messages[0].contains("Real question from human"));
        assert!(highlights.user_messages[1].contains("Another real question"));
    }

    #[test]
    fn test_backward_compat_flat_format() {
        // The old flat format must still work
        let tmp = TempDir::new().unwrap();
        let path = write_sample_transcript(tmp.path());
        let highlights = parse_jsonl(&path, 100, 100_000).unwrap();

        assert_eq!(highlights.user_messages.len(), 2, "expected 2 user messages from flat format");
        assert!(highlights.user_messages[0].contains("Fix the login bug"));
        assert!(highlights.user_messages[1].contains("Now add tests"));

        assert!(highlights.tools_used.contains(&"Read".to_string()));
        assert!(highlights.tools_used.contains(&"Write".to_string()));

        assert!(!highlights.assistant_summaries.is_empty(), "expected assistant summaries from flat format");
    }

    #[test]
    fn test_filter_ismeta_user_messages() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("transcript.jsonl");
        let lines = [
            r#"{"type":"user","message":{"role":"user","content":"Real message"},"isMeta":false}"#,
            r#"{"type":"user","message":{"role":"user","content":"<command-name>commit</command-name>"},"isMeta":true}"#,
            r#"{"type":"user","message":{"role":"user","content":"<local-command>/help</local-command>"},"isMeta":true}"#,
            r#"{"type":"system","subtype":"command","content":"<command-name>commit</command-name>","isMeta":true}"#,
        ];
        std::fs::write(&path, lines.join("\n")).unwrap();
        let highlights = parse_jsonl(&path, 500, 1_000_000).unwrap();

        assert_eq!(
            highlights.user_messages.len(), 1,
            "expected only 1 non-meta user message, got: {:?}", highlights.user_messages
        );
        assert!(highlights.user_messages[0].contains("Real message"));
    }

    #[test]
    fn test_filter_command_name_content() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("transcript.jsonl");
        let lines = [
            r#"{"type":"user","message":{"role":"user","content":"<command-name>review-pr</command-name>"}}"#,
            r#"{"type":"user","message":{"role":"user","content":"<local-command>/clear</local-command>"}}"#,
            r#"{"type":"user","message":{"role":"user","content":"Please review the PR"}}"#,
        ];
        std::fs::write(&path, lines.join("\n")).unwrap();
        let highlights = parse_jsonl(&path, 500, 1_000_000).unwrap();

        assert_eq!(
            highlights.user_messages.len(), 1,
            "expected 1 real user message (commands filtered), got: {:?}", highlights.user_messages
        );
        assert!(highlights.user_messages[0].contains("review the PR"));
    }
}
