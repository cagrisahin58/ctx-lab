use std::path::Path;
use std::process::Command;
use anyhow::Result;

/// Outcome of a git sync operation.
///
/// All variants are non-fatal — the caller should log but never block on sync failures.
#[derive(Debug, PartialEq)]
pub enum SyncResult {
    Synced,
    /// No remote configured; repo is local-only.
    LocalOnly,
    /// Working tree is clean, nothing to commit.
    NothingToCommit,
    /// Network unreachable or transient git error. Contains stderr.
    Offline(String),
    /// Rebase conflict that requires manual resolution. Contains instructions.
    Conflict(String),
}

/// Returns `true` if the git repository at `path` has at least one remote configured.
pub fn has_remote(path: &Path) -> bool {
    let repo = match git2::Repository::discover(path) {
        Ok(r) => r,
        Err(_) => return false,
    };
    match repo.remotes() {
        Ok(remotes) => !remotes.is_empty(),
        Err(_) => false,
    }
}

/// Pulls latest changes from the remote using `git pull --rebase --autostash`.
///
/// Returns `LocalOnly` when no remote is configured, `Conflict` when rebase hits conflicts,
/// and `Offline` for any network or other non-fatal errors.
pub fn sync_pull(repo_path: &Path) -> Result<SyncResult> {
    if !has_remote(repo_path) {
        return Ok(SyncResult::LocalOnly);
    }

    let output = Command::new("git")
        .args(["pull", "--rebase", "--autostash"])
        .current_dir(repo_path)
        .output()?;

    if output.status.success() {
        return Ok(SyncResult::Synced);
    }

    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if stderr.contains("CONFLICT") || stderr.contains("conflict") {
        // Abort the failed rebase so the repo is not left in a broken state.
        let _ = Command::new("git")
            .args(["rebase", "--abort"])
            .current_dir(repo_path)
            .output();

        return Ok(SyncResult::Conflict(format!(
            "Sync conflict. Fix manually:\n  cd {} && git status",
            repo_path.display()
        )));
    }

    Ok(SyncResult::Offline(stderr))
}

/// Stages all changes, commits with `commit_msg`, and pushes to the remote.
///
/// Returns `LocalOnly` when no remote is configured, `NothingToCommit` when the
/// working tree is clean, and `Offline` for any transient failure (the commit
/// remains local and will be pushed on the next startup pull).
pub fn sync_push(repo_path: &Path, commit_msg: &str) -> Result<SyncResult> {
    if !has_remote(repo_path) {
        return Ok(SyncResult::LocalOnly);
    }

    // Stage all changes.
    let add_output = Command::new("git")
        .args(["add", "."])
        .current_dir(repo_path)
        .output()?;

    if !add_output.status.success() {
        let stderr = String::from_utf8_lossy(&add_output.stderr).to_string();
        return Ok(SyncResult::Offline(stderr));
    }

    // Check if anything is staged.
    let diff_output = Command::new("git")
        .args(["diff", "--cached", "--quiet"])
        .current_dir(repo_path)
        .output()?;

    if diff_output.status.success() {
        // Exit code 0 means no differences — nothing to commit.
        return Ok(SyncResult::NothingToCommit);
    }

    // Commit.
    let commit_output = Command::new("git")
        .args(["commit", "-m", commit_msg])
        .current_dir(repo_path)
        .output()?;

    if !commit_output.status.success() {
        let stderr = String::from_utf8_lossy(&commit_output.stderr).to_string();
        return Ok(SyncResult::Offline(stderr));
    }

    // Push.
    let push_output = Command::new("git")
        .args(["push"])
        .current_dir(repo_path)
        .output()?;

    if !push_output.status.success() {
        let stderr = String::from_utf8_lossy(&push_output.stderr).to_string();
        return Ok(SyncResult::Offline(stderr));
    }

    Ok(SyncResult::Synced)
}

pub fn is_git_repo(path: &Path) -> bool {
    git2::Repository::discover(path).is_ok()
}

pub fn diff_stat(cwd: &Path) -> Result<Option<String>> {
    let repo = match git2::Repository::discover(cwd) {
        Ok(r) => r,
        Err(_) => return Ok(None),
    };
    let head = match repo.head() {
        Ok(h) => h,
        Err(_) => return Ok(None),
    };
    let head_tree = head.peel_to_tree()?;
    let diff = repo.diff_tree_to_workdir_with_index(Some(&head_tree), None)?;
    let stats = diff.stats()?;
    let files = stats.files_changed();
    if files == 0 { return Ok(None); }
    Ok(Some(format!("+{} -{} across {} file(s)", stats.insertions(), stats.deletions(), files)))
}

pub fn recent_commits(cwd: &Path, max: usize) -> Result<Vec<String>> {
    let repo = git2::Repository::discover(cwd)?;
    let mut revwalk = repo.revwalk()?;
    revwalk.push_head()?;
    revwalk.set_sorting(git2::Sort::TIME)?;
    let mut commits = Vec::new();
    for oid in revwalk.take(max) {
        let oid = oid?;
        let commit = repo.find_commit(oid)?;
        commits.push(commit.summary().unwrap_or("(no message)").to_string());
    }
    Ok(commits)
}

