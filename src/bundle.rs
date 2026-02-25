// Support bundle module for ctx-lab
// Export debugging information

use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

/// Generate support bundle
pub fn generate_support_bundle(
    output_dir: &PathBuf,
    ctx_lab_dir: &PathBuf,
    db_path: &PathBuf,
    log_lines: usize,
) -> anyhow::Result<PathBuf> {
    fs::create_dir_all(output_dir)?;

    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let bundle_path = output_dir.join(format!("ctx-lab-support-bundle-{}.zip", timestamp));

    let file = File::create(&bundle_path)?;
    let mut zip = ZipWriter::new(file);

    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    // Add system info
    let system_info = get_system_info();
    zip.start_file("system-info.txt", options)?;
    zip.write_all(system_info.as_bytes())?;

    // Add recent logs
    let logs = crate::logging::read_recent_logs(&ctx_lab_dir.join("logs"), log_lines);
    if !logs.is_empty() {
        zip.start_file("recent-logs.txt", options)?;
        for line in logs {
            zip.write_all(line.as_bytes())?;
            zip.write_all(b"\n")?;
        }
    }

    // Add config (masked)
    let config_path = ctx_lab_dir.join("config.toml");
    if config_path.exists() {
        if let Ok(content) = fs::read_to_string(&config_path) {
            let masked = mask_secrets(&content);
            zip.start_file("config.toml", options)?;
            zip.write_all(masked.as_bytes())?;
        }
    }

    // Add database schema
    let schema = get_db_schema();
    zip.start_file("db-schema.sql", options)?;
    zip.write_all(schema.as_bytes())?;

    // Add quarantine list (just paths, not content)
    let quarantine_dir = ctx_lab_dir.join("quarantine");
    if quarantine_dir.exists() {
        let mut quarantine_list = String::new();
        if let Ok(entries) = fs::read_dir(&quarantine_dir) {
            for entry in entries.flatten() {
                quarantine_list.push_str(&entry.path().to_string_lossy());
                quarantine_list.push('\n');
            }
        }
        zip.start_file("quarantine-list.txt", options)?;
        zip.write_all(quarantine_list.as_bytes())?;
    }

    // Add version info
    let version_info = format!(
        "ctx-lab {}\nBuilt: {}\n",
        env!("CARGO_PKG_VERSION"),
        chrono::Local::now().to_rfc3339()
    );
    zip.start_file("version.txt", options)?;
    zip.write_all(version_info.as_bytes())?;

    zip.finish()?;

    tracing::info!("Support bundle created: {:?}", bundle_path);
    Ok(bundle_path)
}

/// Get system information
fn get_system_info() -> String {
    let mut info = String::new();

    info.push_str("=== System Information ===\n");
    info.push_str(&format!("OS: {}\n", std::env::consts::OS));
    info.push_str(&format!("Arch: {}\n", std::env::consts::ARCH));

    // Hostname
    if let Ok(hostname) = hostname::get() {
        info.push_str(&format!("Hostname: {}\n", hostname.to_string_lossy()));
    }

    info.push_str("\n=== ctx-lab Info ===\n");
    info.push_str(&format!("Version: {}\n", env!("CARGO_PKG_VERSION")));

    // Memory info
    let mut sys = sysinfo::System::new_all();
    sys.refresh_all();
    info.push_str(&format!("Total Memory: {} MB\n", sys.total_memory() / 1024 / 1024));
    info.push_str(&format!("Used Memory: {} MB\n", sys.used_memory() / 1024 / 1024));

    info
}

/// Mask secrets in config
fn mask_secrets(content: &str) -> String {
    let mut result = content.to_string();
    let patterns = ["password", "token", "secret", "key", "api"];

    for pattern in patterns {
        // Mask values after = sign
        let re = regex::Regex::new(&format!(r"(?i)({}:\s*)[^\s]+", pattern)).unwrap();
        result = re.replace_all(&result, |caps: &regex::Captures| {
            format!("{}*****", &caps[1])
        }).to_string();
    }

    result
}

/// Get database schema
fn get_db_schema() -> String {
    r#"
-- Projects table
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

-- Sessions table
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
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- Roadmap items
CREATE TABLE roadmap_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    phase TEXT,
    item_text TEXT NOT NULL,
    status TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- Machines
CREATE TABLE machines (
    hostname TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    registered_at TEXT NOT NULL
);

-- Processed events
CREATE TABLE processed_events (
    event_file TEXT PRIMARY KEY,
    processed_at TEXT DEFAULT (datetime('now'))
);
"#
    .to_string()
}
