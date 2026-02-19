# ctx-lab Faz A: Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the `ctx-lab-core` library and `ctx-lab-hook` binary that automatically tracks Claude Code sessions, writes atomic JSON logs, and injects context via additionalContext + CLAUDE.md.

**Architecture:** Cargo workspace with two crates: `ctx-lab-core` (shared library with models, storage, parsers) and `ctx-lab-hook` (fire-and-forget CLI binary with clap subcommands). All file writes are atomic (tmp→fsync→rename). Heavy work is queued; only SessionStart is synchronous.

**Tech Stack:** Rust 2021, serde, clap, git2, chrono, uuid, toml, regex, tempfile (dev)

**Spec reference:** `docs/plans/ctx-lab-faz-a.md` (full design spec), `docs/plans/ctx-lab-overview.md` (architecture decisions)

---

## Pre-requisites

Before starting, ensure:
- macOS with Homebrew
- ~2GB disk space for Rust toolchain

---

### Task 0: Rust Toolchain + Git Init

**Files:**
- Create: `.gitignore`
- Create: `README.md`

**Step 1: Install Rust toolchain**

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustc --version  # Expected: rustc 1.8x.x
cargo --version  # Expected: cargo 1.8x.x
```

**Step 2: Initialize git repo**

```bash
git init
```

**Step 3: Create .gitignore**

```gitignore
/target
*.db
*.db-*
.DS_Store
```

**Step 4: Create README.md**

```markdown
# ctx-lab

Automatic session tracking and context management for Claude Code.

## Status

Phase A: Core Library + Hook Binary (in progress)
```

**Step 5: Commit**

```bash
git add .gitignore README.md
git commit -m "chore: init repo with gitignore and readme"
```

---

### Task 1: Cargo Workspace Scaffolding

**Files:**
- Create: `Cargo.toml` (workspace root)
- Create: `crates/ctx-lab-core/Cargo.toml`
- Create: `crates/ctx-lab-core/src/lib.rs`
- Create: `crates/ctx-lab-hook/Cargo.toml`
- Create: `crates/ctx-lab-hook/src/main.rs`

**Step 1: Create workspace root Cargo.toml**

```toml
[workspace]
members = ["crates/ctx-lab-core", "crates/ctx-lab-hook"]
resolver = "2"

[workspace.dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
chrono = { version = "0.4", features = ["serde"] }
uuid = { version = "1", features = ["v4", "serde"] }
toml = "0.8"
git2 = "0.19"
anyhow = "1"
thiserror = "2"
clap = { version = "4", features = ["derive"] }
fd-lock = "4"
dirs = "6"
regex = "1"
once_cell = "1"
tempfile = "3"
```

**Step 2: Create ctx-lab-core/Cargo.toml**

```toml
[package]
name = "ctx-lab-core"
version = "0.1.0"
edition = "2021"

[dependencies]
serde.workspace = true
serde_json.workspace = true
chrono.workspace = true
uuid.workspace = true
toml.workspace = true
git2.workspace = true
anyhow.workspace = true
thiserror.workspace = true
fd-lock.workspace = true
dirs.workspace = true
regex.workspace = true
once_cell.workspace = true

[dev-dependencies]
tempfile.workspace = true
```

**Step 3: Create ctx-lab-core/src/lib.rs**

```rust
pub mod errors;
pub mod models;
pub mod schema;
pub mod storage;
pub mod config;
pub mod queue;
pub mod sanitize;
pub mod roadmap;
pub mod claude_md;
pub mod git_ops;
pub mod transcript;
```

**Step 4: Create stub modules in ctx-lab-core/src/**

Create each file with a placeholder comment:
- `errors.rs` → `// ctx-lab error types`
- `models.rs` → `// ctx-lab data models`
- `schema.rs` → `// schema versioning`
- `storage.rs` → `// atomic write + dir management`
- `config.rs` → `// TOML config`
- `queue.rs` → `// fire-and-forget queue`
- `sanitize.rs` → `// secret redaction`
- `roadmap.rs` → `// roadmap markdown parser`
- `claude_md.rs` → `// CLAUDE.md injection`
- `git_ops.rs` → `// git operations`
- `transcript.rs` → `// transcript parser`

**Step 5: Create ctx-lab-hook/Cargo.toml**

```toml
[package]
name = "ctx-lab-hook"
version = "0.1.0"
edition = "2021"

[dependencies]
ctx-lab-core = { path = "../ctx-lab-core" }
clap.workspace = true
serde.workspace = true
serde_json.workspace = true
anyhow.workspace = true
chrono.workspace = true
uuid.workspace = true
```

**Step 6: Create ctx-lab-hook/src/main.rs**

```rust
fn main() {
    println!("ctx-lab-hook placeholder");
}
```

**Step 7: Verify build**

```bash
cargo build
```

Expected: Compiles successfully with no errors.

**Step 8: Commit**

```bash
git add Cargo.toml Cargo.lock crates/
git commit -m "chore: scaffold cargo workspace with core and hook crates"
```

---

### Task 2: Error Types (errors.rs)

**Files:**
- Modify: `crates/ctx-lab-core/src/errors.rs`

**Step 1: Write the test**

Add to `errors.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_storage_error_display() {
        let err = CtxLabError::Storage("disk full".into());
        assert!(err.to_string().contains("disk full"));
    }

    #[test]
    fn test_parse_error_display() {
        let err = CtxLabError::Parse("invalid json".into());
        assert!(err.to_string().contains("invalid json"));
    }

    #[test]
    fn test_config_error_display() {
        let err = CtxLabError::Config("missing field".into());
        assert!(err.to_string().contains("missing field"));
    }
}
```

**Step 2: Run test to verify it fails**

```bash
cargo test -p ctx-lab-core -- errors
```

Expected: FAIL (CtxLabError not defined)

**Step 3: Implement error types**

```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CtxLabError {
    #[error("storage error: {0}")]
    Storage(String),

    #[error("parse error: {0}")]
    Parse(String),

    #[error("config error: {0}")]
    Config(String),

    #[error("hook error: {0}")]
    Hook(String),

    #[error("git error: {0}")]
    Git(String),

    #[error("schema migration needed: found v{found}, expected v{expected}")]
    SchemaMismatch { found: u32, expected: u32 },

    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error(transparent)]
    Json(#[from] serde_json::Error),

    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

pub type Result<T> = std::result::Result<T, CtxLabError>;
```

**Step 4: Run test to verify it passes**

```bash
cargo test -p ctx-lab-core -- errors
```

Expected: 3 tests PASS

**Step 5: Commit**

```bash
git add crates/ctx-lab-core/src/errors.rs
git commit -m "feat(core): add error types with thiserror"
```

---

### Task 3: Data Models (models.rs)

**Files:**
- Modify: `crates/ctx-lab-core/src/models.rs`

**Step 1: Write the tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_serialize_roundtrip() {
        let session = Session {
            schema_version: SCHEMA_VERSION,
            id: "ses_abc123".into(),
            project_id: "proj_test".into(),
            machine: "macbook".into(),
            started_at: chrono::Utc::now(),
            ended_at: None,
            duration_minutes: None,
            end_reason: None,
            summary: "test session".into(),
            summary_source: "transcript+git".into(),
            transcript_highlights: vec![],
            roadmap_changes: vec![],
            decisions: vec![],
            next_steps: String::new(),
            tags: vec![],
            tools_used: vec![],
            files_changed: 0,
            git_commits: vec![],
            checkpoints_merged: vec![],
            recovered: false,
            redaction_count: 0,
        };
        let json = serde_json::to_string(&session).unwrap();
        let parsed: Session = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.id, "ses_abc123");
        assert_eq!(parsed.schema_version, SCHEMA_VERSION);
    }

    #[test]
    fn test_session_forward_compat_ignores_unknown_fields() {
        let json = r#"{
            "schema_version": 1,
            "id": "ses_x",
            "project_id": "proj_x",
            "machine": "m",
            "started_at": "2026-01-01T00:00:00Z",
            "summary": "s",
            "summary_source": "git_only",
            "future_field": "should be ignored"
        }"#;
        let session: Session = serde_json::from_str(json).unwrap();
        assert_eq!(session.id, "ses_x");
    }

    #[test]
    fn test_session_missing_optional_fields_use_defaults() {
        let json = r#"{
            "schema_version": 1,
            "id": "ses_y",
            "project_id": "proj_y",
            "machine": "m",
            "started_at": "2026-01-01T00:00:00Z",
            "summary": "s",
            "summary_source": "git_only"
        }"#;
        let session: Session = serde_json::from_str(json).unwrap();
        assert!(session.transcript_highlights.is_empty());
        assert!(!session.recovered);
        assert_eq!(session.files_changed, 0);
    }

    #[test]
    fn test_checkpoint_serialize_roundtrip() {
        let cp = Checkpoint {
            schema_version: SCHEMA_VERSION,
            id: "chk_abc".into(),
            session_id: "ses_abc".into(),
            project_id: "proj_x".into(),
            machine: "mac".into(),
            timestamp: chrono::Utc::now(),
            git_diff_stat: Some("+10 -5 across 3 files".into()),
            files_changed: vec!["src/main.rs".into()],
            recent_commits: vec![],
            source: "postToolUse_debounced".into(),
        };
        let json = serde_json::to_string(&cp).unwrap();
        let parsed: Checkpoint = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.id, "chk_abc");
    }

    #[test]
    fn test_hook_payload_parse_session_start() {
        let json = r#"{
            "session_id": "abc-123",
            "transcript_path": "/tmp/transcript.jsonl",
            "cwd": "/home/user/project"
        }"#;
        let payload: SessionStartPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.session_id, "abc-123");
        assert_eq!(payload.cwd, "/home/user/project");
    }

    #[test]
    fn test_session_start_output_format() {
        let output = SessionStartOutput {
            hook_specific_output: HookSpecificOutput {
                hook_event_name: "SessionStart".into(),
                additional_context: "test context".into(),
            },
        };
        let json = serde_json::to_string(&output).unwrap();
        assert!(json.contains("hookSpecificOutput"));
        assert!(json.contains("hookEventName"));
        assert!(json.contains("additionalContext"));
    }
}
```

**Step 2: Run tests to verify they fail**

```bash
cargo test -p ctx-lab-core -- models
```

Expected: FAIL (types not defined)

**Step 3: Implement all model structs**

Write all structs from the spec (Section 3.2 + 3.3 of faz-a.md). Key points:
- `SCHEMA_VERSION` constant = 1
- All optional/collection fields have `#[serde(default)]`
- No `deny_unknown_fields` (forward compat)
- Hook payloads: `SessionStartPayload`, `PostToolUsePayload`, `StopPayload`, `SessionEndPayload`
- Hook output: `SessionStartOutput`, `HookSpecificOutput`
- Project: `ProjectMeta`, `ProjectInfo`
- Machine: `MachineProfile`
- Config: `AppConfig` with default functions

Full implementation is in spec Section 3.2 and 3.3. Copy verbatim and ensure all `use` imports are correct.

