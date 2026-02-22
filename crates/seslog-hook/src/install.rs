use anyhow::Result;
use std::path::{Path, PathBuf};

pub fn run() -> Result<()> {
    eprintln!("[seslog] Installing hooks...");
    let binary_path = std::env::current_exe()?.to_string_lossy().to_string();
    let settings_path = claude_settings_path()?;
    let settings = read_settings(&settings_path)?;

    // Backup
    if settings_path.exists() {
        let backup = settings_path.with_extension("json.seslog-backup");
        std::fs::copy(&settings_path, &backup)?;
    }

    let patched = patch_hooks_into_settings(&settings, &binary_path);
    let json_str = serde_json::to_string_pretty(&patched)?;

    // Validate
    serde_json::from_str::<serde_json::Value>(&json_str)?;

    // Write
    if let Some(parent) = settings_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    seslog_core::storage::atomic_write(&settings_path, json_str.as_bytes())?;

    // Init data dir
    let base = seslog_core::storage::init_data_dir()?;

    // Default config
    let config_path = base.join("config.toml");
    if !config_path.exists() {
        seslog_core::config::write_config(&config_path, &seslog_core::config::AppConfig::default())?;
    }

    // .gitignore
    let gitignore = base.join(".gitignore");
    if !gitignore.exists() {
        seslog_core::storage::atomic_write(&gitignore, b"cache.db\n*.db-*\nqueue/\n.events/\n")?;
    }

    // Register machine
    register_machine(&base)?;

    // Create symlink at /usr/local/bin/seslog
    create_symlink(&binary_path)?;

    eprintln!("[seslog] Hooks installed successfully");
    Ok(())
}

fn claude_settings_path() -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("HOME not found"))?;
    Ok(home.join(".claude").join("settings.json"))
}

fn read_settings(path: &Path) -> Result<serde_json::Value> {
    match std::fs::read_to_string(path) {
        Ok(content) => Ok(serde_json::from_str(&content)?),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::json!({})),
        Err(e) => Err(e.into()),
    }
}

pub fn patch_hooks_into_settings(settings: &serde_json::Value, binary_path: &str) -> serde_json::Value {
    let mut patched = settings.clone();
    let hooks = patched.as_object_mut().unwrap()
        .entry("hooks").or_insert_with(|| serde_json::json!({}));

    let hook_defs = [
        ("SessionStart", "session-start"),
        ("PostToolUse", "checkpoint"),
        ("Stop", "stop"),
        ("SessionEnd", "session-end"),
    ];

    for (event, subcommand) in &hook_defs {
        let event_hooks = hooks.as_object_mut().unwrap()
            .entry(*event).or_insert_with(|| serde_json::json!([]));
        let arr = event_hooks.as_array_mut().unwrap();

        // Remove existing seslog/ctx-lab hooks — handles both old and new managed keys
        arr.retain(|entry| !is_seslog_managed(entry));

        // Claude Code hook format: each entry needs hooks array
        // matcher is omitted to match all occurrences (it's a regex string, not an object)
        arr.push(serde_json::json!({
            "hooks": [
                {
                    "type": "command",
                    "command": format!("{} {}", binary_path, subcommand),
                    "seslog-managed": true
                }
            ]
        }));
    }
    patched
}

/// Check if an event entry is seslog-managed.
/// Handles both old "ctx-lab-managed" key and new "seslog-managed" key,
/// plus both flat and nested hook formats for backward compatibility.
pub fn is_seslog_managed(entry: &serde_json::Value) -> bool {
    // Old flat format: {"type": "command", "ctx-lab-managed": true, ...}
    if entry.get("ctx-lab-managed").and_then(|v| v.as_bool()).unwrap_or(false) {
        return true;
    }
    // New flat format: {"type": "command", "seslog-managed": true, ...}
    if entry.get("seslog-managed").and_then(|v| v.as_bool()).unwrap_or(false) {
        return true;
    }
    // Nested format: {"hooks": [{"ctx-lab-managed": true, ...}]} or {"hooks": [{"seslog-managed": true, ...}]}
    if let Some(hooks) = entry.get("hooks").and_then(|h| h.as_array()) {
        return hooks.iter().any(|h| {
            h.get("ctx-lab-managed").and_then(|v| v.as_bool()).unwrap_or(false)
            || h.get("seslog-managed").and_then(|v| v.as_bool()).unwrap_or(false)
        });
    }
    false
}

fn register_machine(base: &Path) -> Result<()> {
    let hostname = hostname::get().map(|h| h.to_string_lossy().to_string()).unwrap_or_else(|_| "unknown".into());
    let machine = seslog_core::models::MachineProfile {
        schema_version: seslog_core::models::SCHEMA_VERSION,
        hostname: hostname.clone(),
        platform: std::env::consts::OS.into(),
        registered_at: chrono::Utc::now(),
    };
    let path = base.join("machines").join(format!("{}.toml", hostname));
    let content = toml::to_string_pretty(&machine)?;
    seslog_core::storage::atomic_write(&path, content.as_bytes())
}

