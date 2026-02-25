// Sync module for ctx-lab
// Git-based multi-machine synchronization

use std::path::Path;
use std::process::Command;

/// Sync result
#[derive(Debug, Clone)]
pub enum SyncResult {
    Synced,
    LocalOnly,                 // No remote configured
    Offline,                  // Network error
    ConflictNeedsManualFix(String),  // Conflict message
    Error(String),             // Other error
}

/// Sync on application startup - pull from remote
pub fn sync_on_startup(repo_path: &Path) -> SyncResult {
    // Check if .git exists
    if !repo_path.join(".git").exists() {
        tracing::info!("Not a git repository, skipping sync");
        return SyncResult::LocalOnly;
    }

    // Check if remote exists
    let remote_check = Command::new("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(repo_path)
        .output();

    match remote_check {
        Ok(output) if output.status.success() => {
            // Remote exists, try to pull
        }
        _ => {
            tracing::info!("No remote configured, skipping sync");
            return SyncResult::LocalOnly;
        }
    }

    // Pull changes
    let pull_result = Command::new("git")
        .args(["pull", "--rebase"])
        .current_dir(repo_path)
        .output();

    match pull_result {
        Ok(output) if output.status.success() => {
            tracing::info!("Pull completed successfully");
            SyncResult::Synced
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.contains("CONFLICT") || stderr.contains("conflict") {
                tracing::warn!("Sync conflict detected");
                SyncResult::ConflictNeedsManualFix(
                    "Sync conflict detected. Run 'git status' to resolve.".to_string()
                )
            } else if stderr.contains("network") || stderr.contains("Connection") {
                tracing::warn!("Network error during pull");
                SyncResult::Offline
            } else {
                tracing::warn!("Pull failed: {}", stderr);
                SyncResult::Error(stderr.to_string())
            }
        }
        Err(e) => {
            tracing::error!("Failed to run git pull: {}", e);
            SyncResult::Error(e.to_string())
        }
    }
}

/// Sync on session end - commit and push
pub fn sync_on_session_end(repo_path: &Path, commit_msg: &str) -> SyncResult {
    // Check if .git exists
    if !repo_path.join(".git").exists() {
        return SyncResult::LocalOnly;
    }

    // Check if remote exists
    let remote_check = Command::new("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(repo_path)
        .output();

    match remote_check {
        Ok(output) if output.status.success() => {
            // Remote exists
        }
        _ => {
            return SyncResult::LocalOnly;
        }
    }

    // Stage all changes
    let stage_result = Command::new("git")
        .args(["add", "-A"])
        .current_dir(repo_path)
        .output();

    if !stage_result.map(|o| o.status.success()).unwrap_or(false) {
        tracing::warn!("Failed to stage changes");
    }

    // Check if there are changes
    let status_result = Command::new("git")
        .args(["diff", "--cached", "--quiet"])
        .current_dir(repo_path)
        .output();

    let has_changes = status_result
        .map(|o| !o.status.success())
        .unwrap_or(true);

    if !has_changes {
        tracing::debug!("No changes to commit");
        return SyncResult::Synced;
    }

    // Create commit
    let msg = if commit_msg.is_empty() {
        "ctx-lab: session update"
    } else {
        commit_msg
    };

    let commit_result = Command::new("git")
        .args(["commit", "-m", msg])
        .current_dir(repo_path)
        .output();

    match commit_result {
        Ok(output) if output.status.success() => {
            tracing::info!("Commit created: {}", msg);
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            tracing::debug!("No commit needed or error: {}", stderr);
            // No changes to commit is not an error
            if stderr.contains("nothing to commit") {
                return SyncResult::Synced;
            }
        }
        Err(e) => {
            tracing::error!("Failed to create commit: {}", e);
            return SyncResult::Error(e.to_string());
        }
    }

    // Push
    let push_result = Command::new("git")
        .args(["push", "origin", "HEAD"])
        .current_dir(repo_path)
        .output();

    match push_result {
        Ok(output) if output.status.success() => {
            tracing::info!("Push completed successfully");
            SyncResult::Synced
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.contains("network") || stderr.contains("Connection") || stderr.contains("could not connect") {
                tracing::warn!("Network error during push, will retry on next startup");
                SyncResult::Offline
            } else {
                tracing::warn!("Push failed: {}", stderr);
                SyncResult::Error(stderr.to_string())
            }
        }
        Err(e) => {
            // Network errors are common, don't treat as critical
            tracing::warn!("Push error (will retry): {}", e);
            SyncResult::Offline
        }
    }
}

/// Check sync status
pub fn get_sync_status(repo_path: &Path) -> SyncStatus {
    if !repo_path.join(".git").exists() {
        return SyncStatus {
            is_repo: false,
            has_remote: false,
            last_sync: None,
            pending_changes: false,
        };
    }

    let has_remote = Command::new("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(repo_path)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    let status_output = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(repo_path)
        .output();

    let pending_changes = status_output
        .map(|o| !String::from_utf8_lossy(&o.stdout).trim().is_empty())
        .unwrap_or(false);

    // Get last push time from git log
    let last_push = Command::new("git")
        .args(["log", "-1", "--format=%ci", "-S", "HEAD"])
        .current_dir(repo_path)
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        });

    SyncStatus {
        is_repo: true,
        has_remote,
        last_sync: last_push,
        pending_changes,
    }
}

/// Sync status
#[derive(Debug, Clone, serde::Serialize)]
pub struct SyncStatus {
    pub is_repo: bool,
    pub has_remote: bool,
    pub last_sync: Option<String>,
    pub pending_changes: bool,
}

/// Initialize git repo if not exists
pub fn init_repo(repo_path: &Path) -> Result<(), String> {
    if repo_path.join(".git").exists() {
        return Ok(()); // Already a repo
    }

    // Initialize repo
    let result = Command::new("git")
        .args(["init"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !result.status.success() {
        return Err(String::from_utf8_lossy(&result.stderr).to_string());
    }

    Ok(())
}

/// Add remote
/// Get current machine profile
pub fn get_machine_profile() -> MachineProfile {
    let hostname = std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("HOST"))
        .unwrap_or_else(|_| "unknown".to_string());

    let platform = std::env::consts::OS.to_string();
    let arch = std::env::consts::ARCH.to_string();

    MachineProfile {
        hostname,
        platform,
        arch,
    }
}

/// Machine profile
#[derive(Debug, Clone, serde::Serialize)]
pub struct MachineProfile {
    pub hostname: String,
    pub platform: String,
    pub arch: String,
}

pub fn add_remote(repo_path: &Path, remote_url: &str) -> Result<(), String> {
    let result = Command::new("git")
        .args(["remote", "add", "origin", remote_url])
        .current_dir(repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !result.status.success() {
        return Err(String::from_utf8_lossy(&result.stderr).to_string());
    }

    Ok(())
}