pub fn changed_files(cwd: &Path) -> Result<Vec<String>> {
    let repo = match git2::Repository::discover(cwd) {
        Ok(r) => r,
        Err(_) => return Ok(vec![]),
    };
    let head = match repo.head() {
        Ok(h) => h,
        Err(_) => return Ok(vec![]),
    };
    let head_tree = head.peel_to_tree()?;
    let diff = repo.diff_tree_to_workdir_with_index(Some(&head_tree), None)?;
    let mut files = Vec::new();
    diff.foreach(&mut |delta, _| {
        if let Some(path) = delta.new_file().path() {
            files.push(path.to_string_lossy().to_string());
        }
        true
    }, None, None, None)?;
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use std::process::Command;

    fn init_test_repo() -> TempDir {
        let tmp = TempDir::new().unwrap();
        Command::new("git").args(["init"]).current_dir(tmp.path()).output().unwrap();
        Command::new("git").args(["config", "user.email", "test@test.com"]).current_dir(tmp.path()).output().unwrap();
        Command::new("git").args(["config", "user.name", "Test"]).current_dir(tmp.path()).output().unwrap();
        std::fs::write(tmp.path().join("file.txt"), "hello").unwrap();
        Command::new("git").args(["add", "."]).current_dir(tmp.path()).output().unwrap();
        Command::new("git").args(["commit", "-m", "initial"]).current_dir(tmp.path()).output().unwrap();
        tmp
    }

    #[test]
    fn test_is_git_repo_true() {
        let tmp = init_test_repo();
        assert!(is_git_repo(tmp.path()));
    }

    #[test]
    fn test_is_git_repo_false() {
        let tmp = TempDir::new().unwrap();
        assert!(!is_git_repo(tmp.path()));
    }

    #[test]
    fn test_diff_stat_no_changes() {
        let tmp = init_test_repo();
        let stat = diff_stat(tmp.path()).unwrap();
        assert!(stat.is_none());
    }

    #[test]
    fn test_diff_stat_with_changes() {
        let tmp = init_test_repo();
        std::fs::write(tmp.path().join("file.txt"), "modified").unwrap();
        let stat = diff_stat(tmp.path()).unwrap();
        assert!(stat.is_some());
    }

    #[test]
    fn test_recent_commits() {
        let tmp = init_test_repo();
        let commits = recent_commits(tmp.path(), 5).unwrap();
        assert!(!commits.is_empty());
        assert!(commits[0].contains("initial"));
    }

    // --- sync tests ---

    #[test]
    fn test_has_remote_false() {
        let tmp = init_test_repo();
        assert!(!has_remote(tmp.path()));
    }

    #[test]
    fn test_has_remote_true() {
        let tmp = init_test_repo();
        // Create a bare remote and add it as origin.
        let bare = TempDir::new().unwrap();
        Command::new("git")
            .args(["init", "--bare"])
            .current_dir(bare.path())
            .output()
            .unwrap();
        Command::new("git")
            .args(["remote", "add", "origin", &bare.path().to_string_lossy()])
            .current_dir(tmp.path())
            .output()
            .unwrap();
        assert!(has_remote(tmp.path()));
    }

    #[test]
    fn test_sync_pull_no_remote_returns_local_only() {
        let tmp = init_test_repo();
        let result = sync_pull(tmp.path()).unwrap();
        assert_eq!(result, SyncResult::LocalOnly);
    }

    #[test]
    fn test_sync_push_no_remote_returns_local_only() {
        let tmp = init_test_repo();
        let result = sync_push(tmp.path(), "test commit").unwrap();
        assert_eq!(result, SyncResult::LocalOnly);
    }

    #[test]
    fn test_sync_push_commits_and_pushes() {
        // 1. Create a bare remote.
        let bare = TempDir::new().unwrap();
        Command::new("git")
            .args(["init", "--bare"])
            .current_dir(bare.path())
            .output()
            .unwrap();

        // 2. Clone the bare remote into a workdir.
        let workdir = TempDir::new().unwrap();
        Command::new("git")
            .args(["clone", &bare.path().to_string_lossy(), "."])
            .current_dir(workdir.path())
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(workdir.path())
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(workdir.path())
            .output()
            .unwrap();

        // Create an initial commit so we have a branch to push to.
        std::fs::write(workdir.path().join("seed.txt"), "seed").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(workdir.path())
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", "seed"])
            .current_dir(workdir.path())
            .output()
            .unwrap();
        Command::new("git")
            .args(["push", "-u", "origin", "HEAD"])
            .current_dir(workdir.path())
            .output()
            .unwrap();

        // 3. Write a new file and sync_push.
        std::fs::write(workdir.path().join("new.txt"), "data").unwrap();
        let result = sync_push(workdir.path(), "sync: add new.txt").unwrap();
        assert_eq!(result, SyncResult::Synced);

        // 4. Verify the commit arrived in the bare remote.
        let log_output = Command::new("git")
            .args(["log", "--oneline"])
            .current_dir(bare.path())
            .output()
            .unwrap();
        let log_text = String::from_utf8_lossy(&log_output.stdout);
        assert!(
            log_text.contains("sync: add new.txt"),
            "Expected commit message in remote log, got: {}",
            log_text
        );
    }
}