**Step 4: Run tests to verify they pass**

```bash
cargo test -p ctx-lab-core -- models
```

Expected: 6 tests PASS

**Step 5: Commit**

```bash
git add crates/ctx-lab-core/src/models.rs
git commit -m "feat(core): add all data models with serde and schema versioning"
```

---

### Task 4: Schema Versioning (schema.rs)

**Files:**
- Modify: `crates/ctx-lab-core/src/schema.rs`

**Step 1: Write the test**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_version_current_is_ok() {
        assert!(check_version(crate::models::SCHEMA_VERSION).is_ok());
    }

    #[test]
    fn test_check_version_old_returns_migration_needed() {
        // Version 0 should trigger migration (or at least not panic)
        let result = check_version(0);
        assert!(result.is_ok()); // v1 just logs warning, doesn't fail
    }

    #[test]
    fn test_check_version_future_is_ok() {
        // Future versions should be tolerated (forward compat)
        assert!(check_version(999).is_ok());
    }
}
```

**Step 2: Run tests to verify they fail**

```bash
cargo test -p ctx-lab-core -- schema
```

**Step 3: Implement**

```rust
use crate::models::SCHEMA_VERSION;
use anyhow::Result;

/// Check schema version compatibility.
/// - Current version: pass through
/// - Older version: log warning, attempt migration (v1: no-op)
/// - Future version: tolerate (forward compat)
pub fn check_version(found: u32) -> Result<()> {
    if found < SCHEMA_VERSION {
        eprintln!(
            "[ctx-lab] WARN: schema v{} found, current is v{}. Migration may be needed.",
            found, SCHEMA_VERSION
        );
        migrate(found, SCHEMA_VERSION)?;
    } else if found > SCHEMA_VERSION {
        eprintln!(
            "[ctx-lab] INFO: schema v{} found (newer than v{}). Forward-compatible mode.",
            found, SCHEMA_VERSION
        );
    }
    Ok(())
}

/// Migrate from one schema version to another.
/// v1: no migrations exist yet — this is a placeholder.
fn migrate(from: u32, to: u32) -> Result<()> {
    eprintln!("[ctx-lab] INFO: migration v{} → v{} (no-op for now)", from, to);
    Ok(())
}
```

**Step 4: Run tests**

```bash
cargo test -p ctx-lab-core -- schema
```

Expected: 3 tests PASS

**Step 5: Commit**

```bash
git add crates/ctx-lab-core/src/schema.rs
git commit -m "feat(core): add schema version check with forward compatibility"
```

---

### Task 5: Atomic Write + Storage (storage.rs)

**Files:**
- Modify: `crates/ctx-lab-core/src/storage.rs`

**Step 1: Write the tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use std::fs;

    #[test]
    fn test_atomic_write_creates_file() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("test.json");
        atomic_write(&path, b"hello").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "hello");
    }

    #[test]
    fn test_atomic_write_no_tmp_file_left() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("test.json");
        atomic_write(&path, b"data").unwrap();
        let tmp_path = path.with_extension("tmp");
        assert!(!tmp_path.exists());
    }

    #[test]
    fn test_write_json_pretty_format() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("test.json");
        let data = serde_json::json!({"key": "value"});
        write_json(&path, &data).unwrap();
        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("  \"key\"")); // pretty-printed
    }

    #[test]
    fn test_safe_read_json_valid() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("test.json");
        fs::write(&path, r#"{"key":"value"}"#).unwrap();
        let result: Option<serde_json::Value> = safe_read_json(&path).unwrap();
        assert!(result.is_some());
        assert_eq!(result.unwrap()["key"], "value");
    }

    #[test]
    fn test_safe_read_json_missing_file() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("nonexistent.json");
        let result: Option<serde_json::Value> = safe_read_json(&path).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_safe_read_json_corrupt_quarantines() {
        let tmp = TempDir::new().unwrap();
        // Create quarantine dir since we use a custom base
        let quarantine = tmp.path().join("quarantine");
        fs::create_dir_all(&quarantine).unwrap();

        let path = tmp.path().join("corrupt.json");
        fs::write(&path, "not json {{{").unwrap();

        let result: Option<serde_json::Value> =
            safe_read_json_with_quarantine(&path, &quarantine).unwrap();
        assert!(result.is_none());
        assert!(!path.exists()); // original removed
        // quarantine dir should have the file
        let entries: Vec<_> = fs::read_dir(&quarantine).unwrap().collect();
        assert_eq!(entries.len(), 1);
    }

    #[test]
    fn test_init_data_dir_creates_subdirs() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path().join(".ctx-lab");
        init_data_dir_at(&base).unwrap();
        assert!(base.join("projects").is_dir());
        assert!(base.join("machines").is_dir());
        assert!(base.join("queue").is_dir());
        assert!(base.join(".events").is_dir());
        assert!(base.join("quarantine").is_dir());
        assert!(base.join("templates").is_dir());
    }
}
```

**Step 2: Run tests to verify they fail**

```bash
cargo test -p ctx-lab-core -- storage
```

**Step 3: Implement storage.rs**

```rust
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use anyhow::Result;

/// Atomic write: tmp file → fsync → rename.
/// Prevents half-written JSON from ever appearing at the target path.
pub fn atomic_write(path: &Path, content: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp_path = path.with_extension("tmp");
    let mut file = fs::File::create(&tmp_path)?;
    file.write_all(content)?;
    file.sync_all()?;
    fs::rename(&tmp_path, path)?;
    Ok(())
}

/// JSON serialize (pretty) + atomic write.
pub fn write_json<T: serde::Serialize>(path: &Path, value: &T) -> Result<()> {
    let json = serde_json::to_string_pretty(value)?;
    atomic_write(path, json.as_bytes())
}

/// Read JSON with quarantine for corrupt files.
/// Returns Ok(None) for missing files.
/// Moves unparseable files to quarantine dir.
pub fn safe_read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<Option<T>> {
    let quarantine_dir = ctx_lab_dir()?.join("quarantine");
    safe_read_json_with_quarantine(path, &quarantine_dir)
}

/// Read JSON with explicit quarantine directory (for testing).
pub fn safe_read_json_with_quarantine<T: serde::de::DeserializeOwned>(
    path: &Path,
    quarantine_dir: &Path,
) -> Result<Option<T>> {
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };

    match serde_json::from_str::<T>(&content) {
        Ok(v) => Ok(Some(v)),
        Err(e) => {
            fs::create_dir_all(quarantine_dir)?;
            let quarantine_path = quarantine_dir.join(format!(
                "{}_{}",
                chrono::Utc::now().format("%Y%m%d_%H%M%S"),
                path.file_name().unwrap_or_default().to_string_lossy()
            ));
            fs::rename(path, &quarantine_path)?;
            eprintln!(
                "[ctx-lab] WARN: corrupt file quarantined: {:?} -> {:?}: {}",
                path, quarantine_path, e
            );
            Ok(None)
        }
    }
}

/// Returns ~/.ctx-lab/ path, creating it if needed.
pub fn ctx_lab_dir() -> Result<PathBuf> {
    let dir = dirs::home_dir()
        .ok_or_else(|| anyhow::anyhow!("HOME directory not found"))?
        .join(".ctx-lab");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Initialize data directory structure at the default location.
pub fn init_data_dir() -> Result<PathBuf> {
    let base = ctx_lab_dir()?;
    init_data_dir_at(&base)?;
    Ok(base)
}

/// Initialize data directory structure at a custom path (for testing).
pub fn init_data_dir_at(base: &Path) -> Result<()> {
    for sub in &["projects", "machines", "templates", "queue", ".events", "quarantine"] {
        fs::create_dir_all(base.join(sub))?;
    }
    Ok(())
}
```

**Step 4: Run tests**

```bash
cargo test -p ctx-lab-core -- storage
```

Expected: 7 tests PASS

**Step 5: Commit**

```bash
git add crates/ctx-lab-core/src/storage.rs
git commit -m "feat(core): add atomic write, safe JSON read with quarantine, dir init"
```

---

### Task 6: Config (config.rs)

**Files:**
- Modify: `crates/ctx-lab-core/src/config.rs`

**Step 1: Write the tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_default_config_values() {
        let cfg = AppConfig::default();
        assert_eq!(cfg.privacy_mode, "full");
        assert_eq!(cfg.checkpoint_interval_minutes, 10);
        assert_eq!(cfg.additional_context_max_chars, 1500);
        assert!(cfg.sanitize_secrets);
    }

    #[test]
    fn test_config_write_and_read() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("config.toml");
        let cfg = AppConfig::default();
        write_config(&path, &cfg).unwrap();
        let loaded = load_config(&path).unwrap();
        assert_eq!(loaded.privacy_mode, cfg.privacy_mode);
        assert_eq!(loaded.checkpoint_interval_minutes, cfg.checkpoint_interval_minutes);
    }

    #[test]
    fn test_config_missing_file_returns_default() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("nonexistent.toml");
        let cfg = load_config(&path).unwrap();
        assert_eq!(cfg.privacy_mode, "full");
    }

    #[test]
    fn test_config_partial_toml_uses_defaults() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("partial.toml");
        std::fs::write(&path, "privacy_mode = \"full\"\n").unwrap();
        let cfg = load_config(&path).unwrap();
        assert_eq!(cfg.checkpoint_interval_minutes, 10); // default
    }
}
```

**Step 2: Run tests to verify they fail**

```bash
cargo test -p ctx-lab-core -- config
```

**Step 3: Implement**

```rust
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::models::SCHEMA_VERSION;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default = "default_privacy_mode")]
    pub privacy_mode: String,
    #[serde(default = "default_checkpoint_interval")]
    pub checkpoint_interval_minutes: u32,
    #[serde(default = "default_additional_context_max")]
    pub additional_context_max_chars: u32,
    #[serde(default = "default_transcript_max_messages")]
    pub transcript_max_messages: u32,
    #[serde(default = "default_transcript_max_tokens")]
    pub transcript_max_tokens: u32,
    #[serde(default = "default_true")]
    pub sanitize_secrets: bool,
}

fn default_schema_version() -> u32 { SCHEMA_VERSION }
fn default_privacy_mode() -> String { "full".into() }
fn default_checkpoint_interval() -> u32 { 10 }
fn default_additional_context_max() -> u32 { 1500 }
fn default_transcript_max_messages() -> u32 { 100 }
fn default_transcript_max_tokens() -> u32 { 6000 }
fn default_true() -> bool { true }

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            privacy_mode: default_privacy_mode(),
            checkpoint_interval_minutes: default_checkpoint_interval(),
            additional_context_max_chars: default_additional_context_max(),
            transcript_max_messages: default_transcript_max_messages(),
            transcript_max_tokens: default_transcript_max_tokens(),
            sanitize_secrets: true,
        }
    }
}

pub fn write_config(path: &Path, config: &AppConfig) -> Result<()> {
    let content = toml::to_string_pretty(config)?;
    crate::storage::atomic_write(path, content.as_bytes())
}

