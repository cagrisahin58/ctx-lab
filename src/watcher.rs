// File watcher module for ctx-lab
// Watches for file system changes and triggers reconciliation

use notify::{Watcher, RecursiveMode, Event, Config};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;
use std::thread;

/// Start file watcher for ctx-lab directory
pub fn start_watcher(ctx_lab_dir: PathBuf, tx: mpsc::Sender<WatchEvent>) -> notify::Result<()> {
    let (event_tx, event_rx) = mpsc::channel();

    // Create watcher
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        if let Ok(event) = res {
            let _ = event_tx.send(event);
        }
    })?;

    // Watch the ctx-lab directory
    watcher.watch(&ctx_lab_dir, RecursiveMode::Recursive)?;

    // Spawn thread to process events
    thread::spawn(move || {
        for event in event_rx {
            match event.kind {
                notify::EventKind::Create(_) | notify::EventKind::Modify(_) => {
                    for path in &event.paths {
                        // Filter for relevant files
                        if is_relevant_file(path) {
                            let _ = tx.send(WatchEvent::DataChanged(path.clone()));
                        }
                    }
                }
                notify::EventKind::Remove(_) => {
                    for path in &event.paths {
                        if is_relevant_file(path) {
                            let _ = tx.send(WatchEvent::DataRemoved(path.clone()));
                        }
                    }
                }
                _ => {}
            }
        }
    });

    Ok(())
}

/// Check if file is relevant for reconciliation
fn is_relevant_file(path: &Path) -> bool {
    let extensions = ["json", "toml", "md"];

    // Check if it's in projects directory
    if !path.to_string_lossy().contains("/projects/") {
        return false;
    }

    // Check extension
    if let Some(ext) = path.extension() {
        if extensions.contains(&ext.to_str().unwrap_or("")) {
            return true;
        }
    }

    // Always allow markdown files (roadmap, decisions)
    if let Some(name) = path.file_name() {
        if name.to_string_lossy().ends_with(".md") {
            return true;
        }
    }

    false
}

/// Watch events
#[derive(Debug, Clone)]
pub enum WatchEvent {
    DataChanged(PathBuf),
    DataRemoved(PathBuf),
}

/// Start polling fallback for systems where notify doesn't work well
pub fn start_polling(ctx_lab_dir: PathBuf, tx: mpsc::Sender<WatchEvent>, interval_secs: u64) {
    use std::collections::HashMap;
    use std::time::SystemTime;

    let mut last_modified: HashMap<PathBuf, SystemTime> = HashMap::new();

    thread::spawn(move || {
        loop {
            thread::sleep(Duration::from_secs(interval_secs));

            // Scan projects directory
            let projects_dir = ctx_lab_dir.join("projects");
            if let Ok(entries) = std::fs::read_dir(&projects_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        // Check meta.toml
                        let meta_path = path.join("meta.toml");
                        if let Ok(meta) = meta_path.metadata() {
                            if let Ok(mtime) = meta.modified() {
                                let is_new = last_modified.get(&meta_path).map_or(true, |&prev| prev < mtime);
                                if is_new {
                                    last_modified.insert(meta_path.clone(), mtime);
                                    let _ = tx.send(WatchEvent::DataChanged(meta_path));
                                }
                            }
                        }

                        // Check sessions directory
                        let sessions_dir = path.join("sessions");
                        if let Ok(entries) = std::fs::read_dir(&sessions_dir) {
                            for entry in entries.flatten() {
                                let session_path = entry.path();
                                if session_path.extension().map_or(false, |e| e == "json") {
                                    if let Ok(meta) = session_path.metadata() {
                                        if let Ok(mtime) = meta.modified() {
                                            let is_new = last_modified.get(&session_path).map_or(true, |&prev| prev < mtime);
                                            if is_new {
                                                last_modified.insert(session_path.clone(), mtime);
                                                let _ = tx.send(WatchEvent::DataChanged(session_path));
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // Check roadmap.md
                        let roadmap_path = path.join("roadmap.md");
                        if roadmap_path.exists() {
                            if let Ok(meta) = roadmap_path.metadata() {
                                if let Ok(mtime) = meta.modified() {
                                    let is_new = last_modified.get(&roadmap_path).map_or(true, |&prev| prev < mtime);
                                    if is_new {
                                        last_modified.insert(roadmap_path.clone(), mtime);
                                        let _ = tx.send(WatchEvent::DataChanged(roadmap_path));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    });
}
