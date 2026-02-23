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
    fn test_check_result_display_ok() {
        let r = CheckResult::Ok("data dir exists".into());
        let s = format!("{}", r);
        assert!(s.contains("[OK]"));
        assert!(s.contains("data dir exists"));
    }

    #[test]
    fn test_check_result_display_warn() {
        let r = CheckResult::Warn("hooks not found".into());
        let s = format!("{}", r);
        assert!(s.contains("[WARN]"));
        assert!(s.contains("hooks not found"));
    }

    #[test]
    fn test_check_result_display_fail() {
        let r = CheckResult::Fail("config broken".into());
        let s = format!("{}", r);
        assert!(s.contains("[FAIL]"));
        assert!(s.contains("config broken"));
    }

    #[test]
    fn test_check_result_matches_pattern() {
        let ok = CheckResult::Ok("test".into());
        assert!(matches!(ok, CheckResult::Ok(_)));
        assert!(!matches!(ok, CheckResult::Fail(_)));
    }

    #[test]
    fn test_check_data_dir_does_not_panic() {
        // Exercises the real path; result depends on environment
        let result = check_data_dir();
        // Should always return one of the variants, never panic
        let display = format!("{}", result);
        assert!(!display.is_empty());
    }

    #[test]
    fn test_check_config_does_not_panic() {
        let result = check_config();
        let display = format!("{}", result);
        assert!(!display.is_empty());
    }

    #[test]
    fn test_check_hooks_registered_does_not_panic() {
        let result = check_hooks_registered();
        let display = format!("{}", result);
        assert!(!display.is_empty());
    }

    #[test]
    fn test_check_quarantine_does_not_panic() {
        let result = check_quarantine();
        let display = format!("{}", result);
        assert!(!display.is_empty());
    }

    #[test]
    fn test_run_does_not_fail() {
        // The `run()` function prints to stderr and should never return Err
        let result = run();
        assert!(result.is_ok());
    }
}