pub fn load_config(path: &Path) -> Result<AppConfig> {
    match std::fs::read_to_string(path) {
        Ok(content) => Ok(toml::from_str(&content)?),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(AppConfig::default()),
        Err(e) => Err(e.into()),
    }
}
```

**Step 4: Run tests**

```bash
cargo test -p ctx-lab-core -- config
```

Expected: 4 tests PASS

**Step 5: Commit**

```bash
git add crates/ctx-lab-core/src/config.rs
git commit -m "feat(core): add TOML config with defaults and load/write"
```

---

### Task 7: Fire-and-Forget Queue (queue.rs)

**Files:**
- Modify: `crates/ctx-lab-core/src/queue.rs`

**Step 1: Write the tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_enqueue_creates_file() {
        let tmp = TempDir::new().unwrap();
        let queue_dir = tmp.path().join("queue");
        std::fs::create_dir_all(&queue_dir).unwrap();
        let payload = serde_json::json!({"session_id": "ses_1"});
        enqueue_to(&queue_dir, "session_end", "ses_1", &payload).unwrap();
        let entries: Vec<_> = std::fs::read_dir(&queue_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .collect();
        assert_eq!(entries.len(), 1);
        let name = entries[0].file_name().to_string_lossy().to_string();
        assert!(name.contains("session_end"));
        assert!(name.ends_with(".json"));
    }

    #[test]
    fn test_process_all_chronological_order() {
        let tmp = TempDir::new().unwrap();
        let queue_dir = tmp.path().join("queue");
        std::fs::create_dir_all(&queue_dir).unwrap();

        // Write files with known ordering
        std::fs::write(
            queue_dir.join("20260101_000001_000_event_a_ses1_aaaa.json"),
            r#"{"order":1}"#,
        ).unwrap();
        std::fs::write(
            queue_dir.join("20260101_000002_000_event_b_ses1_bbbb.json"),
            r#"{"order":2}"#,
        ).unwrap();

        let mut order = vec![];
        process_all_from(&queue_dir, |_event, payload| {
            order.push(payload["order"].as_i64().unwrap());
            Ok(())
        }).unwrap();

        assert_eq!(order, vec![1, 2]);
        // Files should be deleted after processing
        let remaining: Vec<_> = std::fs::read_dir(&queue_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .collect();
        assert_eq!(remaining.len(), 0);
    }

    #[test]
    fn test_process_all_skips_failed_items() {
        let tmp = TempDir::new().unwrap();
        let queue_dir = tmp.path().join("queue");
        std::fs::create_dir_all(&queue_dir).unwrap();

        std::fs::write(
            queue_dir.join("20260101_000001_000_ok_ses1_aaaa.json"),
            r#"{"ok":true}"#,
        ).unwrap();
        std::fs::write(
            queue_dir.join("20260101_000002_000_fail_ses1_bbbb.json"),
            r#"{"ok":false}"#,
        ).unwrap();

        let processed = process_all_from(&queue_dir, |_event, payload| {
            if payload["ok"].as_bool() == Some(true) {
                Ok(())
            } else {
                Err(anyhow::anyhow!("simulated failure"))
            }
        }).unwrap();

        assert_eq!(processed, 1);
        // Failed item should still exist
        let remaining: Vec<_> = std::fs::read_dir(&queue_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .collect();
        assert_eq!(remaining.len(), 1);
    }
}
```

**Step 2: Run tests to verify they fail**

```bash
cargo test -p ctx-lab-core -- queue
```

**Step 3: Implement**

```rust
use std::path::Path;
use anyhow::Result;
use crate::storage;

/// Enqueue a payload to the default queue directory.
pub fn enqueue(event: &str, session_id: &str, payload: &serde_json::Value) -> Result<()> {
    let queue_dir = storage::ctx_lab_dir()?.join("queue");
    enqueue_to(&queue_dir, event, session_id, payload)
}

/// Enqueue to a specific directory (for testing).
pub fn enqueue_to(
    queue_dir: &Path,
    event: &str,
    session_id: &str,
    payload: &serde_json::Value,
) -> Result<()> {
    std::fs::create_dir_all(queue_dir)?;
    let filename = format!(
        "{}_{}_{}_{}.json",
        chrono::Utc::now().format("%Y%m%d_%H%M%S_%3f"),
        event,
        session_id,
        &uuid::Uuid::new_v4().to_string()[..8]
    );
    let path = queue_dir.join(&filename);
    storage::write_json(&path, payload)
}

/// Process all queued items from the default queue.
pub fn process_all<F>(handler: F) -> Result<u32>
where
    F: Fn(&str, serde_json::Value) -> Result<()>,
{
    let queue_dir = storage::ctx_lab_dir()?.join("queue");
    process_all_from(&queue_dir, handler)
}

/// Process all queued items from a specific directory (for testing).
pub fn process_all_from<F>(queue_dir: &Path, handler: F) -> Result<u32>
where
    F: Fn(&str, serde_json::Value) -> Result<()>,
{
    let mut entries: Vec<_> = std::fs::read_dir(queue_dir)?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .map_or(false, |ext| ext == "json")
        })
        .collect();
    entries.sort_by_key(|e| e.file_name());

    let mut processed = 0;
    for entry in entries {
        let path = entry.path();
        match storage::safe_read_json_with_quarantine::<serde_json::Value>(
            &path,
            &queue_dir.parent().unwrap_or(queue_dir).join("quarantine"),
        ) {
            Ok(Some(payload)) => {
                let event = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("unknown");
                if let Err(e) = handler(event, payload) {
                    eprintln!("[ctx-lab] ERROR processing queue item {:?}: {}", path, e);
                    continue;
                }
                std::fs::remove_file(&path)?;
                processed += 1;
            }
            Ok(None) => {} // quarantined
            Err(e) => eprintln!("[ctx-lab] ERROR reading queue item {:?}: {}", path, e),
        }
    }
    Ok(processed)
}
```

**Step 4: Run tests**

```bash
cargo test -p ctx-lab-core -- queue
```

Expected: 3 tests PASS

**Step 5: Commit**

```bash
git add crates/ctx-lab-core/src/queue.rs
git commit -m "feat(core): add fire-and-forget payload queue with ordered processing"
```

---

### Task 8: Secret Sanitization (sanitize.rs)

**Files:**
- Modify: `crates/ctx-lab-core/src/sanitize.rs`

**Step 1: Write the tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_openai_key() {
        let result = sanitize("my key is sk-abc123def456ghi789jkl012mno");
        assert!(result.text.contains("[REDACTED]"));
        assert!(!result.text.contains("sk-abc"));
        assert!(result.redaction_count >= 1);
    }

    #[test]
    fn test_sanitize_aws_key() {
        let result = sanitize("aws key: AKIAIOSFODNN7EXAMPLE");
        assert!(result.text.contains("[REDACTED]"));
        assert!(!result.text.contains("AKIA"));
    }

    #[test]
    fn test_sanitize_github_pat() {
        let result = sanitize("token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij");
        assert!(result.text.contains("[REDACTED]"));
    }

    #[test]
    fn test_sanitize_bearer_token() {
        let result = sanitize("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test");
        assert!(result.text.contains("[REDACTED]"));
    }

    #[test]
    fn test_sanitize_password_assignment() {
        let result = sanitize("password = \"super_secret_123\"");
        assert!(result.text.contains("[REDACTED]"));
    }

    #[test]
    fn test_sanitize_env_export() {
        let result = sanitize("export API_SECRET_KEY=mysecretvalue123");
        assert!(result.text.contains("[REDACTED]"));
    }

    #[test]
    fn test_sanitize_clean_text_unchanged() {
        let input = "This is normal text with no secrets.";
        let result = sanitize(input);
        assert_eq!(result.text, input);
        assert_eq!(result.redaction_count, 0);
        assert!(result.patterns_found.is_empty());
    }

    #[test]
    fn test_sanitize_multiple_secrets_counted() {
        let input = "key1: sk-aaaaaaaaaaaaaaaaaaaaaa key2: sk-bbbbbbbbbbbbbbbbbbbbbb";
        let result = sanitize(input);
        assert!(result.redaction_count >= 2);
    }
}
```

**Step 2: Run tests to verify they fail**

```bash
cargo test -p ctx-lab-core -- sanitize
```

**Step 3: Implement**

Copy implementation from spec Section 4.4 (sanitize.rs). The code uses `once_cell::sync::Lazy` for regex compilation and pattern matching with redaction counting.

**Step 4: Run tests**

```bash
cargo test -p ctx-lab-core -- sanitize
```

Expected: 8 tests PASS

**Step 5: Commit**

```bash
git add crates/ctx-lab-core/src/sanitize.rs
git commit -m "feat(core): add secret sanitization with 6 redaction patterns"
```

---

### Task 9: Roadmap Parser (roadmap.rs)

**Files:**
- Modify: `crates/ctx-lab-core/src/roadmap.rs`

**Step 1: Write the tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_ROADMAP: &str = "\
# Project Roadmap

## Phase 1: Data Prep
- [x] Download dataset
- [x] Clean data
- [>] Feature engineering
- [ ] Train/test split

## Phase 2: Modeling
- [ ] Baseline model
- [ ] Hyperparameter tuning
";

    #[test]
    fn test_parse_roadmap_item_count() {
        let items = parse_roadmap(SAMPLE_ROADMAP);
        assert_eq!(items.len(), 6);
    }

    #[test]
    fn test_parse_roadmap_statuses() {
        let items = parse_roadmap(SAMPLE_ROADMAP);
        assert_eq!(items[0].status, ItemStatus::Done);
        assert_eq!(items[1].status, ItemStatus::Done);
        assert_eq!(items[2].status, ItemStatus::Active);
        assert_eq!(items[3].status, ItemStatus::Pending);
    }

    #[test]
    fn test_parse_roadmap_text() {
        let items = parse_roadmap(SAMPLE_ROADMAP);
        assert_eq!(items[0].text, "Download dataset");
        assert_eq!(items[2].text, "Feature engineering");
    }

    #[test]
    fn test_parse_roadmap_phases() {
        let items = parse_roadmap(SAMPLE_ROADMAP);
        assert_eq!(items[0].phase.as_deref(), Some("Phase 1: Data Prep"));
        assert_eq!(items[4].phase.as_deref(), Some("Phase 2: Modeling"));
    }

    #[test]
    fn test_active_item() {
        let item = active_item(SAMPLE_ROADMAP);
        assert!(item.is_some());
        assert_eq!(item.unwrap().text, "Feature engineering");
    }

    #[test]
    fn test_progress_percent() {
        let pct = progress_percent(SAMPLE_ROADMAP);
        // 2 done out of 6 = 33.3 → 33.0 rounded
        assert!((pct - 33.0).abs() < 1.0);
    }

    #[test]
    fn test_mark_complete_moves_active() {
        let result = mark_complete(SAMPLE_ROADMAP, "Feature engineering");
        assert!(result.is_some());
        let updated = result.unwrap();
        assert!(updated.contains("- [x] Feature engineering"));
        assert!(updated.contains("- [>] Train/test split"));
    }

    #[test]
    fn test_mark_complete_nonexistent_returns_none() {
        let result = mark_complete(SAMPLE_ROADMAP, "Nonexistent item");
        assert!(result.is_none());
    }

    #[test]
    fn test_empty_roadmap() {
        assert_eq!(parse_roadmap("").len(), 0);
        assert!(active_item("").is_none());
        assert_eq!(progress_percent(""), 0.0);
    }

    #[test]
    fn test_suspended_and_blocked_statuses() {
        let md = "- [~] Paused task\n- [!] Blocked task\n";
        let items = parse_roadmap(md);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].status, ItemStatus::Suspended);
        assert_eq!(items[1].status, ItemStatus::Blocked);
    }
}
```

