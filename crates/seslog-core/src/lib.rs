/// Custom error types for the Seslog library.
pub mod errors;
/// Core data models: Session, Checkpoint, ProjectMeta, hook payloads.
pub mod models;
/// Schema version checking and migration stubs.
pub mod schema;
/// Atomic file I/O, JSON read/write with quarantine, data directory management.
pub mod storage;
/// Application configuration (TOML-based).
pub mod config;
/// Fire-and-forget job queue for async hook processing.
pub mod queue;
/// Secret redaction (API keys, tokens, passwords).
pub mod sanitize;
/// Markdown roadmap parser with dependency tracking.
pub mod roadmap;
/// CLAUDE.md marker-based block injection.
pub mod claude_md;
/// Git operations: sync, diff, commit, remote detection.
pub mod git_ops;
/// Claude Code JSONL transcript parser and cost estimator.
pub mod transcript;
