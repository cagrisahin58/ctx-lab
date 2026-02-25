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
        let cfg = load_config(&tmp.path().join("nonexistent.toml")).unwrap();
        assert_eq!(cfg.privacy_mode, "full");
    }

    #[test]
    fn test_config_partial_toml_uses_defaults() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("partial.toml");
        std::fs::write(&path, "privacy_mode = \"full\"\n").unwrap();
        let cfg = load_config(&path).unwrap();
        assert_eq!(cfg.checkpoint_interval_minutes, 10);
    }
}