**Step 2: Run tests to verify they fail**

```bash
cargo test -p ctx-lab-core -- roadmap
```

**Step 3: Implement**

```rust
use regex::Regex;
use once_cell::sync::Lazy;

#[derive(Debug, Clone)]
pub struct RoadmapItem {
    pub status: ItemStatus,
    pub text: String,
    pub phase: Option<String>,
    pub line_number: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ItemStatus {
    Done,       // [x]
    Active,     // [>]
    Pending,    // [ ]
    Suspended,  // [~]
    Blocked,    // [!]
}

static ITEM_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^-\s+\[([ x>~!])\]\s+(.+)$").unwrap()
});

static PHASE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^##\s+(.+)$").unwrap()
});

pub fn parse_roadmap(content: &str) -> Vec<RoadmapItem> {
    let mut items = Vec::new();
    let mut current_phase: Option<String> = None;

    for (idx, line) in content.lines().enumerate() {
        let trimmed = line.trim();

        if let Some(caps) = PHASE_RE.captures(trimmed) {
            current_phase = Some(caps[1].to_string());
            continue;
        }

        if let Some(caps) = ITEM_RE.captures(trimmed) {
            let status = match &caps[1] {
                "x" => ItemStatus::Done,
                ">" => ItemStatus::Active,
                " " => ItemStatus::Pending,
                "~" => ItemStatus::Suspended,
                "!" => ItemStatus::Blocked,
                _ => continue,
            };
            items.push(RoadmapItem {
                status,
                text: caps[2].trim().to_string(),
                phase: current_phase.clone(),
                line_number: idx + 1,
            });
        }
    }
    items
}

pub fn active_item(content: &str) -> Option<RoadmapItem> {
    parse_roadmap(content)
        .into_iter()
        .find(|i| i.status == ItemStatus::Active)
}

pub fn progress_percent(content: &str) -> f32 {
    let items = parse_roadmap(content);
    let total = items.len() as f32;
    if total == 0.0 {
        return 0.0;
    }
    let done = items.iter().filter(|i| i.status == ItemStatus::Done).count() as f32;
    (done / total * 100.0).round()
}

pub fn mark_complete(content: &str, item_text: &str) -> Option<String> {
    let lines: Vec<&str> = content.lines().collect();
    let mut found_line: Option<usize> = None;

    // Find the matching item line
    for (idx, line) in lines.iter().enumerate() {
        if let Some(caps) = ITEM_RE.captures(line.trim()) {
            if caps[2].trim() == item_text {
                found_line = Some(idx);
                break;
            }
        }
    }

    let target_line = found_line?;

    let mut new_lines: Vec<String> = lines.iter().map(|l| l.to_string()).collect();

    // Mark the target as done
    new_lines[target_line] = ITEM_RE
        .replace(&new_lines[target_line], "- [x] $2")
        .to_string();

    // Find the next pending item and mark it active
    for idx in (target_line + 1)..new_lines.len() {
        if let Some(caps) = ITEM_RE.captures(new_lines[idx].trim()) {
            if &caps[1] == " " {
                new_lines[idx] = ITEM_RE
                    .replace(&new_lines[idx], "- [>] $2")
                    .to_string();
                break;
            }
        }
    }

    Some(new_lines.join("\n"))
}
```

**Step 4: Run tests**

```bash
cargo test -p ctx-lab-core -- roadmap
```

Expected: 10 tests PASS

**Step 5: Commit**

```bash
git add crates/ctx-lab-core/src/roadmap.rs
git commit -m "feat(core): add roadmap markdown parser with status tracking and mark-complete"
```

---

### Task 10: CLAUDE.md Injection (claude_md.rs)

**Files:**
- Modify: `crates/ctx-lab-core/src/claude_md.rs`

**Step 1: Write the tests**

```rust
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
        let claude_md = tmp.path().join("CLAUDE.md");
        std::fs::write(&claude_md, "Existing user content").unwrap();

        update_claude_md(tmp.path(), "ctx-lab info").unwrap();
        let content = std::fs::read_to_string(&claude_md).unwrap();
        assert!(content.starts_with("Existing user content"));
        assert!(content.contains(CTX_LAB_START));
        assert!(content.contains("ctx-lab info"));
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
        assert!(content.contains("Keep this too"));
        assert!(!content.contains(CTX_LAB_START));
        assert!(!content.contains("Remove this"));
    }

    #[test]
    fn test_remove_block_deletes_empty_file() {
        let tmp = TempDir::new().unwrap();
        let claude_md = tmp.path().join("CLAUDE.md");
        std::fs::write(&claude_md, format!(
            "{}\nOnly ctx-lab content\n{}",
            CTX_LAB_START, CTX_LAB_END
        )).unwrap();

        remove_claude_md_block(tmp.path()).unwrap();
        assert!(!claude_md.exists());
    }
}
```

**Step 2: Run tests to verify they fail**

```bash
cargo test -p ctx-lab-core -- claude_md
```

**Step 3: Implement**

Copy implementation from spec Section 4.6. Key functions: `update_claude_md`, `remove_claude_md_block`. Uses `CTX_LAB_START` and `CTX_LAB_END` marker constants. Uses `storage::atomic_write` for safe writes.

**Step 4: Run tests**

```bash
cargo test -p ctx-lab-core -- claude_md
```

Expected: 5 tests PASS

**Step 5: Commit**

```bash
git add crates/ctx-lab-core/src/claude_md.rs
git commit -m "feat(core): add CLAUDE.md marker-based injection and removal"
```

---

### Task 11: Git Operations (git_ops.rs)

**Files:**
- Modify: `crates/ctx-lab-core/src/git_ops.rs`

**Step 1: Write the tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use std::process::Command;

    fn init_test_repo() -> TempDir {
        let tmp = TempDir::new().unwrap();
        Command::new("git")
            .args(["init"])
            .current_dir(tmp.path())
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(tmp.path())
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(tmp.path())
            .output()
            .unwrap();
        std::fs::write(tmp.path().join("file.txt"), "hello").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(tmp.path())
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", "initial"])
            .current_dir(tmp.path())
            .output()
            .unwrap();
        tmp
    }

    #[test]
    fn test_diff_stat_no_changes() {
        let tmp = init_test_repo();
        let stat = diff_stat(tmp.path());
        assert!(stat.is_ok());
        // No uncommitted changes after clean commit
    }

    #[test]
    fn test_diff_stat_with_changes() {
        let tmp = init_test_repo();
        std::fs::write(tmp.path().join("file.txt"), "modified").unwrap();
        let stat = diff_stat(tmp.path()).unwrap();
        assert!(stat.is_some());
        let s = stat.unwrap();
        assert!(s.contains("file.txt") || s.contains("1 file"));
    }

    #[test]
    fn test_recent_commits() {
        let tmp = init_test_repo();
        let commits = recent_commits(tmp.path(), 5).unwrap();
        assert!(!commits.is_empty());
        assert!(commits[0].contains("initial"));
    }

    #[test]
    fn test_is_git_repo_true() {
        let tmp = init_test_repo();
        assert!(is_git_repo(tmp.path()));
    }

    #[test]
    fn test_is_git_repo_false() {
        let tmp = TempDir::new().unwrap();
        assert!(!is_git_repo(tmp.path()));
    }
}
```

**Step 2: Run tests to verify they fail**

```bash
cargo test -p ctx-lab-core -- git_ops
```

**Step 3: Implement**

```rust
use std::path::Path;
use anyhow::Result;

/// Check if a directory is inside a git repository.
pub fn is_git_repo(path: &Path) -> bool {
    git2::Repository::discover(path).is_ok()
}

/// Get git diff --stat summary for uncommitted changes.
pub fn diff_stat(cwd: &Path) -> Result<Option<String>> {
    let repo = match git2::Repository::discover(cwd) {
        Ok(r) => r,
        Err(_) => return Ok(None),
    };

    let head = match repo.head() {
        Ok(h) => h,
        Err(_) => return Ok(None), // no commits yet
    };
    let head_tree = head.peel_to_tree()?;

    let diff = repo.diff_tree_to_workdir_with_index(Some(&head_tree), None)?;
    let stats = diff.stats()?;

    let files = stats.files_changed();
    if files == 0 {
        return Ok(None);
    }

    let insertions = stats.insertions();
    let deletions = stats.deletions();
    Ok(Some(format!(
        "+{} -{} across {} file(s)",
        insertions, deletions, files
    )))
}

/// Get recent commit messages (one-line format).
pub fn recent_commits(cwd: &Path, max: usize) -> Result<Vec<String>> {
    let repo = git2::Repository::discover(cwd)?;
    let mut revwalk = repo.revwalk()?;
    revwalk.push_head()?;
    revwalk.set_sorting(git2::Sort::TIME)?;

    let mut commits = Vec::new();
    for oid in revwalk.take(max) {
        let oid = oid?;
        let commit = repo.find_commit(oid)?;
        let msg = commit.summary().unwrap_or("(no message)").to_string();
        commits.push(msg);
    }
    Ok(commits)
}

