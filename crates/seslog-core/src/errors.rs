use thiserror::Error;

/// Seslog error types.
///
/// Convention: `SeslogError` is used at the crate boundary (public API).
/// Internal modules use `anyhow::Result` for convenience with `.context()`.
#[derive(Debug, Error)]
pub enum SeslogError {
    #[error("storage error: {0}")]
    Storage(String),

    #[error("parse error: {0}")]
    Parse(String),

    #[error("config error: {0}")]
    Config(String),

    #[error("hook error: {0}")]
    Hook(String),

    #[error("git error: {0}")]
    Git(String),

    #[error("schema migration needed: found v{found}, expected v{expected}")]
    SchemaMismatch { found: u32, expected: u32 },

    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error(transparent)]
    Json(#[from] serde_json::Error),

    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

pub type Result<T> = std::result::Result<T, SeslogError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_storage_error_display() {
        let err = SeslogError::Storage("disk full".into());
        assert!(err.to_string().contains("disk full"));
    }

    #[test]
    fn test_parse_error_display() {
        let err = SeslogError::Parse("invalid json".into());
        assert!(err.to_string().contains("invalid json"));
    }

    #[test]
    fn test_config_error_display() {
        let err = SeslogError::Config("missing field".into());
        assert!(err.to_string().contains("missing field"));
    }
}
