// Support bundle module for seslog
// Export a ZIP with system info, logs, config, schema for diagnostics

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

/// Generate a support bundle ZIP.
pub fn generate_support_bundle(
    output_dir: &Path,
    seslog_dir: &Path,
    log_lines: usize,
) -> anyhow::Result<PathBuf> {
    fs::create_dir_all(output_dir)?;

    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let bundle_path = output_dir.join(format!("seslog-support-bundle-{}.zip", timestamp));

    let file = fs::File::create(&bundle_path)?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    // System info
    let system_info = get_system_info();
    zip.start_file("system-info.txt", options)?;
    zip.write_all(system_info.as_bytes())?;

    // Recent logs
    let logs = crate::logging::read_recent_logs(&seslog_dir.join("logs"), log_lines);
    if !logs.is_empty() {
        zip.start_file("recent-logs.txt", options)?;
        for line in &logs {
            zip.write_all(line.as_bytes())?;
            zip.write_all(b"\n")?;
        }
    }

    // Config (secrets masked)
    let config_path = seslog_dir.join("config.toml");
    if config_path.exists() {
        if let Ok(content) = fs::read_to_string(&config_path) {
            let masked = mask_secrets(&content);
            zip.start_file("config.toml", options)?;
            zip.write_all(masked.as_bytes())?;
        }
    }

    // Database schema (v2)
    zip.start_file("db-schema.sql", options)?;
    zip.write_all(DB_SCHEMA_V2.as_bytes())?;

    // Quarantine list (paths only, no content)
    let quarantine_dir = seslog_dir.join("quarantine");
    if quarantine_dir.exists() {
        let mut list = String::new();
        if let Ok(entries) = fs::read_dir(&quarantine_dir) {
            for entry in entries.flatten() {
                list.push_str(&entry.path().to_string_lossy());
                list.push('\n');
            }
        }
        if !list.is_empty() {
            zip.start_file("quarantine-list.txt", options)?;
            zip.write_all(list.as_bytes())?;
        }
    }

    // Version info
    let version_info = format!(
        "seslog {}\nBuilt: {}\n",
        env!("CARGO_PKG_VERSION"),
        chrono::Local::now().to_rfc3339()
    );
    zip.start_file("version.txt", options)?;
    zip.write_all(version_info.as_bytes())?;

    zip.finish()?;
    tracing::info!("Support bundle created: {:?}", bundle_path);
    Ok(bundle_path)
}

fn get_system_info() -> String {
    let mut info = String::new();
    info.push_str("=== System Information ===\n");
    info.push_str(&format!("OS: {}\n", std::env::consts::OS));
    info.push_str(&format!("Arch: {}\n", std::env::consts::ARCH));

    if let Ok(hostname) = hostname::get() {
        info.push_str(&format!("Hostname: {}\n", hostname.to_string_lossy()));
    }

    info.push_str("\n=== Seslog Info ===\n");
    info.push_str(&format!("Version: {}\n", env!("CARGO_PKG_VERSION")));

    let mut sys = sysinfo::System::new_all();
    sys.refresh_all();
    info.push_str(&format!(
        "Total Memory: {} MB\n",
        sys.total_memory() / 1024 / 1024
    ));
    info.push_str(&format!(
        "Used Memory: {} MB\n",
        sys.used_memory() / 1024 / 1024
    ));

    info
}

fn mask_secrets(content: &str) -> String {
    let mut result = content.to_string();
    let patterns = ["password", "token", "secret", "key", "api"];
    for pattern in patterns {
        if let Ok(re) = regex::Regex::new(&format!(r"(?i)({}[\s]*[=:]\s*)[^\s]+", pattern)) {
            result = re
                .replace_all(&result, |caps: &regex::Captures| {
                    format!("{}*****", &caps[1])
                })
                .to_string();
        }
    }
    result
}

/// Schema v2 snapshot (includes item_id, depends_on, token_count, estimated_cost_usd, model).
const DB_SCHEMA_V2: &str = r#"
-- Schema version 2

CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    archived_at TEXT,
    description TEXT DEFAULT '',
    total_sessions INTEGER DEFAULT 0,
    total_duration_minutes INTEGER DEFAULT 0,
    last_session_at TEXT,
    last_machine TEXT,
    progress_percent REAL DEFAULT 0.0,
    meta_toml_path TEXT
);

CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    machine TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    duration_minutes INTEGER,
    end_reason TEXT,
    summary TEXT DEFAULT '',
    summary_source TEXT DEFAULT 'unknown',
    next_steps TEXT DEFAULT '',
    files_changed INTEGER DEFAULT 0,
    recovered INTEGER DEFAULT 0,
    redaction_count INTEGER DEFAULT 0,
    source_path TEXT,
    token_count INTEGER DEFAULT 0,
    estimated_cost_usd REAL DEFAULT 0.0,
    model TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE roadmap_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    item_id TEXT DEFAULT '',
    depends_on TEXT DEFAULT '',
    phase TEXT,
    item_text TEXT NOT NULL,
    status TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE machines (
    hostname TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    registered_at TEXT NOT NULL
);

CREATE TABLE processed_events (
    event_file TEXT PRIMARY KEY,
    processed_at TEXT DEFAULT (datetime('now'))
);
"#;
