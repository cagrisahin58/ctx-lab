use notify::{Event, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, SystemTime};
use std::{fs, thread};

/// Events emitted by the file watcher.
#[derive(Debug, Clone)]
pub enum WatchEvent {
    /// A new or modified file appeared in the `.events/` directory.
    NewEvent(PathBuf),
    /// A file changed inside the `projects/` directory.
    DataChanged(PathBuf),
}

/// Start dual-mode file watching on the given `data_dir`.
///
/// **Thread 1 — notify-based watcher:** Uses the OS file-system notification API
/// (`FSEvents` on macOS, `inotify` on Linux) in recursive mode. Events under
/// `.events/` are mapped to [`WatchEvent::NewEvent`], events under `projects/`
/// to [`WatchEvent::DataChanged`]; everything else is ignored.
///
/// **Thread 2 — polling fallback:** Polls the `.events/` directory every 2
/// seconds as a safety net (some network mounts don't deliver FS events).
///
/// Both threads run until the sending half of `tx` is dropped (i.e., receiver
/// is gone), at which point they silently exit.
pub fn start_watcher(data_dir: PathBuf, tx: mpsc::Sender<WatchEvent>) {
    let events_dir = data_dir.join(".events");
    let projects_dir = data_dir.join("projects");

    // --- Thread 1: notify-based watcher ---
    let tx_notify = tx.clone();
    let watch_dir = data_dir.clone();
    let events_dir_n = events_dir.clone();
    let projects_dir_n = projects_dir.clone();

    thread::spawn(move || {
        let tx2 = tx_notify;
        let events_prefix = events_dir_n;
        let projects_prefix = projects_dir_n;

        let mut watcher = match notify::recommended_watcher(
            move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    for path in &event.paths {
                        if path.starts_with(&events_prefix) {
                            let _ = tx2.send(WatchEvent::NewEvent(path.clone()));
                        } else if path.starts_with(&projects_prefix) {
                            let _ = tx2.send(WatchEvent::DataChanged(path.clone()));
                        }
                        // Paths outside .events/ and projects/ are silently ignored.
                    }
                }
            },
        ) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("watcher: failed to create notify watcher: {}", e);
                return;
            }
        };

        if let Err(e) = watcher.watch(&watch_dir, RecursiveMode::Recursive) {
            eprintln!("watcher: failed to start watching {}: {}", watch_dir.display(), e);
            return;
        }

        // Keep the watcher alive until the receiver is dropped.
        // We park the thread; it will be unparked when the process exits.
        loop {
            thread::park();
        }
    });

    // --- Thread 2: polling fallback ---
    thread::spawn(move || {
        poll_directory(&events_dir, tx, Duration::from_secs(2));
    });
}

/// Poll `events_dir` at the given `interval`, sending [`WatchEvent::NewEvent`]
/// for every new or modified file discovered.
///
/// This function runs an infinite loop and never returns. It is designed to be
/// called from a dedicated thread.
///
/// The loop silently exits when the receiver half of `tx` has been dropped
/// (i.e., `tx.send()` returns an error).
pub fn poll_directory(events_dir: &Path, tx: mpsc::Sender<WatchEvent>, interval: Duration) {
    let mut known: HashMap<PathBuf, SystemTime> = HashMap::new();

    loop {
        thread::sleep(interval);

        let entries = match fs::read_dir(events_dir) {
            Ok(rd) => rd,
            Err(_) => continue, // directory may not exist yet
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }

            let mtime = match fs::metadata(&path).and_then(|m| m.modified()) {
                Ok(t) => t,
                Err(_) => continue,
            };

            let is_new_or_changed = match known.get(&path) {
                Some(prev) => *prev != mtime,
                None => true,
            };

            if is_new_or_changed {
                known.insert(path.clone(), mtime);
                if tx.send(WatchEvent::NewEvent(path)).is_err() {
                    // Receiver dropped — shut down.
                    return;
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_polling_detects_new_file() {
        let tmp = TempDir::new().unwrap();
        let events_dir = tmp.path().join(".events");
        fs::create_dir_all(&events_dir).unwrap();
        let (tx, rx) = mpsc::channel();

        // Start polling in background with short interval
        let poll_dir = events_dir.clone();
        thread::spawn(move || {
            poll_directory(&poll_dir, tx, Duration::from_millis(50));
        });

        // Wait for first scan
        thread::sleep(Duration::from_millis(100));

        // Create a file
        fs::write(events_dir.join("test.json"), "{}").unwrap();

        // Should receive event within 500ms
        let event = rx.recv_timeout(Duration::from_millis(500));
        assert!(event.is_ok(), "expected to receive a WatchEvent");
        match event.unwrap() {
            WatchEvent::NewEvent(path) => {
                assert!(
                    path.to_string_lossy().contains("test.json"),
                    "path should contain test.json, got: {}",
                    path.display()
                );
            }
            _ => panic!("expected NewEvent"),
        }
    }
}
