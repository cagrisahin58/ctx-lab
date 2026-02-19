use anyhow::Result;
use std::path::{Path, PathBuf};

pub fn run() -> Result<()> {
    eprintln!("[ctx-lab] Installing hooks...");
    let binary_path = std::env::current_exe()?.to_string_lossy().to_string();
    let settings_path = claude_settings_path()?;
    let settings = read_settings(&settings_path)?;

    // Backup
    if settings_path.exists() {
        let backup = settings_path.with_extension("json.ctx-lab-backup");
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
    ctx_lab_core::storage::atomic_write(&settings_path, json_str.as_bytes())?;

    // Init data dir
    let base = ctx_lab_core::storage::init_data_dir()?;

    // Default config
    let config_path = base.join("config.toml");
    if !config_path.exists() {
        ctx_lab_core::config::write_config(&config_path, &ctx_lab_core::config::AppConfig::default())?;
    }

    // .gitignore
    let gitignore = base.join(".gitignore");
    if !gitignore.exists() {
        ctx_lab_core::storage::atomic_write(&gitignore, b"cache.db\n*.db-*\nqueue/\n.events/\n")?;
    }

    // Register machine
    register_machine(&base)?;

    eprintln!("[ctx-lab] Hooks installed successfully");
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

        // Remove existing ctx-lab hooks (idempotency)
        arr.retain(|h| !h.get("ctx-lab-managed").and_then(|v| v.as_bool()).unwrap_or(false));

        arr.push(serde_json::json!({
            "type": "command",
            "command": format!("{} {}", binary_path, subcommand),
            "ctx-lab-managed": true
        }));
    }
    patched
}

fn register_machine(base: &Path) -> Result<()> {
    let hostname = hostname::get().map(|h| h.to_string_lossy().to_string()).unwrap_or_else(|_| "unknown".into());
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_patch_empty_settings() {
        let settings = serde_json::json!({});
        let patched = patch_hooks_into_settings(&settings, "/bin/ctx-lab-hook");
        let hooks = &patched["hooks"];
        assert!(hooks["SessionStart"].is_array());
        assert!(hooks["PostToolUse"].is_array());
        assert!(hooks["Stop"].is_array());
        assert!(hooks["SessionEnd"].is_array());
    }

    #[test]
    fn test_patch_preserves_existing_hooks() {
        let settings = serde_json::json!({
            "hooks": { "SessionStart": [{"type": "command", "command": "echo existing"}] }
        });
        let patched = patch_hooks_into_settings(&settings, "/bin/ctx-lab-hook");
        let arr = patched["hooks"]["SessionStart"].as_array().unwrap();
        assert!(arr.len() >= 2);
    }

    #[test]
    fn test_patch_idempotent() {
        let settings = serde_json::json!({});
        let first = patch_hooks_into_settings(&settings, "/bin/ctx-lab-hook");
        let second = patch_hooks_into_settings(&first, "/bin/ctx-lab-hook");
        let arr = second["hooks"]["SessionStart"].as_array().unwrap();
        let ctx_count = arr.iter().filter(|h| h.get("ctx-lab-managed").and_then(|v| v.as_bool()).unwrap_or(false)).count();
        assert_eq!(ctx_count, 1);
    }
}
