use std::path::Path;
use anyhow::Result;

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
}
