// Log module for ctx-lab
// Handles log rotation

use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::time::Duration;

/// Initialize logging with rotation
pub fn init_logging(log_dir: &PathBuf, max_size_mb: u64, max_files: u32) -> anyhow::Result<()> {
    fs::create_dir_all(log_dir)?;

    let log_path = log_dir.join("ctx-lab.log");

    // Check current log size
    if let Ok(metadata) = fs::metadata(&log_path) {
        let size_mb = metadata.len() / (1024 * 1024);
        if size_mb >= max_size_mb {
            rotate_logs(log_dir, max_files)?;
        }
    }

    Ok(())
}

/// Rotate logs
pub fn rotate_logs(log_dir: &PathBuf, max_files: u32) -> anyhow::Result<()> {
    let log_path = log_dir.join("ctx-lab.log");

    // Rotate existing files
    for i in (1..max_files).rev() {
        let old_path = log_dir.join(format!("ctx-lab.{}.log", i));
        let new_path = log_dir.join(format!("ctx-lab.{}.log", i + 1));

        if old_path.exists() {
            if i >= max_files - 1 {
                fs::remove_file(&old_path)?; // Delete oldest
            } else {
                fs::rename(&old_path, &new_path)?;
            }
        }
    }

    // Rename current to .1
    if log_path.exists() {
        let new_path = log_dir.join("ctx-lab.1.log");
        fs::rename(&log_path, &new_path)?;
    }

    Ok(())
}

/// Get log file path
pub fn get_log_path(log_dir: &PathBuf) -> PathBuf {
    log_dir.join("ctx-lab.log")
}

/// Read recent log lines
pub fn read_recent_logs(log_dir: &PathBuf, lines: usize) -> Vec<String> {
    let log_path = get_log_path(log_dir);

    let file = match File::open(&log_path) {
        Ok(f) => f,
        Err(_) => return vec![],
    };

    let reader = BufReader::new(file);
    let all_lines: Vec<String> = reader.lines()
        .filter_map(|l| l.ok())
        .collect();

    all_lines.into_iter()
        .rev()
        .take(lines)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect()
}
