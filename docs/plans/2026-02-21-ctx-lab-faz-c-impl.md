# ctx-lab Faz C: Git-Based Sync — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `~/.ctx-lab/` dizinini git repo olarak kullanıp, startup'ta pull + session-end'de commit+push ile multi-machine sync sağlamak.

**Architecture:** Mevcut `ctx-lab-core::git_ops` modülüne 3 fonksiyon eklenir: `sync_pull`, `sync_push`, `has_remote`. Hook binary'de session-start'ta pull, session-end'de push çağrılır. State machine YOK, retry YOK, offline queue YOK. Conflict olursa kullanıcıya "git status ile çöz" mesajı verilir.

**Tech Stack:** git2 crate (zaten dependency), mevcut `ctx_lab_core::git_ops`

---

## Task 0: sync_pull + sync_push + has_remote fonksiyonları (core)

**Files:**
- Modify: `crates/ctx-lab-core/src/git_ops.rs`

**Step 1: Write failing tests**

```rust
// git_ops.rs içine, mevcut testlerin altına ekle:

#[test]
fn test_has_remote_false() {
    let tmp = init_test_repo();
    assert!(!has_remote(tmp.path()));
}

#[test]
fn test_has_remote_true() {
    let tmp = init_test_repo();
    // bare remote oluştur
    let remote_dir = TempDir::new().unwrap();
    Command::new("git").args(["init", "--bare"]).current_dir(remote_dir.path()).output().unwrap();
    Command::new("git").args(["remote", "add", "origin", &remote_dir.path().to_string_lossy()])
        .current_dir(tmp.path()).output().unwrap();
    assert!(has_remote(tmp.path()));
}

#[test]
fn test_sync_pull_no_remote_returns_local_only() {
    let tmp = init_test_repo();
    let result = sync_pull(tmp.path());
    assert!(result.is_ok());
    assert!(matches!(result.unwrap(), SyncResult::LocalOnly));
}

#[test]
fn test_sync_push_no_remote_returns_local_only() {
    let tmp = init_test_repo();
    let result = sync_push(tmp.path(), "test commit");
    assert!(result.is_ok());
    assert!(matches!(result.unwrap(), SyncResult::LocalOnly));
}

#[test]
fn test_sync_push_commits_and_pushes() {
    // bare remote + clone
    let remote_dir = TempDir::new().unwrap();
    Command::new("git").args(["init", "--bare"]).current_dir(remote_dir.path()).output().unwrap();
    let work_dir = TempDir::new().unwrap();
    Command::new("git").args(["clone", &remote_dir.path().to_string_lossy(), "."])
        .current_dir(work_dir.path()).output().unwrap();
    Command::new("git").args(["config", "user.email", "test@test.com"]).current_dir(work_dir.path()).output().unwrap();
    Command::new("git").args(["config", "user.name", "Test"]).current_dir(work_dir.path()).output().unwrap();
    // Yeni dosya ekle
    std::fs::write(work_dir.path().join("session.json"), "{}").unwrap();
    let result = sync_push(work_dir.path(), "test: add session").unwrap();
    assert!(matches!(result, SyncResult::Synced));
    // Remote'ta commit var mı kontrol et
    let output = Command::new("git").args(["log", "--oneline"])
        .current_dir(remote_dir.path()).output().unwrap();
    assert!(String::from_utf8_lossy(&output.stdout).contains("test: add session"));
}
```

**Step 2: Run tests, verify fail**

Run: `cargo test -p ctx-lab-core -- test_has_remote -v`
Expected: FAIL — `has_remote`, `sync_pull`, `sync_push`, `SyncResult` tanımsız

**Step 3: Implement**

`git_ops.rs`'e ekle:

```rust
#[derive(Debug, PartialEq)]
pub enum SyncResult {
    Synced,
    LocalOnly,
    NothingToCommit,
    Offline(String),
    Conflict(String),
}

/// Check if the git repo at `path` has any remote configured.
pub fn has_remote(path: &Path) -> bool {
    let repo = match git2::Repository::open(path) {
        Ok(r) => r,
        Err(_) => return false,
    };
    repo.remotes().map(|r| r.len() > 0).unwrap_or(false)
}

/// Pull from origin (rebase). Silent no-op if no remote.
pub fn sync_pull(repo_path: &Path) -> Result<SyncResult> {
    if !has_remote(repo_path) {
        return Ok(SyncResult::LocalOnly);
    }
    // Shell out to git pull (git2 pull is complex)
    let output = std::process::Command::new("git")
        .args(["pull", "--rebase", "--autostash"])
        .current_dir(repo_path)
        .output()?;
    if output.status.success() {
        Ok(SyncResult::Synced)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        if stderr.contains("CONFLICT") || stderr.contains("conflict") {
            Ok(SyncResult::Conflict(format!(
                "Sync conflict. Fix manually:\n  cd {} && git status", repo_path.display()
            )))
        } else if stderr.contains("Could not resolve host")
            || stderr.contains("Network is unreachable")
            || stderr.contains("Connection refused")
        {
            Ok(SyncResult::Offline(stderr))
        } else {
            // Unknown error — treat as offline, don't block
            Ok(SyncResult::Offline(stderr))
        }
    }
}

/// Stage all, commit, push. Silent no-op if no remote or nothing to commit.
pub fn sync_push(repo_path: &Path, commit_msg: &str) -> Result<SyncResult> {
    if !has_remote(repo_path) {
        return Ok(SyncResult::LocalOnly);
    }

    // git add .
    let add = std::process::Command::new("git")
        .args(["add", "."])
        .current_dir(repo_path)
        .output()?;
    if !add.status.success() {
        return Ok(SyncResult::Offline(String::from_utf8_lossy(&add.stderr).to_string()));
    }

    // git diff --cached --quiet → nothing staged?
    let diff = std::process::Command::new("git")
        .args(["diff", "--cached", "--quiet"])
        .current_dir(repo_path)
        .output()?;
    if diff.status.success() {
        return Ok(SyncResult::NothingToCommit);
    }

    // git commit
    let commit = std::process::Command::new("git")
        .args(["commit", "-m", commit_msg])
        .current_dir(repo_path)
        .output()?;
    if !commit.status.success() {
        return Ok(SyncResult::Offline(String::from_utf8_lossy(&commit.stderr).to_string()));
    }

    // git push
    let push = std::process::Command::new("git")
        .args(["push"])
        .current_dir(repo_path)
        .output()?;
    if push.status.success() {
        Ok(SyncResult::Synced)
    } else {
        // Push failed — commit is local, next startup pull will fix
        Ok(SyncResult::Offline(String::from_utf8_lossy(&push.stderr).to_string()))
    }
}
```