/// Get list of changed file paths (uncommitted).
pub fn changed_files(cwd: &Path) -> Result<Vec<String>> {
    let repo = match git2::Repository::discover(cwd) {
        Ok(r) => r,
        Err(_) => return Ok(vec![]),
    };

    let head = match repo.head() {
        Ok(h) => h,
        Err(_) => return Ok(vec![]),
    };
    let head_tree = head.peel_to_tree()?;

    let diff = repo.diff_tree_to_workdir_with_index(Some(&head_tree), None)?;
    let mut files = Vec::new();
    diff.foreach(
        &mut |delta, _| {
            if let Some(path) = delta.new_file().path() {
                files.push(path.to_string_lossy().to_string());
            }
            true
        },
        None,
        None,
        None,
    )?;
    Ok(files)
}
```

**Step 4: Run tests**

```bash
cargo test -p ctx-lab-core -- git_ops
```

Expected: 5 tests PASS

**Step 5: Commit**

```bash
git add crates/ctx-lab-core/src/git_ops.rs
git commit -m "feat(core): add git operations - diff stat, recent commits, repo detection"
```

---

### Task 12: Transcript Parser (transcript.rs)

**Files:**
- Modify: `crates/ctx-lab-core/src/transcript.rs`

**Step 1: Write the tests**

```rust
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
        // Should not panic; returns empty or fallback
        assert!(
            highlights.user_messages.is_empty()
                || highlights.assistant_summaries.iter().any(|s| s.contains("unavailable"))
        );
    }

    #[test]
    fn test_max_messages_limit() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("transcript.jsonl");
        let mut lines = Vec::new();
        for i in 0..50 {
            lines.push(format!(
                r#"{{"role":"user","type":"text","message":"msg {}"}}"#,
                i
            ));
        }
        std::fs::write(&path, lines.join("\n")).unwrap();
        let highlights = extract_highlights(&path, tmp.path(), 5, 100_000);
        // Should respect max_messages limit
        assert!(highlights.user_messages.len() <= 5);
    }
}
```

**Step 2: Run tests to verify they fail**

```bash
cargo test -p ctx-lab-core -- transcript
```

**Step 3: Implement**

Copy implementation from spec Section 4.3 (transcript.rs). Key structures:
- `TranscriptHighlights` struct
- `TranscriptSource` trait
- `JsonlTranscriptSource` + `GitDiffFallback`
- `extract_highlights` smart selector function
- `parse_jsonl` with tail-read support
- `extract_text` helper

**Step 4: Run tests**

```bash
cargo test -p ctx-lab-core -- transcript
```

Expected: 5 tests PASS

**Step 5: Commit**

```bash
git add crates/ctx-lab-core/src/transcript.rs
git commit -m "feat(core): add transcript parser with JSONL support and git-diff fallback"
```

---

### Task 13: Hook Binary - CLI Routing (main.rs)

**Files:**
- Modify: `crates/ctx-lab-hook/src/main.rs`
- Create: `crates/ctx-lab-hook/src/session_start.rs`
- Create: `crates/ctx-lab-hook/src/checkpoint.rs`
- Create: `crates/ctx-lab-hook/src/stop.rs`
- Create: `crates/ctx-lab-hook/src/session_end.rs`
- Create: `crates/ctx-lab-hook/src/install.rs`
- Create: `crates/ctx-lab-hook/src/uninstall.rs`
- Create: `crates/ctx-lab-hook/src/doctor.rs`
- Create: `crates/ctx-lab-hook/src/process_queue.rs`

**Step 1: Create all subcommand stub modules**

Each stub file returns `Ok(())`:

```rust
// Example: session_start.rs
use anyhow::Result;

pub fn run() -> Result<()> {
    eprintln!("[ctx-lab] session_start: not yet implemented");
    Ok(())
}
```

Create stubs for: `session_start.rs`, `checkpoint.rs`, `stop.rs`, `session_end.rs`, `install.rs`, `uninstall.rs`, `doctor.rs`, `process_queue.rs`

**Step 2: Implement main.rs with clap routing**

```rust
use clap::{Parser, Subcommand};

mod session_start;
mod checkpoint;
mod stop;
mod session_end;
mod install;
mod uninstall;
mod doctor;
mod process_queue;

#[derive(Parser)]
#[command(name = "ctx-lab-hook", version, about = "ctx-lab Claude Code hook binary")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// SessionStart: detect project, load context, return additionalContext
    SessionStart,
    /// PostToolUse: debounced checkpoint (fire-and-forget)
    Checkpoint,
    /// Stop: roadmap suggestion detection (fire-and-forget)
    Stop,
    /// SessionEnd: full session log + sync (hybrid)
    SessionEnd,
    /// Install hooks into ~/.claude/settings.json
    Install,
    /// Remove hooks from ~/.claude/settings.json
    Uninstall,
    /// Health check
    Doctor,
    /// Process queued heavy tasks (daemon mode)
    ProcessQueue,
}

fn main() {
    let cli = Cli::parse();
    let result = match cli.command {
        Commands::SessionStart => session_start::run(),
        Commands::Checkpoint => checkpoint::run(),
        Commands::Stop => stop::run(),
        Commands::SessionEnd => session_end::run(),
        Commands::Install => install::run(),
        Commands::Uninstall => uninstall::run(),
        Commands::Doctor => doctor::run(),
        Commands::ProcessQueue => process_queue::run(),
    };

    if let Err(e) = result {
        eprintln!("[ctx-lab] ERROR: {}", e);
        // Hook errors must never block Claude Code — always exit 0
        std::process::exit(0);
    }
}
```

**Step 3: Verify build and subcommand help**

```bash
cargo build -p ctx-lab-hook
cargo run -p ctx-lab-hook -- --help
cargo run -p ctx-lab-hook -- session-start
```

Expected: Build succeeds, help shows all 8 subcommands, session-start prints stub message.

**Step 4: Commit**

```bash
git add crates/ctx-lab-hook/
git commit -m "feat(hook): add clap CLI with 8 subcommand stubs"
```

---

### Task 14: Install Command (install.rs)

**Files:**
- Modify: `crates/ctx-lab-hook/src/install.rs`

**Step 1: Write the test**

Create `tests/install_test.rs` in the hook crate or use a separate integration test:

```rust
// crates/ctx-lab-hook/src/install.rs — inline tests

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_patch_empty_settings() {
        let settings = serde_json::json!({});
        let binary_path = "/usr/local/bin/ctx-lab-hook";
        let patched = patch_hooks_into_settings(&settings, binary_path);
        let hooks = &patched["hooks"];
        assert!(hooks["SessionStart"].is_array());
        assert!(hooks["PostToolUse"].is_array());
        assert!(hooks["Stop"].is_array());
        assert!(hooks["SessionEnd"].is_array());
    }

    #[test]
    fn test_patch_preserves_existing_hooks() {
        let settings = serde_json::json!({
            "hooks": {
                "SessionStart": [
                    {"type": "command", "command": "echo existing"}
                ]
            }
        });
        let patched = patch_hooks_into_settings(&settings, "/bin/ctx-lab-hook");
        let session_hooks = patched["hooks"]["SessionStart"].as_array().unwrap();
        // Should have both existing and ctx-lab hooks
        assert!(session_hooks.len() >= 2);
    }

    #[test]
    fn test_patch_idempotent() {
        let settings = serde_json::json!({});
        let binary_path = "/bin/ctx-lab-hook";
        let first = patch_hooks_into_settings(&settings, binary_path);
        let second = patch_hooks_into_settings(&first, binary_path);
        // Should not duplicate ctx-lab hooks
        let hooks = second["hooks"]["SessionStart"].as_array().unwrap();
        let ctx_lab_count = hooks.iter()
            .filter(|h| {
                h.get("command")
                    .and_then(|c| c.as_str())
                    .map_or(false, |c| c.contains("ctx-lab"))
            })
            .count();
        assert_eq!(ctx_lab_count, 1);
    }

    #[test]
    fn test_init_creates_config() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path().join(".ctx-lab");
        init_ctx_lab_data(&base).unwrap();
        assert!(base.join("config.toml").exists());
    }
}
```

**Step 2: Run tests to verify they fail**

```bash
cargo test -p ctx-lab-hook -- install
```

**Step 3: Implement install.rs**

```rust
use anyhow::Result;
use std::path::{Path, PathBuf};

pub fn run() -> Result<()> {
    eprintln!("[ctx-lab] Installing hooks...");

    // 1. Find hook binary path
    let binary_path = std::env::current_exe()?
        .to_string_lossy()
        .to_string();

    // 2. Read ~/.claude/settings.json
    let settings_path = claude_settings_path()?;
    let settings = read_settings(&settings_path)?;

    // 3. Backup
    let backup_path = settings_path.with_extension("json.ctx-lab-backup");
    if settings_path.exists() {
        std::fs::copy(&settings_path, &backup_path)?;
    }

    // 4. Patch hooks
    let patched = patch_hooks_into_settings(&settings, &binary_path);

    // 5. Validate JSON
    let json_str = serde_json::to_string_pretty(&patched)?;
    serde_json::from_str::<serde_json::Value>(&json_str).map_err(|e| {
        // Restore backup on failure
        if backup_path.exists() {
            let _ = std::fs::copy(&backup_path, &settings_path);
        }
        anyhow::anyhow!("settings.json validation failed: {}", e)
    })?;

    // 6. Write patched settings
    ctx_lab_core::storage::atomic_write(&settings_path, json_str.as_bytes())?;

    // 7. Init data dir
    let base = ctx_lab_core::storage::init_data_dir()?;
    init_ctx_lab_data(&base)?;

    // 8. Register machine
    register_machine(&base)?;

    eprintln!("[ctx-lab] Hooks installed successfully");
    Ok(())
}

fn claude_settings_path() -> Result<PathBuf> {
    let home = dirs::home_dir()
        .ok_or_else(|| anyhow::anyhow!("HOME not found"))?;
    Ok(home.join(".claude").join("settings.json"))
}

fn read_settings(path: &Path) -> Result<serde_json::Value> {
    match std::fs::read_to_string(path) {
        Ok(content) => Ok(serde_json::from_str(&content)?),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::json!({})),
        Err(e) => Err(e.into()),
    }
}

pub fn patch_hooks_into_settings(
    settings: &serde_json::Value,
    binary_path: &str,
) -> serde_json::Value {
    let mut patched = settings.clone();
    let hooks = patched
        .as_object_mut()
        .unwrap()
        .entry("hooks")
        .or_insert_with(|| serde_json::json!({}));

    let hook_defs = [
        ("SessionStart", "session-start"),
        ("PostToolUse", "checkpoint"),
        ("Stop", "stop"),
        ("SessionEnd", "session-end"),
    ];

    for (event, subcommand) in &hook_defs {
        let event_hooks = hooks
            .as_object_mut()
            .unwrap()
            .entry(*event)
            .or_insert_with(|| serde_json::json!([]));

        let arr = event_hooks.as_array_mut().unwrap();

        // Remove existing ctx-lab hooks (idempotency)
        arr.retain(|h| {
            !h.get("command")
                .and_then(|c| c.as_str())
                .map_or(false, |c| c.contains("ctx-lab"))
        });

        // Add ctx-lab hook
        arr.push(serde_json::json!({
            "type": "command",
            "command": format!("{} {}", binary_path, subcommand),
            "ctx-lab-managed": true
        }));
    }

    patched
}

fn init_ctx_lab_data(base: &Path) -> Result<()> {
    let config_path = base.join("config.toml");
    if !config_path.exists() {
        let default_config = ctx_lab_core::config::AppConfig::default();
        ctx_lab_core::config::write_config(&config_path, &default_config)?;
    }

    // Create .gitignore for local-only files
    let gitignore_path = base.join(".gitignore");
    if !gitignore_path.exists() {
        ctx_lab_core::storage::atomic_write(
            &gitignore_path,
            b"cache.db\n*.db-*\nqueue/\n.events/\n",
        )?;
    }

    Ok(())
}

