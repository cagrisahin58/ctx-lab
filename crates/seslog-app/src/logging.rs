// Log module for seslog
// Handles log file rotation

use std::fs;
use std::io::BufRead;
use std::path::{Path, PathBuf};

const LOG_FILE: &str = "seslog.log";

/// Initialize logging directory and rotate if current log exceeds max_size_mb.
pub fn init_logging(log_dir: &Path, max_size_mb: u64, max_files: u32) -> anyhow::Result<()> {
    fs::create_dir_all(log_dir)?;

    let log_path = log_dir.join(LOG_FILE);
    if let Ok(metadata) = fs::metadata(&log_path) {
        let size_mb = metadata.len() / (1024 * 1024);
        if size_mb >= max_size_mb {
            rotate_logs(log_dir, max_files)?;
        }
    }

    Ok(())
}

/// Rotate log files: seslog.log → seslog.1.log → seslog.2.log → …
pub fn rotate_logs(log_dir: &Path, max_files: u32) -> anyhow::Result<()> {
    let log_path = log_dir.join(LOG_FILE);

    // Shift existing numbered files
    for i in (1..max_files).rev() {
        let old = log_dir.join(format!("seslog.{}.log", i));
        let new = log_dir.join(format!("seslog.{}.log", i + 1));

        if old.exists() {
            if i >= max_files - 1 {
                fs::remove_file(&old)?;
            } else {
                fs::rename(&old, &new)?;
            }
        }
    }

    // Move current to .1
    if log_path.exists() {
        fs::rename(&log_path, log_dir.join("seslog.1.log"))?;
    }

    Ok(())
}

/// Get log file path.
pub fn get_log_path(log_dir: &Path) -> PathBuf {
    log_dir.join(LOG_FILE)
}

/// Read the last `lines` lines from the current log file.
pub fn read_recent_logs(log_dir: &Path, lines: usize) -> Vec<String> {
    let log_path = get_log_path(log_dir);
    let file = match fs::File::open(&log_path) {
        Ok(f) => f,
        Err(_) => return vec![],
    };

    let all: Vec<String> = std::io::BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .collect();

    // Take last N lines
    let skip = all.len().saturating_sub(lines);
    all.into_iter().skip(skip).collect()
}
