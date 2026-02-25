use regex::Regex;
use once_cell::sync::Lazy;

struct RedactionPattern {
    regex: Regex,
    label: &'static str,
}

static PATTERNS: Lazy<Vec<RedactionPattern>> = Lazy::new(|| vec![
    RedactionPattern {
        regex: Regex::new(r"sk-[a-zA-Z0-9_-]{20,}").unwrap(),
        label: "API key (sk-*)",
    },
    RedactionPattern {
        regex: Regex::new(r"AKIA[A-Z0-9]{16}").unwrap(),
        label: "AWS access key",
    },
    RedactionPattern {
        regex: Regex::new(r"ghp_[a-zA-Z0-9]{36,}").unwrap(),
        label: "GitHub PAT",
    },
    RedactionPattern {
        regex: Regex::new(r"Bearer\s+[a-zA-Z0-9._-]{20,}").unwrap(),
        label: "Bearer token",
    },
    RedactionPattern {
        regex: Regex::new(r#"(?i)(password|secret|token|api_key|apikey)\s*[=:]\s*["']?[^\s"']{8,}"#).unwrap(),
        label: "Secret assignment",
    },
    RedactionPattern {
        regex: Regex::new(r"(?i)export\s+\w*(SECRET|KEY|TOKEN|PASSWORD)\w*\s*=\s*\S+").unwrap(),
        label: "Env var export",
    },
]);

pub struct SanitizeResult {
    pub text: String,
    pub redaction_count: u32,
    pub patterns_found: Vec<String>,
}

pub fn sanitize(text: &str) -> SanitizeResult {
    let mut result = text.to_string();
    let mut count = 0u32;
    let mut patterns = Vec::new();
    for pattern in PATTERNS.iter() {
        let matches: Vec<_> = pattern.regex.find_iter(&result).collect();
        if !matches.is_empty() {
            count += matches.len() as u32;
            patterns.push(format!("{}: {} occurrence(s)", pattern.label, matches.len()));
            result = pattern.regex.replace_all(&result, "[REDACTED]").to_string();
        }
    }
    SanitizeResult { text: result, redaction_count: count, patterns_found: patterns }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_openai_key() {
        let result = sanitize("my key is sk-abc123def456ghi789jkl012mno");
        assert!(result.text.contains("[REDACTED]"));
        assert!(!result.text.contains("sk-abc"));
        assert!(result.redaction_count >= 1);
    }

    #[test]
    fn test_sanitize_aws_key() {
        let result = sanitize("aws key: AKIAIOSFODNN7EXAMPLE");
        assert!(result.text.contains("[REDACTED]"));
        assert!(!result.text.contains("AKIA"));
    }

    #[test]
    fn test_sanitize_github_pat() {
        let result = sanitize("token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij");
        assert!(result.text.contains("[REDACTED]"));
    }

    #[test]
    fn test_sanitize_bearer_token() {
        let result = sanitize("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test");
        assert!(result.text.contains("[REDACTED]"));
    }

    #[test]
    fn test_sanitize_password_assignment() {
        let result = sanitize("password = \"super_secret_123\"");
        assert!(result.text.contains("[REDACTED]"));
    }

    #[test]
    fn test_sanitize_env_export() {
        let result = sanitize("export API_SECRET_KEY=mysecretvalue123");
        assert!(result.text.contains("[REDACTED]"));
    }

    #[test]
    fn test_sanitize_clean_text_unchanged() {
        let input = "This is normal text with no secrets.";
        let result = sanitize(input);
        assert_eq!(result.text, input);
        assert_eq!(result.redaction_count, 0);
        assert!(result.patterns_found.is_empty());
    }

    #[test]
    fn test_sanitize_multiple_secrets_counted() {
        let input = "key1: sk-aaaaaaaaaaaaaaaaaaaaaa key2: sk-bbbbbbbbbbbbbbbbbbbbbb";
        let result = sanitize(input);
        assert!(result.redaction_count >= 2);
    }
}