**Step 4: Run tests, verify pass**

Run: `cargo test -p ctx-lab-core -v`
Expected: Tüm mevcut 59 + yeni 5 = 64 test PASS

**Step 5: Commit**

```bash
git add crates/ctx-lab-core/src/git_ops.rs
git commit -m "feat(core): add sync_pull, sync_push, has_remote for git-based sync"
```

---

## Task 1: session-start'ta sync_pull çağır (hook)

**Files:**
- Modify: `crates/ctx-lab-hook/src/session_start.rs`

**Step 1: Implement**

`session_start::run()` fonksiyonunun başına (payload parse'dan sonra, slug'dan önce) ekle:

```rust
// Git-based sync: pull on startup
let base = ctx_lab_core::storage::ctx_lab_dir()?;
match ctx_lab_core::git_ops::sync_pull(&base) {
    Ok(ctx_lab_core::git_ops::SyncResult::Synced) => eprintln!("[ctx-lab] Synced from remote"),
    Ok(ctx_lab_core::git_ops::SyncResult::Conflict(msg)) => eprintln!("[ctx-lab] {}", msg),
    Ok(ctx_lab_core::git_ops::SyncResult::Offline(e)) => eprintln!("[ctx-lab] Offline: {}", e),
    Ok(_) => {} // LocalOnly, NothingToCommit — silent
    Err(e) => eprintln!("[ctx-lab] Sync pull error: {}", e),
}
```

**NOT:** `base` değişkeni zaten aşağıda `ctx_lab_core::storage::ctx_lab_dir()?` ile alınıyor. Tekrar çağırmamak için session_start::run() fonksiyonunu refactor et: `base`'i en başta al, sonra hem sync hem proje işlemleri için kullan.

**Step 2: Run tests**

Run: `cargo test -p ctx-lab-hook -v`
Expected: 10 test PASS (sync eklentisi mevcut testleri bozmaz)

**Step 3: Commit**

```bash
git add crates/ctx-lab-hook/src/session_start.rs
git commit -m "feat(hook): add git pull on session-start for multi-machine sync"
```

---

## Task 2: session-end'de sync_push çağır (hook)

**Files:**
- Modify: `crates/ctx-lab-hook/src/session_end.rs`

**Step 1: Implement**

`session_end::run()` fonksiyonunun **sonuna** (enqueue'dan sonra, `Ok(())`'den önce) ekle:

```rust
// Git-based sync: commit + push
let project_id = crate::session_start::read_project_id(&slug);
let short_summary = session.summary.chars().take(50).collect::<String>();
let commit_msg = format!("session: {} — {}", slug, short_summary);
match ctx_lab_core::git_ops::sync_push(&base, &commit_msg) {
    Ok(ctx_lab_core::git_ops::SyncResult::Synced) => eprintln!("[ctx-lab] Pushed to remote"),
    Ok(ctx_lab_core::git_ops::SyncResult::Offline(e)) => eprintln!("[ctx-lab] Push skipped (offline): {}", e),
    Ok(_) => {} // LocalOnly, NothingToCommit — silent
    Err(e) => eprintln!("[ctx-lab] Sync push error: {}", e),
}
```

**Step 2: Run tests**

Run: `cargo test --workspace -v`
Expected: Tüm 93+ test PASS

**Step 3: Commit**

```bash
git add crates/ctx-lab-hook/src/session_end.rs
git commit -m "feat(hook): add git commit+push on session-end for multi-machine sync"
```

---

## Task 3: Final — cargo test + clippy + release build + push

**Step 1: Full test**

Run: `cargo test --workspace`
Expected: ~98 test PASS (93 mevcut + 5 yeni sync test)

**Step 2: Clippy**

Run: `cargo clippy --workspace -- -D warnings`
Expected: 0 warning

**Step 3: Release build**

Run: `cargo build --release -p ctx-lab-hook`
Expected: Başarılı

**Step 4: Install (hook binary güncelle)**

Run: `./target/release/ctx-lab-hook install`
Expected: Hook'lar güncellendi

**Step 5: Commit + push**

```bash
git add -A && git commit -m "chore: Faz C complete — git-based multi-machine sync"
git push
```

---

## Summary

| Task | Bileşen | Test |
|------|---------|------|
| 0 | git_ops: sync_pull, sync_push, has_remote | +5 test |
| 1 | session-start: git pull on startup | mevcut testler |
| 2 | session-end: git commit+push | mevcut testler |
| 3 | Final build + push | full suite |

**Toplam:** 4 task, ~98 test, 3 dosya değişikliği. YAGNI.
