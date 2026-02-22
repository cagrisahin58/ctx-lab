use anyhow::Result;
use std::fmt;

pub enum CheckResult {
    Ok(String),
    Warn(String),
    Fail(String),
}

impl fmt::Display for CheckResult {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CheckResult::Ok(msg) => write!(f, "  [OK]   {}", msg),
            CheckResult::Warn(msg) => write!(f, "  [WARN] {}", msg),
            CheckResult::Fail(msg) => write!(f, "  [FAIL] {}", msg),
        }
    }
}

pub fn run() -> Result<()> {
    eprintln!("seslog doctor report:");
    let checks = vec![check_data_dir(), check_config(), check_hooks_registered(), check_quarantine()];
    let mut has_fail = false;
    for check in &checks {
        eprintln!("{}", check);
        if matches!(check, CheckResult::Fail(_)) { has_fail = true; }
    }
    eprintln!("  [{}] Overall: {}", if has_fail {"FAIL"} else {"OK"}, if has_fail {"unhealthy"} else {"healthy"});
    Ok(())
}

fn check_data_dir() -> CheckResult {
    match seslog_core::storage::seslog_dir() {
        Ok(dir) if dir.exists() => CheckResult::Ok(format!("Data directory: {}", dir.display())),
        Ok(dir) => CheckResult::Fail(format!("Data directory missing: {}", dir.display())),
        Err(e) => CheckResult::Fail(format!("Cannot determine data dir: {}", e)),
    }
}

fn check_config() -> CheckResult {
    let config_path = match seslog_core::storage::seslog_dir() {
        Ok(d) => d.join("config.toml"),
        Err(_) => return CheckResult::Fail("Cannot find config".into()),
    };
    match seslog_core::config::load_config(&config_path) {
        Ok(_) => CheckResult::Ok("Config: valid".into()),
        Err(e) => CheckResult::Fail(format!("Config: {}", e)),
    }
}

fn check_hooks_registered() -> CheckResult {
    let path = dirs::home_dir().map(|h| h.join(".claude").join("settings.json"));
    match path {
        Some(p) if p.exists() => {
            match std::fs::read_to_string(&p) {
                Ok(c) if c.contains("seslog") || c.contains("ctx-lab") => CheckResult::Ok("Hooks: registered".into()),
                Ok(_) => CheckResult::Warn("Hooks: not found in settings.json (run install)".into()),
                Err(e) => CheckResult::Fail(format!("Cannot read settings.json: {}", e)),
            }
        }
        _ => CheckResult::Warn("~/.claude/settings.json not found".into()),
    }
}

fn check_quarantine() -> CheckResult {
    let dir = match seslog_core::storage::seslog_dir() {
        Ok(d) => d.join("quarantine"),
        Err(_) => return CheckResult::Warn("Cannot check quarantine".into()),
    };
    match std::fs::read_dir(&dir) {
        Ok(entries) => {
            let count = entries.filter_map(|e| e.ok()).count();
            if count == 0 { CheckResult::Ok("Quarantine: empty".into()) }
            else { CheckResult::Warn(format!("Quarantine: {} file(s)", count)) }
        }
        Err(_) => CheckResult::Ok("Quarantine: directory not yet created".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_result_display() {
        assert!(format!("{}", CheckResult::Ok("test".into())).contains("[OK]"));
        assert!(format!("{}", CheckResult::Warn("test".into())).contains("[WARN]"));
        assert!(format!("{}", CheckResult::Fail("test".into())).contains("[FAIL]"));
    }
}
