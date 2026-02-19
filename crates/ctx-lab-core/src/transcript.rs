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
        if let Ok(entry) = serde_json::from_str::<serde_json::Value>(&line) {
            let role = entry.get("role").and_then(|r| r.as_str()).unwrap_or("");
            let msg_type = entry.get("type").and_then(|t| t.as_str()).unwrap_or("");
            match (role, msg_type) {
                ("user", _) => {
                    if let Some(text) = extract_text(&entry) {
                        highlights.user_messages.push(text.chars().take(200).collect());
                    }
                }
                ("assistant", "text") => {
                    if let Some(text) = extract_text(&entry) {
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
            message_count += 1;
            if message_count >= max_messages { break; }
        }
    }
    Ok(highlights)
}

fn extract_text(entry: &serde_json::Value) -> Option<String> {
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
        let lines = vec![
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
        let lines = vec![
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
}