fn register_machine(base: &Path) -> Result<()> {
    let hostname = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "unknown".into());

    let machine = ctx_lab_core::models::MachineProfile {
        schema_version: ctx_lab_core::models::SCHEMA_VERSION,
        hostname: hostname.clone(),
        platform: std::env::consts::OS.into(),
        registered_at: chrono::Utc::now(),
    };

    let path = base.join("machines").join(format!("{}.toml", hostname));
    let content = toml::to_string_pretty(&machine)?;
    ctx_lab_core::storage::atomic_write(&path, content.as_bytes())
}
```

**Note:** Add `hostname = "0.4"` and `toml.workspace = true` to ctx-lab-hook's Cargo.toml dependencies.

**Step 4: Run tests**

```bash
cargo test -p ctx-lab-hook -- install
```

Expected: 4 tests PASS

**Step 5: Commit**

```bash
git add crates/ctx-lab-hook/src/install.rs crates/ctx-lab-hook/Cargo.toml
git commit -m "feat(hook): add install command with settings.json patching and idempotency"
```

---

### Task 15: Doctor Command (doctor.rs)

**Files:**
- Modify: `crates/ctx-lab-hook/src/doctor.rs`

**Step 1: Write the test**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_result_display() {
        let ok = CheckResult::Ok("Data directory exists".into());
        let warn = CheckResult::Warn("2 quarantine files".into());
        let fail = CheckResult::Fail("Config missing".into());
        assert!(format!("{}", ok).contains("[OK]"));
        assert!(format!("{}", warn).contains("[WARN]"));
        assert!(format!("{}", fail).contains("[FAIL]"));
    }
}
```

**Step 2: Implement**

```rust
use anyhow::Result;
use std::fmt;

pub enum CheckResult {
    Ok(String),
    Warn(String),
    Fail(String),
}

impl fmt::Display for CheckResult {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CheckResult::Ok(msg) => write!(f, "  [OK]   {}", msg),
            CheckResult::Warn(msg) => write!(f, "  [WARN] {}", msg),
            CheckResult::Fail(msg) => write!(f, "  [FAIL] {}", msg),
        }
    }
}

pub fn run() -> Result<()> {
    eprintln!("ctx-lab doctor report:");
    let mut has_fail = false;

    let checks = vec![
        check_data_dir(),
        check_config(),
        check_hooks_registered(),
        check_quarantine(),
    ];

    for check in &checks {
        eprintln!("{}", check);
        if matches!(check, CheckResult::Fail(_)) {
            has_fail = true;
        }
    }

    if has_fail {
        eprintln!("  [FAIL] Overall: unhealthy");
    } else {
        eprintln!("  [OK]   Overall: healthy");
    }

    Ok(())
}

fn check_data_dir() -> CheckResult {
    match ctx_lab_core::storage::ctx_lab_dir() {
        Ok(dir) if dir.exists() => CheckResult::Ok(format!("Data directory: {}", dir.display())),
        Ok(dir) => CheckResult::Fail(format!("Data directory missing: {}", dir.display())),
        Err(e) => CheckResult::Fail(format!("Cannot determine data dir: {}", e)),
    }
}

fn check_config() -> CheckResult {
    let config_path = match ctx_lab_core::storage::ctx_lab_dir() {
        Ok(d) => d.join("config.toml"),
        Err(_) => return CheckResult::Fail("Cannot find config".into()),
    };
    match ctx_lab_core::config::load_config(&config_path) {
        Ok(_) => CheckResult::Ok("Config: valid".into()),
        Err(e) => CheckResult::Fail(format!("Config: {}", e)),
    }
}

fn check_hooks_registered() -> CheckResult {
    let settings_path = dirs::home_dir()
        .map(|h| h.join(".claude").join("settings.json"));
    match settings_path {
        Some(path) if path.exists() => {
            match std::fs::read_to_string(&path) {
                Ok(content) => {
                    if content.contains("ctx-lab") {
                        CheckResult::Ok("Hooks: registered in settings.json".into())
                    } else {
                        CheckResult::Warn("Hooks: not found in settings.json (run install)".into())
                    }
                }
                Err(e) => CheckResult::Fail(format!("Cannot read settings.json: {}", e)),
            }
        }
        _ => CheckResult::Warn("~/.claude/settings.json not found".into()),
    }
}

fn check_quarantine() -> CheckResult {
    let quarantine_dir = match ctx_lab_core::storage::ctx_lab_dir() {
        Ok(d) => d.join("quarantine"),
        Err(_) => return CheckResult::Warn("Cannot check quarantine".into()),
    };
    match std::fs::read_dir(&quarantine_dir) {
        Ok(entries) => {
            let count = entries.filter_map(|e| e.ok()).count();
            if count == 0 {
                CheckResult::Ok("Quarantine: empty".into())
            } else {
                CheckResult::Warn(format!("Quarantine: {} file(s)", count))
            }
        }
        Err(_) => CheckResult::Ok("Quarantine: directory not yet created".into()),
    }
}
```

**Step 3: Run tests**

```bash
cargo test -p ctx-lab-hook -- doctor
```

Expected: 1 test PASS

**Step 4: Commit**

```bash
git add crates/ctx-lab-hook/src/doctor.rs
git commit -m "feat(hook): add doctor health check command"
```

---

### Task 16: SessionStart Command (session_start.rs)

**Files:**
- Modify: `crates/ctx-lab-hook/src/session_start.rs`

**Step 1: Write the tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_detect_project_slug_from_path() {
        assert_eq!(project_slug_from_cwd("/home/user/projects/my-project"), "my-project");
        assert_eq!(project_slug_from_cwd("/Users/cagri/PROJELER/adeb-sci"), "adeb-sci");
    }

    #[test]
    fn test_build_additional_context_with_summary() {
        let ctx = build_additional_context(
            Some("Last session: fixed auth bug"),
            Some("Feature engineering"),
            Some("33%"),
            false,  // has_roadmap
        );
        assert!(ctx.contains("fixed auth bug"));
        assert!(ctx.contains("Feature engineering"));
    }

    #[test]
    fn test_build_additional_context_empty_roadmap() {
        let ctx = build_additional_context(
            None,
            None,
            None,
            false,
        );
        assert!(ctx.contains("roadmap"));  // should mention roadmap creation
    }

    #[test]
    fn test_build_additional_context_truncation() {
        let long_summary = "x".repeat(2000);
        let ctx = build_additional_context(
            Some(&long_summary),
            Some("active step"),
            Some("50%"),
            true,
        );
        assert!(ctx.len() <= 1500);
    }

    #[test]
    fn test_session_start_output_json() {
        let output = format_output("test context");
        let parsed: serde_json::Value = serde_json::from_str(&output).unwrap();
        assert_eq!(
            parsed["hookSpecificOutput"]["hookEventName"],
            "SessionStart"
        );
        assert_eq!(
            parsed["hookSpecificOutput"]["additionalContext"],
            "test context"
        );
    }
}
```

**Step 2: Run tests to verify they fail**

```bash
cargo test -p ctx-lab-hook -- session_start
```

**Step 3: Implement session_start.rs**

```rust
use anyhow::Result;
use ctx_lab_core::models::*;
use std::io::Read;

pub fn run() -> Result<()> {
    // 1. Read stdin payload
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    let payload: SessionStartPayload = serde_json::from_str(&input)?;

    // 2. Detect project from cwd
    let slug = project_slug_from_cwd(&payload.cwd);
    let base = ctx_lab_core::storage::ctx_lab_dir()?;
    let project_dir = base.join("projects").join(&slug);
    std::fs::create_dir_all(&project_dir)?;

    // 3. Auto-register new project
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
                let hostname = hostname::get()
                    .map(|h| h.to_string_lossy().to_string())
                    .unwrap_or_else(|_| "unknown".into());
                m.insert(hostname, payload.cwd.clone());
                m
            },
        };
        let toml_str = toml::to_string_pretty(&meta)?;
        ctx_lab_core::storage::atomic_write(&meta_path, toml_str.as_bytes())?;
    }

    // 4. Read last session summary
    let last_summary = read_last_session_summary(&project_dir);

    // 5. Read active roadmap step
    let roadmap_path = project_dir.join("roadmap.md");
    let roadmap_content = std::fs::read_to_string(&roadmap_path).unwrap_or_default();
    let has_roadmap = !roadmap_content.trim().is_empty();
    let active_step = ctx_lab_core::roadmap::active_item(&roadmap_content)
        .map(|item| item.text);
    let progress = if has_roadmap {
        Some(format!("{}%", ctx_lab_core::roadmap::progress_percent(&roadmap_content)))
    } else {
        None
    };

    // 6. Build additionalContext
    let context = build_additional_context(
        last_summary.as_deref(),
        active_step.as_deref(),
        progress.as_deref(),
        has_roadmap,
    );

    // 7. Update CLAUDE.md
    let claude_md_block = build_claude_md_block(
        last_summary.as_deref(),
        active_step.as_deref(),
        &roadmap_content,
    );
    let _ = ctx_lab_core::claude_md::update_claude_md(
        std::path::Path::new(&payload.cwd),
        &claude_md_block,
    );

    // 8. Write event
    let event_dir = base.join(".events");
    std::fs::create_dir_all(&event_dir)?;
    let event_file = event_dir.join(format!(
        "{}_{}_session_started.json",
        chrono::Utc::now().format("%Y%m%d_%H%M%S"),
        &payload.session_id
    ));
    let event = serde_json::json!({
        "event": "session_started",
        "session_id": payload.session_id,
        "project": slug,
        "timestamp": chrono::Utc::now().to_rfc3339(),
    });
    ctx_lab_core::storage::write_json(&event_file, &event)?;

    // 9. Output additionalContext to stdout
    print!("{}", format_output(&context));

    Ok(())
}

pub fn project_slug_from_cwd(cwd: &str) -> String {
    std::path::Path::new(cwd)
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown-project".into())
}

fn read_last_session_summary(project_dir: &std::path::Path) -> Option<String> {
    let sessions_dir = project_dir.join("sessions");
    let mut entries: Vec<_> = std::fs::read_dir(&sessions_dir)
        .ok()?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map_or(false, |ext| ext == "json"))
        .collect();
    entries.sort_by_key(|e| e.file_name());

    if let Some(last) = entries.last() {
        let content = std::fs::read_to_string(last.path()).ok()?;
        let session: serde_json::Value = serde_json::from_str(&content).ok()?;
        session.get("summary")
            .and_then(|s| s.as_str())
            .map(|s| s.to_string())
    } else {
        None
    }
}

