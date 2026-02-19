use crate::models::SCHEMA_VERSION;
use anyhow::Result;

pub fn check_version(found: u32) -> Result<()> {
    if found < SCHEMA_VERSION {
        eprintln!(
            "[ctx-lab] WARN: schema v{} found, current is v{}. Migration may be needed.",
            found, SCHEMA_VERSION
        );
        migrate(found, SCHEMA_VERSION)?;
    } else if found > SCHEMA_VERSION {
        eprintln!(
            "[ctx-lab] INFO: schema v{} found (newer than v{}). Forward-compatible mode.",
            found, SCHEMA_VERSION
        );
    }
    Ok(())
}

fn migrate(from: u32, to: u32) -> Result<()> {
    eprintln!("[ctx-lab] INFO: migration v{} -> v{} (no-op for now)", from, to);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_version_current_is_ok() {
        assert!(check_version(crate::models::SCHEMA_VERSION).is_ok());
    }

    #[test]
    fn test_check_version_old_returns_ok() {
        assert!(check_version(0).is_ok());
    }

    #[test]
    fn test_check_version_future_is_ok() {
        assert!(check_version(999).is_ok());
    }
}
