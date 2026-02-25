use sysinfo::System;

/// Check if any Claude process is currently running.
pub fn is_claude_running() -> bool {
    let s = System::new_all();
    s.processes().values().any(|p| {
        let name = p.name().to_string_lossy().to_lowercase();
        name.contains("claude")
    })
}

/// Start process watcher thread (default: disabled in config).
///
/// Sends `false` to `tx` when Claude stops running (was running, now is not).
pub fn start_process_watcher(enabled: bool, tx: std::sync::mpsc::Sender<bool>) {
    if !enabled {
        return;
    }
    std::thread::spawn(move || {
        let mut was_running = false;
        loop {
            std::thread::sleep(std::time::Duration::from_secs(600)); // 10 min
            let running = is_claude_running();
            if was_running && !running {
                let _ = tx.send(false);
            }
            was_running = running;
        }
    });
}
