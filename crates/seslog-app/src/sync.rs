// Sync module for seslog
// Git-based multi-machine synchronization
// Uses seslog_core::git_ops for pull/push, adds status & repo init helpers

use std::path::Path;
use std::process::Command;

pub use seslog_core::git_ops::SyncResult;

/// Sync on application startup — pull from remote.
pub fn sync_on_startup(repo_path: &Path) -> SyncResult {
    if !seslog_core::git_ops::is_git_repo(repo_path) {
        tracing::info!("Not a git repository, skipping sync");
        return SyncResult::LocalOnly;
    }

    match seslog_core::git_ops::sync_pull(repo_path) {
        Ok(result) => {
            match &result {
                SyncResult::Synced => tracing::info!("Pull completed successfully"),
                SyncResult::LocalOnly => tracing::info!("No remote configured, skipping sync"),
                SyncResult::NothingToCommit => tracing::debug!("Nothing to pull"),
                SyncResult::Offline(msg) => tracing::warn!("Network error during pull: {}", msg),
                SyncResult::Conflict(msg) => tracing::warn!("Sync conflict: {}", msg),
            }
            result
        }
        Err(e) => {
            tracing::error!("Sync pull failed: {}", e);
            SyncResult::Offline(e.to_string())
        }
    }
}

/// Sync on session end — commit and push.
pub fn sync_on_session_end(repo_path: &Path, commit_msg: &str) -> SyncResult {
    if !seslog_core::git_ops::is_git_repo(repo_path) {
        return SyncResult::LocalOnly;
    }

    let msg = if commit_msg.is_empty() {
        "seslog: session update"
    } else {
        commit_msg
    };

    match seslog_core::git_ops::sync_push(repo_path, msg) {
        Ok(result) => {
            match &result {
                SyncResult::Synced => tracing::info!("Push completed successfully"),
                SyncResult::NothingToCommit => tracing::debug!("Nothing to commit"),
                SyncResult::Offline(msg) => tracing::warn!("Push offline (will retry): {}", msg),
                _ => {}
            }
            result
        }
        Err(e) => {
            tracing::warn!("Push error (will retry): {}", e);
            SyncResult::Offline(e.to_string())
        }
    }
}

/// Check sync status for display in the UI.
pub fn get_sync_status(repo_path: &Path) -> SyncStatus {
    if !seslog_core::git_ops::is_git_repo(repo_path) {
        return SyncStatus {
            is_repo: false,
            has_remote: false,
            last_sync: None,
            pending_changes: false,
        };
    }

    let has_remote = seslog_core::git_ops::has_remote(repo_path);

    let pending_changes = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(repo_path)
        .output()
        .map(|o| !String::from_utf8_lossy(&o.stdout).trim().is_empty())
        .unwrap_or(false);

    let last_sync = Command::new("git")
        .args(["log", "-1", "--format=%ci"])
        .current_dir(repo_path)
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
                if s.is_empty() { None } else { Some(s) }
            } else {
                None
            }
        });

    SyncStatus {
        is_repo: true,
        has_remote,
        last_sync,
        pending_changes,
    }
}

/// Sync status for UI display.
#[derive(Debug, Clone, serde::Serialize)]
pub struct SyncStatus {
    pub is_repo: bool,
    pub has_remote: bool,
    pub last_sync: Option<String>,
    pub pending_changes: bool,
}

/// Initialize git repo if not already one.
pub fn init_repo(repo_path: &Path) -> Result<(), String> {
    if seslog_core::git_ops::is_git_repo(repo_path) {
        return Ok(());
    }

    Command::new("git")
        .args(["init"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| e.to_string())
        .and_then(|output| {
            if output.status.success() {
                Ok(())
            } else {
                Err(String::from_utf8_lossy(&output.stderr).to_string())
            }
        })
}

/// Add a remote origin to the repo.
pub fn add_remote(repo_path: &Path, remote_url: &str) -> Result<(), String> {
    Command::new("git")
        .args(["remote", "add", "origin", remote_url])
        .current_dir(repo_path)
        .output()
        .map_err(|e| e.to_string())
        .and_then(|output| {
            if output.status.success() {
                Ok(())
            } else {
                Err(String::from_utf8_lossy(&output.stderr).to_string())
            }
        })
}

/// Machine profile for sync identification.
#[derive(Debug, Clone, serde::Serialize)]
pub struct MachineProfile {
    pub hostname: String,
    pub platform: String,
    pub arch: String,
}

/// Get current machine profile.
pub fn get_machine_profile() -> MachineProfile {
    let hostname = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "unknown".to_string());

    MachineProfile {
        hostname,
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}