pub fn build_additional_context(
    last_summary: Option<&str>,
    active_step: Option<&str>,
    progress: Option<&str>,
    has_roadmap: bool,
) -> String {
    let mut parts = Vec::new();

    parts.push("[ctx-lab] Project context:".to_string());

    if let Some(summary) = last_summary {
        let truncated: String = summary.chars().take(500).collect();
        parts.push(format!("Last session: {}", truncated));
    }

    if let Some(step) = active_step {
        parts.push(format!("Active roadmap step: {}", step));
    }

    if let Some(pct) = progress {
        parts.push(format!("Progress: {}", pct));
    }

    if !has_roadmap {
        parts.push(
            "No roadmap yet. You can help the user create a project roadmap at \
             ~/.ctx-lab/projects/<slug>/roadmap.md using markdown checkboxes \
             (- [ ] item, - [>] active, - [x] done)."
                .to_string(),
        );
    }

    let mut result = parts.join("\n");
    if result.len() > 1500 {
        result = result.chars().take(1497).collect::<String>() + "...";
    }
    result
}

fn build_claude_md_block(
    last_summary: Option<&str>,
    active_step: Option<&str>,
    roadmap_content: &str,
) -> String {
    let mut lines = vec![
        "## Project Status (auto-updated by ctx-lab)".to_string(),
        String::new(),
    ];

    if let Some(summary) = last_summary {
        let truncated: String = summary.chars().take(300).collect();
        lines.push(format!("**Last Session:** {}", truncated));
    }

    if let Some(step) = active_step {
        lines.push(format!("**Active Step:** {}", step));
    }

    // Add roadmap summary (only active + next few items)
    let items = ctx_lab_core::roadmap::parse_roadmap(roadmap_content);
    let relevant: Vec<_> = items
        .iter()
        .filter(|i| matches!(
            i.status,
            ctx_lab_core::roadmap::ItemStatus::Active | ctx_lab_core::roadmap::ItemStatus::Pending
        ))
        .take(5)
        .collect();

    if !relevant.is_empty() {
        lines.push(String::new());
        lines.push("### Upcoming".to_string());
        for item in relevant {
            let marker = match item.status {
                ctx_lab_core::roadmap::ItemStatus::Active => "[>]",
                _ => "[ ]",
            };
            lines.push(format!("- {} {}", marker, item.text));
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
```

**Step 4: Run tests**

```bash
cargo test -p ctx-lab-hook -- session_start
```

Expected: 5 tests PASS

**Step 5: Commit**

```bash
git add crates/ctx-lab-hook/src/session_start.rs
git commit -m "feat(hook): add session-start with project detection and additionalContext"
```

---

### Task 17: Checkpoint Command (checkpoint.rs)

**Files:**
- Modify: `crates/ctx-lab-hook/src/checkpoint.rs`

**Step 1: Write tests and implement**

Checkpoint is fire-and-forget: read stdin, check debounce, enqueue if needed.

```rust
use anyhow::Result;
use std::io::Read;

pub fn run() -> Result<()> {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    let payload: ctx_lab_core::models::PostToolUsePayload = serde_json::from_str(&input)?;

    // Debounce: check last checkpoint timestamp
    let base = ctx_lab_core::storage::ctx_lab_dir()?;
    let debounce_file = base.join(format!(".last-checkpoint-{}", payload.session_id));

    if let Ok(content) = std::fs::read_to_string(&debounce_file) {
        if let Ok(last_ts) = content.trim().parse::<i64>() {
            let now = chrono::Utc::now().timestamp();
            let config = ctx_lab_core::config::load_config(&base.join("config.toml"))?;
            let interval_secs = (config.checkpoint_interval_minutes as i64) * 60;
            if now - last_ts < interval_secs {
                return Ok(()); // debounced, skip
            }
        }
    }

    // Update debounce timestamp
    let now_str = chrono::Utc::now().timestamp().to_string();
    ctx_lab_core::storage::atomic_write(&debounce_file, now_str.as_bytes())?;

    // Enqueue for processing
    let queue_payload = serde_json::json!({
        "event": "checkpoint",
        "session_id": payload.session_id,
        "cwd": payload.cwd,
        "transcript_path": payload.transcript_path,
        "tool_name": payload.tool_name,
        "timestamp": chrono::Utc::now().to_rfc3339(),
    });
    ctx_lab_core::queue::enqueue("checkpoint", &payload.session_id, &queue_payload)?;

    Ok(())
}
```

**Step 2: Commit**

```bash
git add crates/ctx-lab-hook/src/checkpoint.rs
git commit -m "feat(hook): add checkpoint command with debounce and fire-and-forget queue"
```

---

### Task 18: Stop Command (stop.rs)

**Files:**
- Modify: `crates/ctx-lab-hook/src/stop.rs`

**Step 1: Implement**

```rust
use anyhow::Result;
use std::io::Read;

pub fn run() -> Result<()> {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    let payload: ctx_lab_core::models::StopPayload = serde_json::from_str(&input)?;

    // Loop protection: if stop_hook_active, exit immediately
    if payload.stop_hook_active == Some(true) {
        return Ok(());
    }

    // Enqueue for async processing
    let queue_payload = serde_json::json!({
        "event": "stop",
        "session_id": payload.session_id,
        "transcript_path": payload.transcript_path,
        "timestamp": chrono::Utc::now().to_rfc3339(),
    });
    ctx_lab_core::queue::enqueue("stop", &payload.session_id, &queue_payload)?;

    Ok(())
}
```

**Step 2: Commit**

```bash
git add crates/ctx-lab-hook/src/stop.rs
git commit -m "feat(hook): add stop command with loop protection and fire-and-forget"
```

---

### Task 19: SessionEnd Command (session_end.rs)

**Files:**
- Modify: `crates/ctx-lab-hook/src/session_end.rs`

**Step 1: Implement**

```rust
use anyhow::Result;
use std::io::Read;

pub fn run() -> Result<()> {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    let payload: ctx_lab_core::models::SessionEndPayload = serde_json::from_str(&input)?;

    let base = ctx_lab_core::storage::ctx_lab_dir()?;
    let slug = crate::session_start::project_slug_from_cwd(&payload.cwd);
    let project_dir = base.join("projects").join(&slug);
    let sessions_dir = project_dir.join("sessions");
    std::fs::create_dir_all(&sessions_dir)?;

    // Synchronous: write minimal session JSON quickly
    let hostname = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "unknown".into());

    let now = chrono::Utc::now();
    let session_file = sessions_dir.join(format!(
        "{}_{}_{}.json",
        now.format("%Y%m%d"),
        hostname,
        &payload.session_id
    ));

    // Quick git stats
    let cwd_path = std::path::Path::new(&payload.cwd);
    let diff_stat = ctx_lab_core::git_ops::diff_stat(cwd_path).unwrap_or(None);
    let commits = ctx_lab_core::git_ops::recent_commits(cwd_path, 3).unwrap_or_default();

    let minimal_session = ctx_lab_core::models::Session {
        schema_version: ctx_lab_core::models::SCHEMA_VERSION,
        id: format!("ses_{}", &payload.session_id),
        project_id: format!("proj_{}", slug),
        machine: hostname,
        started_at: now, // approximate — will be enriched later
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

    ctx_lab_core::storage::write_json(&session_file, &minimal_session)?;

    // Write event
    let event_dir = base.join(".events");
    std::fs::create_dir_all(&event_dir)?;
    let event = serde_json::json!({
        "event": "session_ended",
        "session_id": payload.session_id,
        "project": slug,
        "timestamp": now.to_rfc3339(),
    });
    let event_file = event_dir.join(format!(
        "{}_{}_session_ended.json",
        now.format("%Y%m%d_%H%M%S"),
        &payload.session_id
    ));
    ctx_lab_core::storage::write_json(&event_file, &event)?;

    // Async: enqueue enrichment work
    let queue_payload = serde_json::json!({
        "event": "session_end_enrich",
        "session_id": payload.session_id,
        "session_file": session_file.to_string_lossy(),
        "cwd": payload.cwd,
        "transcript_path": payload.transcript_path,
        "timestamp": now.to_rfc3339(),
    });
    ctx_lab_core::queue::enqueue("session_end_enrich", &payload.session_id, &queue_payload)?;

    Ok(())
}
```

**Step 2: Commit**

```bash
git add crates/ctx-lab-hook/src/session_end.rs
git commit -m "feat(hook): add session-end with minimal sync write and async enrichment queue"
```

---

### Task 20: Process Queue (process_queue.rs)

**Files:**
- Modify: `crates/ctx-lab-hook/src/process_queue.rs`

**Step 1: Implement**

```rust
use anyhow::Result;

pub fn run() -> Result<()> {
    eprintln!("[ctx-lab] Processing queue...");
    let processed = ctx_lab_core::queue::process_all(handle_queue_item)?;
    eprintln!("[ctx-lab] Processed {} queue items", processed);
    Ok(())
}

fn handle_queue_item(event_name: &str, payload: serde_json::Value) -> Result<()> {
    // Extract event type from payload or filename
    let event = payload
        .get("event")
        .and_then(|e| e.as_str())
        .unwrap_or(event_name);

    match event {
        "checkpoint" => process_checkpoint(payload),
        "stop" => process_stop(payload),
        "session_end_enrich" => process_session_enrichment(payload),
        _ => {
            eprintln!("[ctx-lab] Unknown queue event: {}", event);
            Ok(())
        }
    }
}

fn process_checkpoint(payload: serde_json::Value) -> Result<()> {
    let session_id = payload["session_id"].as_str().unwrap_or("unknown");
    let cwd = payload["cwd"].as_str().unwrap_or(".");
    let cwd_path = std::path::Path::new(cwd);

    let base = ctx_lab_core::storage::ctx_lab_dir()?;
    let slug = crate::session_start::project_slug_from_cwd(cwd);
    let checkpoints_dir = base.join("projects").join(&slug).join("checkpoints");
    std::fs::create_dir_all(&checkpoints_dir)?;

    let now = chrono::Utc::now();
    let chk_id = format!("chk_{}", &uuid::Uuid::new_v4().to_string()[..8]);

    let checkpoint = ctx_lab_core::models::Checkpoint {
        schema_version: ctx_lab_core::models::SCHEMA_VERSION,
        id: chk_id.clone(),
        session_id: format!("ses_{}", session_id),
        project_id: format!("proj_{}", slug),
        machine: hostname::get()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or_else(|_| "unknown".into()),
        timestamp: now,
        git_diff_stat: ctx_lab_core::git_ops::diff_stat(cwd_path).unwrap_or(None),
        files_changed: ctx_lab_core::git_ops::changed_files(cwd_path).unwrap_or_default(),
        recent_commits: ctx_lab_core::git_ops::recent_commits(cwd_path, 3).unwrap_or_default(),
        source: "postToolUse_debounced".into(),
    };

    let path = checkpoints_dir.join(format!(
        "{}_{}.json",
        now.format("%Y%m%d_%H%M%S"),
        chk_id
    ));
    ctx_lab_core::storage::write_json(&path, &checkpoint)?;
    eprintln!("[ctx-lab] Checkpoint created: {}", chk_id);
    Ok(())
}

fn process_stop(payload: serde_json::Value) -> Result<()> {
    // v1: Minimal — just log that stop was processed
    let session_id = payload["session_id"].as_str().unwrap_or("unknown");
    eprintln!("[ctx-lab] Stop event processed for session {}", session_id);
    Ok(())
}

fn process_session_enrichment(payload: serde_json::Value) -> Result<()> {
    let session_file = payload["session_file"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("missing session_file in enrichment payload"))?;
    let transcript_path = payload["transcript_path"].as_str().unwrap_or("");
    let cwd = payload["cwd"].as_str().unwrap_or(".");

    let session_path = std::path::Path::new(session_file);
    let mut session: ctx_lab_core::models::Session = match ctx_lab_core::storage::safe_read_json(session_path)? {
        Some(s) => s,
        None => return Ok(()), // file was quarantined or missing
    };

    // Load config for limits
    let base = ctx_lab_core::storage::ctx_lab_dir()?;
    let config = ctx_lab_core::config::load_config(&base.join("config.toml"))?;

    // Parse transcript
    let tp = std::path::Path::new(transcript_path);
    let cwd_path = std::path::Path::new(cwd);
    let highlights = ctx_lab_core::transcript::extract_highlights(
        tp,
        cwd_path,
        config.transcript_max_messages as usize,
        (config.transcript_max_tokens * 4) as usize, // rough bytes estimate
    );

    // Enrich session
    session.tools_used = highlights.tools_used;
    session.transcript_highlights = highlights.user_messages.clone();

    // Build enriched summary
    if !highlights.user_messages.is_empty() || !highlights.assistant_summaries.is_empty() {
        let mut summary_parts = Vec::new();
        if let Some(first_user) = highlights.user_messages.first() {
            summary_parts.push(format!("Started with: {}", first_user));
        }
        if let Some(last_asst) = highlights.assistant_summaries.last() {
            summary_parts.push(format!("Concluded: {}", last_asst));
        }
        session.summary = summary_parts.join(". ");
        session.summary_source = "transcript+git".into();
    }

    // Sanitize
    if config.sanitize_secrets {
        let sanitized = ctx_lab_core::sanitize::sanitize(&session.summary);
        session.summary = sanitized.text;
        session.redaction_count = sanitized.redaction_count;

        // Sanitize highlights too
        session.transcript_highlights = session
            .transcript_highlights
            .into_iter()
            .map(|h| ctx_lab_core::sanitize::sanitize(&h).text)
            .collect();
    }

    // Update CLAUDE.md
    let slug = crate::session_start::project_slug_from_cwd(cwd);
    let roadmap_path = base.join("projects").join(&slug).join("roadmap.md");
    let roadmap_content = std::fs::read_to_string(&roadmap_path).unwrap_or_default();
    let active_step = ctx_lab_core::roadmap::active_item(&roadmap_content)
        .map(|i| i.text);

    let block = format!(
        "## Project Status (auto-updated by ctx-lab)\n\n\
         **Last Session:** {}\n\
         **Summary:** {}\n\
         {}",
        session.ended_at.map_or("unknown".into(), |t| t.format("%Y-%m-%d %H:%M").to_string()),
        session.summary,
        active_step.map_or(String::new(), |s| format!("**Active Step:** {}", s)),
    );
    let _ = ctx_lab_core::claude_md::update_claude_md(cwd_path, &block);

    // Write enriched session back
    ctx_lab_core::storage::write_json(session_path, &session)?;
    eprintln!("[ctx-lab] Session enriched: {}", session.id);

    Ok(())
}
```

**Step 2: Commit**

```bash
git add crates/ctx-lab-hook/src/process_queue.rs
git commit -m "feat(hook): add queue processor with checkpoint, stop, and session enrichment handlers"
```

---

### Task 21: Uninstall Command (uninstall.rs)

**Files:**
- Modify: `crates/ctx-lab-hook/src/uninstall.rs`

**Step 1: Implement**

```rust
use anyhow::Result;

pub fn run() -> Result<()> {
    eprintln!("[ctx-lab] Uninstalling hooks...");

    // 1. Read settings.json
    let settings_path = dirs::home_dir()
        .ok_or_else(|| anyhow::anyhow!("HOME not found"))?
        .join(".claude")
        .join("settings.json");

    if !settings_path.exists() {
        eprintln!("[ctx-lab] No settings.json found, nothing to uninstall");
        return Ok(());
    }

    let content = std::fs::read_to_string(&settings_path)?;
    let mut settings: serde_json::Value = serde_json::from_str(&content)?;

    // 2. Remove ctx-lab hooks from all events
    if let Some(hooks) = settings.get_mut("hooks").and_then(|h| h.as_object_mut()) {
        for (_event, event_hooks) in hooks.iter_mut() {
            if let Some(arr) = event_hooks.as_array_mut() {
                arr.retain(|h| {
                    !h.get("ctx-lab-managed")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false)
                });
            }
        }
    }

    // 3. Write cleaned settings
    let json_str = serde_json::to_string_pretty(&settings)?;
    ctx_lab_core::storage::atomic_write(&settings_path, json_str.as_bytes())?;

    eprintln!("[ctx-lab] Hooks removed from settings.json");
    eprintln!("[ctx-lab] Data preserved at ~/.ctx-lab/ (delete manually if desired)");
    Ok(())
}
```

**Step 2: Commit**

```bash
git add crates/ctx-lab-hook/src/uninstall.rs
git commit -m "feat(hook): add uninstall command that removes ctx-lab hooks from settings.json"
```

---

### Task 22: Golden Fixture Test Data

**Files:**
- Create: `tests/fixtures/hook_payloads/01_session_start_simple.json`
- Create: `tests/fixtures/hook_payloads/02_session_start_new_project.json`
- Create: `tests/fixtures/hook_payloads/03_post_tool_use.json`
- Create: `tests/fixtures/hook_payloads/04_session_end_normal.json`
- Create: `tests/fixtures/hook_payloads/05_session_end_crash.json`
- Create: `tests/fixtures/transcripts/simple_session.jsonl`

**Step 1: Create fixture directory and sample payloads**

Each fixture is a JSON file that can be piped into the hook binary via stdin. Create representative samples covering: normal session, new project, resume, long transcript, API key in transcript.

Example `01_session_start_simple.json`:
```json
{
    "session_id": "test-session-001",
    "transcript_path": "/tmp/test-transcript.jsonl",
    "cwd": "/Users/test/projects/sample-project",
    "source": "startup"
}
```

Example `simple_session.jsonl`:
```jsonl
{"role":"user","type":"text","message":"Help me fix the sorting algorithm"}
{"role":"assistant","type":"text","message":"I see the issue in sort.py"}
{"role":"assistant","type":"tool_use","name":"Read","input":{"path":"sort.py"}}
{"role":"assistant","type":"text","message":"The comparison is reversed. Fixing now."}
{"role":"assistant","type":"tool_use","name":"Edit","input":{"path":"sort.py"}}
{"role":"user","type":"text","message":"Works! Thanks."}
```

**Step 2: Commit**

```bash
git add tests/
git commit -m "test: add golden fixture test data for hook payloads and transcripts"
```

---

### Task 23: Integration Tests

**Files:**
- Create: `tests/integration/session_lifecycle_test.rs`
- Create: `tests/integration/atomic_write_test.rs`

**Step 1: Create session lifecycle integration test**

```rust
// tests/integration/session_lifecycle_test.rs

use tempfile::TempDir;
use std::process::Command;

/// Tests need the binary to be built first:
/// cargo build -p ctx-lab-hook

#[test]
fn test_full_session_lifecycle() {
    // Build binary
    let build = Command::new("cargo")
        .args(["build", "-p", "ctx-lab-hook"])
        .output()
        .expect("cargo build failed");
    assert!(build.status.success());

    // The binary path
    let binary = env!("CARGO_BIN_EXE_ctx-lab-hook");

    // For now, verify the binary runs and --help works
    let output = Command::new(binary)
        .arg("--help")
        .output()
        .expect("binary execution failed");
    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("session-start"));
    assert!(stdout.contains("checkpoint"));
    assert!(stdout.contains("doctor"));
}
```

**Step 2: Create atomic write stress test**

```rust
// tests/integration/atomic_write_test.rs

use ctx_lab_core::storage;
use tempfile::TempDir;
use std::thread;

#[test]
fn test_concurrent_writes_no_corruption() {
    let tmp = TempDir::new().unwrap();
    let mut handles = vec![];

    for i in 0..10 {
        let dir = tmp.path().to_path_buf();
        handles.push(thread::spawn(move || {
            let path = dir.join(format!("file_{}.json", i));
            let data = serde_json::json!({"thread": i, "data": "x".repeat(1000)});
            storage::write_json(&path, &data).unwrap();

            // Verify it's valid JSON
            let content = std::fs::read_to_string(&path).unwrap();
            let _: serde_json::Value = serde_json::from_str(&content).unwrap();
        }));
    }

    for h in handles {
        h.join().unwrap();
    }
}
```

**Step 3: Run integration tests**

```bash
cargo test --test '*'
```

Expected: All integration tests PASS

**Step 4: Commit**

```bash
git add tests/
git commit -m "test: add integration tests for session lifecycle and concurrent atomic writes"
```

---

### Task 24: Build Verification + Final Polish

**Step 1: Run full test suite**

```bash
cargo test --workspace
```

Expected: All tests PASS

**Step 2: Build release binary**

```bash
cargo build --release -p ctx-lab-hook
ls -lh target/release/ctx-lab-hook
```

Expected: Binary exists, reasonable size (<10MB)

**Step 3: Verify binary runs**

```bash
./target/release/ctx-lab-hook --help
./target/release/ctx-lab-hook doctor
```

Expected: Help shows all subcommands, doctor runs without crash

**Step 4: Run clippy**

```bash
cargo clippy --workspace -- -D warnings
```

Fix any warnings.

**Step 5: Final commit**

```bash
git add -A
git commit -m "chore: fix clippy warnings and verify release build"
```

---

## Summary

| Task | Component | Est. Steps |
|------|-----------|-----------|
| 0 | Rust toolchain + git init | 5 |
| 1 | Cargo workspace scaffolding | 8 |
| 2 | errors.rs | 5 |
| 3 | models.rs | 5 |
| 4 | schema.rs | 5 |
| 5 | storage.rs (atomic write) | 5 |
| 6 | config.rs | 5 |
| 7 | queue.rs | 5 |
| 8 | sanitize.rs | 5 |
| 9 | roadmap.rs | 5 |
| 10 | claude_md.rs | 5 |
| 11 | git_ops.rs | 5 |
| 12 | transcript.rs | 5 |
| 13 | Hook CLI routing + stubs | 4 |
| 14 | install.rs | 5 |
| 15 | doctor.rs | 4 |
| 16 | session_start.rs | 5 |
| 17 | checkpoint.rs | 2 |
| 18 | stop.rs | 2 |
| 19 | session_end.rs | 2 |
| 20 | process_queue.rs | 2 |
| 21 | uninstall.rs | 2 |
| 22 | Golden fixtures | 2 |
| 23 | Integration tests | 4 |
| 24 | Build verification | 5 |
| **Total** | | **~112 steps** |
