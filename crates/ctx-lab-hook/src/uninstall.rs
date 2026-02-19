use anyhow::Result;

pub fn run() -> Result<()> {
    eprintln!("[ctx-lab] Uninstalling hooks...");
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

    if let Some(hooks) = settings.get_mut("hooks").and_then(|h| h.as_object_mut()) {
        for (_event, event_hooks) in hooks.iter_mut() {
            if let Some(arr) = event_hooks.as_array_mut() {
                // Handles both old flat format and new nested format
                arr.retain(|entry| !crate::install::is_ctx_lab_managed(entry));
            }
        }
    }

    let json_str = serde_json::to_string_pretty(&settings)?;
    ctx_lab_core::storage::atomic_write(&settings_path, json_str.as_bytes())?;
    eprintln!("[ctx-lab] Hooks removed from settings.json");
    eprintln!("[ctx-lab] Data preserved at ~/.ctx-lab/ (delete manually if desired)");
    Ok(())
}