fn create_symlink(binary_path: &str) -> Result<()> {
    let link_path = PathBuf::from("/usr/local/bin/seslog");
    if link_path.exists() || link_path.symlink_metadata().is_ok() {
        std::fs::remove_file(&link_path).ok();
    }
    match std::os::unix::fs::symlink(binary_path, &link_path) {
        Ok(()) => eprintln!("[seslog] Symlink created: /usr/local/bin/seslog -> {}", binary_path),
        Err(e) => eprintln!("[seslog] Could not create symlink at /usr/local/bin/seslog: {} (non-fatal)", e),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_patch_empty_settings() {
        let settings = serde_json::json!({});
        let patched = patch_hooks_into_settings(&settings, "/bin/seslog");
        let hooks = &patched["hooks"];

        for event in &["SessionStart", "PostToolUse", "Stop", "SessionEnd"] {
            let arr = hooks[*event].as_array().unwrap();
            assert_eq!(arr.len(), 1, "expected 1 entry for {}", event);
            // matcher should be omitted (not an empty object)
            assert!(arr[0].get("matcher").is_none(), "matcher should be omitted for {}", event);
            let inner = arr[0]["hooks"].as_array().unwrap();
            assert_eq!(inner.len(), 1);
            assert_eq!(inner[0]["type"], "command");
            assert!(inner[0]["seslog-managed"].as_bool().unwrap());
        }
    }

    #[test]
    fn test_patch_preserves_existing_hooks() {
        // Existing hook with string matcher (correct Claude Code format)
        let settings = serde_json::json!({
            "hooks": {
                "SessionStart": [
                    {
                        "matcher": "startup",
                        "hooks": [{"type": "command", "command": "echo existing"}]
                    }
                ]
            }
        });
        let patched = patch_hooks_into_settings(&settings, "/bin/seslog");
        let arr = patched["hooks"]["SessionStart"].as_array().unwrap();
        assert_eq!(arr.len(), 2, "existing hook + seslog hook");
        // First entry is the existing one (preserved)
        assert_eq!(arr[0]["hooks"][0]["command"], "echo existing");
        // Second entry is the seslog one
        assert!(arr[1]["hooks"][0]["seslog-managed"].as_bool().unwrap());
    }

    #[test]
    fn test_patch_idempotent() {
        let settings = serde_json::json!({});
        let first = patch_hooks_into_settings(&settings, "/bin/seslog");
        let second = patch_hooks_into_settings(&first, "/bin/seslog");
        let arr = second["hooks"]["SessionStart"].as_array().unwrap();
        let managed_count = arr.iter().filter(|entry| is_seslog_managed(entry)).count();
        assert_eq!(managed_count, 1, "should have exactly 1 seslog entry after double patch");
    }

    #[test]
    fn test_patch_migrates_old_ctx_lab_managed() {
        // Old format with "ctx-lab-managed" key should be detected and replaced
        let settings = serde_json::json!({
            "hooks": {
                "SessionStart": [
                    {
                        "hooks": [
                            {
                                "type": "command",
                                "command": "/old/path/ctx-lab-hook session-start",
                                "ctx-lab-managed": true
                            }
                        ]
                    }
                ]
            }
        });
        let patched = patch_hooks_into_settings(&settings, "/bin/seslog");
        let arr = patched["hooks"]["SessionStart"].as_array().unwrap();
        assert_eq!(arr.len(), 1, "old ctx-lab entry should be replaced");
        // New entry should have seslog-managed key
        let inner = arr[0]["hooks"].as_array().unwrap();
        assert_eq!(inner.len(), 1);
        assert_eq!(inner[0]["command"], "/bin/seslog session-start");
        assert!(inner[0]["seslog-managed"].as_bool().unwrap());
        assert!(inner[0].get("ctx-lab-managed").is_none());
    }

    #[test]
    fn test_patch_migrates_old_flat_format() {
        // Old flat format that ctx-lab previously wrote (before fix)
        let settings = serde_json::json!({
            "hooks": {
                "SessionStart": [
                    {
                        "type": "command",
                        "command": "/old/path/ctx-lab-hook session-start",
                        "ctx-lab-managed": true
                    }
                ]
            }
        });
        let patched = patch_hooks_into_settings(&settings, "/bin/seslog");
        let arr = patched["hooks"]["SessionStart"].as_array().unwrap();
        assert_eq!(arr.len(), 1, "old flat entry should be replaced");
        // New entry should be in nested format with seslog-managed
        let inner = arr[0]["hooks"].as_array().unwrap();
        assert_eq!(inner.len(), 1);
        assert_eq!(inner[0]["command"], "/bin/seslog session-start");
        assert!(inner[0]["seslog-managed"].as_bool().unwrap());
    }

    #[test]
    fn test_is_seslog_managed_detects_both_keys() {
        // New key
        let new_entry = serde_json::json!({
            "hooks": [{"type": "command", "seslog-managed": true}]
        });
        assert!(is_seslog_managed(&new_entry));

        // Old key
        let old_entry = serde_json::json!({
            "hooks": [{"type": "command", "ctx-lab-managed": true}]
        });
        assert!(is_seslog_managed(&old_entry));

        // Unmanaged
        let unmanaged = serde_json::json!({
            "hooks": [{"type": "command", "command": "echo hi"}]
        });
        assert!(!is_seslog_managed(&unmanaged));
    }
}
