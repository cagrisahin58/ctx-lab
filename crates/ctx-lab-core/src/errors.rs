use thiserror::Error;

#[derive(Debug, Error)]
pub enum CtxLabError {
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

pub type Result<T> = std::result::Result<T, CtxLabError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_storage_error_display() {
        let err = CtxLabError::Storage("disk full".into());
        assert!(err.to_string().contains("disk full"));
    }

    #[test]
    fn test_parse_error_display() {
        let err = CtxLabError::Parse("invalid json".into());
        assert!(err.to_string().contains("invalid json"));
    }

    #[test]
    fn test_config_error_display() {
        let err = CtxLabError::Config("missing field".into());
        assert!(err.to_string().contains("missing field"));
    }
}
