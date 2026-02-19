# ctx-lab — FAZ A: Temel Altyapı + Hook Binary

> **Tahmini süre:** 3-4 hafta  
> **Bağımlılık:** Yok (ilk faz)  
> **Teslimat:** `ctx-lab-hook` binary + `ctx-lab-core` library  
> **Bu faz sonunda:** Claude Code oturumları otomatik takip edilir, `~/.ctx-lab/` altında oturum logları birikir. UI yok.

---

## 1. Faz Hedefi

Kullanıcı `ctx-lab-hook install` çalıştırır → Claude Code'da çalışır → oturum kapanınca `~/.ctx-lab/projects/X/sessions/` altında JSON log bulur. Crash sonrası recovery çalışır. macOS ve Windows'ta çalışır.

---

## 2. Cargo Workspace Yapısı

```
ctx-lab/
├── Cargo.toml                          ← workspace tanımı
├── crates/
│   ├── ctx-lab-core/
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── models.rs               ← Session, Project, Checkpoint, Roadmap, Machine
│   │       ├── schema.rs               ← SCHEMA_VERSION, migration logic
│   │       ├── git_ops.rs              ← git2: diff, commit, log
│   │       ├── transcript.rs           ← trait TranscriptSource + JSONL parser + git-diff fallback
│   │       ├── roadmap.rs              ← Markdown parser & updater
│   │       ├── claude_md.rs            ← CLAUDE.md marker-based injection (ctx-lab:start/end)
│   │       ├── storage.rs              ← atomic write, dizin yönetimi
│   │       ├── sanitize.rs             ← secret redaction (regex)
│   │       ├── config.rs               ← TOML config + privacy modes
│   │       ├── queue.rs                ← fire-and-forget payload queue
│   │       └── errors.rs               ← anyhow/thiserror error types
│   └── ctx-lab-hook/
│       ├── Cargo.toml
│       └── src/
│           ├── main.rs                 ← clap routing + queue dispatch
│           ├── session_start.rs
│           ├── checkpoint.rs
│           ├── stop.rs
│           ├── session_end.rs
│           ├── install.rs              ← ~/.claude/settings.json patch
│           ├── uninstall.rs
│           ├── doctor.rs               ← health check
│           └── process_queue.rs        ← kuyruk işleyici (daemon mode)
├── tests/
│   ├── fixtures/                       ← golden test fixtures
│   │   ├── hook_payloads/              ← 20 farklı stdin JSON örneği
│   │   ├── transcripts/               ← örnek JSONL dosyaları
│   │   └── expected_outputs/           ← beklenen session JSON'ları
│   └── integration/
│       ├── session_lifecycle_test.rs
│       ├── crash_recovery_test.rs
│       ├── atomic_write_test.rs
│       └── sanitize_test.rs
└── README.md
```

### Cargo.toml (workspace root)

```toml
[workspace]
members = ["crates/ctx-lab-core", "crates/ctx-lab-hook"]
resolver = "2"

[workspace.dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
chrono = { version = "0.4", features = ["serde"] }
uuid = { version = "1", features = ["v4", "serde"] }
toml = "0.8"
git2 = "0.19"
anyhow = "1"
thiserror = "2"
clap = { version = "4", features = ["derive"] }
fd-lock = "4"
```

### ctx-lab-core/Cargo.toml

```toml
[package]
name = "ctx-lab-core"
version = "0.1.0"
edition = "2021"

[dependencies]
serde.workspace = true
serde_json.workspace = true
chrono.workspace = true
uuid.workspace = true
toml.workspace = true
git2.workspace = true
anyhow.workspace = true
thiserror.workspace = true
fd-lock.workspace = true
```

### ctx-lab-hook/Cargo.toml

```toml
[package]
name = "ctx-lab-hook"
version = "0.1.0"
edition = "2021"

[dependencies]
ctx-lab-core = { path = "../ctx-lab-core" }
clap.workspace = true
serde.workspace = true
serde_json.workspace = true
anyhow.workspace = true
```

---

## 3. Veri Modelleri (models.rs)

### 3.1 Schema Versioning Stratejisi

Her JSON dosyasında `schema_version` alanı bulunur. Parse sırasında:
1. `schema_version` kontrol et
2. Güncel değilse `migrate(vX → vY)` çalıştır
3. Bilinmeyen alanlar ignore edilir (`#[serde(flatten)]` veya `deny_unknown_fields` kullanılmaz)

```rust
/// Mevcut şema versiyonu — her breaking change'de artırılır
pub const SCHEMA_VERSION: u32 = 1;

/// Forward-compatible deserialization:
/// - Bilinmeyen alanlar ignore edilir (serde default)
/// - Eksik alanlar Option<T> veya #[serde(default)] ile karşılanır
/// - schema_version < SCHEMA_VERSION ise migrate() çağrılır
```

### 3.2 Temel Struct'lar

```rust
// models.rs

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// --- Session ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub schema_version: u32,
    pub id: String,                          // "ses_" prefix + kısa UUID
    pub project_id: String,                  // "proj_" prefix
    pub machine: String,                     // hostname
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub duration_minutes: Option<u32>,
    pub end_reason: Option<String>,          // "prompt_input_exit" | "clear" | "logout" | "crash_recovered"
    pub summary: String,
    pub summary_source: String,              // "transcript+git" | "git_only" | "recovered"
    #[serde(default)]
    pub transcript_highlights: Vec<String>,
    #[serde(default)]
    pub roadmap_changes: Vec<RoadmapChange>,
    #[serde(default)]
    pub decisions: Vec<String>,
    #[serde(default)]
    pub next_steps: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub tools_used: Vec<String>,
    #[serde(default)]
    pub files_changed: u32,
    #[serde(default)]
    pub git_commits: Vec<String>,
    #[serde(default)]
    pub checkpoints_merged: Vec<String>,
    #[serde(default)]
    pub recovered: bool,
    #[serde(default)]
    pub redaction_count: u32,                // kaç secret redact edildi
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoadmapChange {
    pub action: String,      // "complete" | "start" | "block" | "add"
    pub item: String,
    #[serde(default)]
    pub phase: Option<u32>,
}

// --- Checkpoint ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Checkpoint {
    pub schema_version: u32,
    pub id: String,                          // "chk_" prefix
    pub session_id: String,
    pub project_id: String,
    pub machine: String,
    pub timestamp: DateTime<Utc>,
    pub git_diff_stat: Option<String>,       // "+142 -38 across 5 files"
    #[serde(default)]
    pub files_changed: Vec<String>,
    #[serde(default)]
    pub recent_commits: Vec<String>,
    pub source: String,                      // "postToolUse_debounced" | "process_watcher" | "manual"
}

// --- Project ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectMeta {
    pub schema_version: u32,
    pub project: ProjectInfo,
    pub paths: std::collections::HashMap<String, String>,  // machine → path
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectInfo {
    pub id: String,
    pub name: String,
    pub status: String,              // "active" | "archived"
    pub created_at: DateTime<Utc>,
    #[serde(default)]
    pub archived_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub description: String,
}

// --- Machine ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MachineProfile {
    pub schema_version: u32,
    pub hostname: String,
    pub platform: String,            // "macos" | "windows" | "linux"
    pub registered_at: DateTime<Utc>,
}

// --- Config ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub schema_version: u32,
    #[serde(default = "default_privacy_mode")]
    pub privacy_mode: String,        // v1: sadece "full" implement edildi. "metadata-only" | "summary-only" alanı var ama henüz işlevsiz.
    #[serde(default = "default_checkpoint_interval")]
    pub checkpoint_interval_minutes: u32,
    #[serde(default = "default_additional_context_max")]
    pub additional_context_max_chars: u32,
    #[serde(default = "default_transcript_max_messages")]
    pub transcript_max_messages: u32,
    #[serde(default = "default_transcript_max_tokens")]
    pub transcript_max_tokens: u32,
    #[serde(default = "default_true")]
    pub sanitize_secrets: bool,
}

fn default_privacy_mode() -> String { "full".into() }  // v1: sadece full. Config alanı future-proof olarak duruyor.
fn default_checkpoint_interval() -> u32 { 10 }
fn default_additional_context_max() -> u32 { 1500 }
fn default_transcript_max_messages() -> u32 { 100 }
fn default_transcript_max_tokens() -> u32 { 6000 }
fn default_true() -> bool { true }
```

### 3.3 Claude Code Hook Stdin Payload'ları

```rust
// models.rs — Hook stdin JSON yapıları

/// SessionStart hook stdin
#[derive(Debug, Deserialize)]
pub struct SessionStartPayload {
    pub session_id: String,
    pub transcript_path: String,
    pub cwd: String,
    #[serde(default)]
    pub permission_mode: Option<String>,
    #[serde(default)]
    pub source: Option<String>,      // "startup" | "resume" | "clear" | "compact"
}

/// PostToolUse hook stdin
#[derive(Debug, Deserialize)]
pub struct PostToolUsePayload {
    pub session_id: String,
    pub transcript_path: String,
    pub cwd: String,
    #[serde(default)]
    pub tool_name: Option<String>,
    #[serde(default)]
    pub tool_input: Option<serde_json::Value>,
    #[serde(default)]
    pub tool_response: Option<String>,
}

/// Stop hook stdin
#[derive(Debug, Deserialize)]
pub struct StopPayload {
    pub session_id: String,
    pub transcript_path: String,
    #[serde(default)]
    pub stop_hook_active: Option<bool>,
}

/// SessionEnd hook stdin
#[derive(Debug, Deserialize)]
pub struct SessionEndPayload {
    pub session_id: String,
    pub transcript_path: String,
    pub cwd: String,
    #[serde(default)]
    pub reason: Option<String>,      // "clear" | "logout" | "prompt_input_exit" | "other"
}

/// SessionStart hook stdout (additionalContext injection)
#[derive(Debug, Serialize)]
pub struct SessionStartOutput {
    #[serde(rename = "hookSpecificOutput")]
    pub hook_specific_output: HookSpecificOutput,
}

#[derive(Debug, Serialize)]
pub struct HookSpecificOutput {
    #[serde(rename = "hookEventName")]
    pub hook_event_name: String,
    #[serde(rename = "additionalContext")]
    pub additional_context: String,
}
```

---

## 4. Kritik Modüller

### 4.1 Atomic Write (storage.rs) — P0

**Asla doğrudan hedef dosyaya yazma.** Yarım yazılmış JSON, downstream'de cascade failure yaratır.

```rust
// storage.rs

use std::fs;
use std::io::Write;
use std::path::Path;
use anyhow::Result;

/// Atomic write: tmp dosyaya yaz → fsync → rename
/// Bu, yarım yazılmış JSON riskini ortadan kaldırır.
pub fn atomic_write(path: &Path, content: &[u8]) -> Result<()> {
    let tmp_path = path.with_extension("tmp");

    // 1. Tmp dosyaya yaz
    let mut file = fs::File::create(&tmp_path)?;
    file.write_all(content)?;
    file.sync_all()?;  // fsync — diske yazıldığından emin ol

    // 2. Atomic rename
    fs::rename(&tmp_path, path)?;

    Ok(())
}

/// JSON serialize + atomic write
pub fn write_json<T: serde::Serialize>(path: &Path, value: &T) -> Result<()> {
    let json = serde_json::to_string_pretty(value)?;
    atomic_write(path, json.as_bytes())
}

/// Parse fail durumunda quarantine'e taşı
pub fn safe_read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<Option<T>> {
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };

    match serde_json::from_str::<T>(&content) {
        Ok(v) => Ok(Some(v)),
        Err(e) => {
            // Quarantine: bozuk dosyayı taşı, log yaz
            let quarantine_dir = ctx_lab_dir()?.join("quarantine");
            fs::create_dir_all(&quarantine_dir)?;
            let quarantine_path = quarantine_dir.join(
                format!("{}_{}", chrono::Utc::now().format("%Y%m%d_%H%M%S"),
                         path.file_name().unwrap_or_default().to_string_lossy())
            );
            fs::rename(path, &quarantine_path)?;
            eprintln!("[ctx-lab] WARN: corrupt file quarantined: {:?} → {:?}: {}", path, quarantine_path, e);
            Ok(None)
        }
    }
}

/// ~/.ctx-lab/ dizinini döndür, yoksa oluştur
pub fn ctx_lab_dir() -> Result<std::path::PathBuf> {
    let dir = dirs::home_dir()
        .ok_or_else(|| anyhow::anyhow!("HOME directory not found"))?
        .join(".ctx-lab");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Dizin yapısını initialize et
pub fn init_data_dir() -> Result<std::path::PathBuf> {
    let base = ctx_lab_dir()?;
    for sub in &["projects", "machines", "templates", "queue", ".events", "quarantine"] {
        fs::create_dir_all(base.join(sub))?;
    }
    Ok(base)
}
```

### 4.2 Fire-and-Forget Hook Pattern (queue.rs) — P0

Hook binary kullanıcının CLI'ını **asla bloklamamalı**. Ağır işler kuyruğa atılır.

```
Kullanıcı perspektifi:
  Claude Code çalışıyor → hook tetikleniyor → <5ms → devam

Arka plan:
  queue/ dizinine payload yazıldı
  ctx-lab-hook process-queue (veya Tauri daemon) ağır işi yapar
```

**Hangi hook'lar fire-and-forget, hangisi synchronous?**

| Hook | Mod | Neden |
|------|-----|-------|
| SessionStart | **Synchronous** | additionalContext stdout'a yazılmalı, Claude bekler |
| PostToolUse (checkpoint) | **Fire-and-forget** | Checkpoint yazma async olabilir |
| Stop | **Fire-and-forget** | Roadmap öneri tespiti async olabilir |
| SessionEnd | **Hybrid** | Kuyruğa at ama temel logu hızlıca yaz |

```rust
// queue.rs

use std::path::Path;
use anyhow::Result;
use crate::storage;

/// Payload'ı queue/ dizinine atomic write ile yaz
/// Dosya adı: {timestamp}_{event}_{session_id}.json
pub fn enqueue(event: &str, session_id: &str, payload: &serde_json::Value) -> Result<()> {
    let queue_dir = storage::ctx_lab_dir()?.join("queue");
    let filename = format!(
        "{}_{}_{}_{}.json",
        chrono::Utc::now().format("%Y%m%d_%H%M%S_%3f"),
        event,
        session_id,
        &uuid::Uuid::new_v4().to_string()[..8]
    );
    let path = queue_dir.join(&filename);
    storage::write_json(&path, payload)?;
    Ok(())
}

/// Kuyruktaki tüm dosyaları kronolojik sırada işle
/// Her dosya işlendikten sonra silinir (at-least-once)
pub fn process_all<F>(handler: F) -> Result<u32>
where F: Fn(&str, serde_json::Value) -> Result<()>
{
    let queue_dir = storage::ctx_lab_dir()?.join("queue");
    let mut entries: Vec<_> = std::fs::read_dir(&queue_dir)?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map_or(false, |ext| ext == "json"))
        .collect();
    entries.sort_by_key(|e| e.file_name());

    let mut processed = 0;
    for entry in entries {
        let path = entry.path();
        match storage::safe_read_json::<serde_json::Value>(&path) {
            Ok(Some(payload)) => {
                let event = path.file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("unknown");
                if let Err(e) = handler(event, payload) {
                    eprintln!("[ctx-lab] ERROR processing queue item {:?}: {}", path, e);
                    // Hatalı dosyayı silme, tekrar denenecek
                    continue;
                }
                std::fs::remove_file(&path)?;
                processed += 1;
            }
            Ok(None) => {} // quarantine edildi
            Err(e) => eprintln!("[ctx-lab] ERROR reading queue item {:?}: {}", path, e),
        }
    }
    Ok(processed)
}
```

### 4.3 Transcript Parser (transcript.rs) — Abstraction Layer ile

**Neden trait?** Anthropic transcript JSONL formatını değiştirdiğinde (alan adları, yapı, encoding) tüm hook'lar kırılır. `TranscriptSource` trait'i sayesinde:
- Format değişirse sadece `JsonlTranscriptSource` güncellenir
- Transcript okunamıyorsa `GitDiffFallback` devreye girer (git diff + commit log'dan minimal özet)
- Yeni format'lar (örn. SQLite-based transcript) kolayca eklenir

```rust
// transcript.rs

use anyhow::Result;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::Path;

pub struct TranscriptHighlights {
    pub user_messages: Vec<String>,
    pub assistant_summaries: Vec<String>,
    pub tools_used: Vec<String>,
}

/// Abstraction layer: transcript kaynağı değişse bile
/// downstream kod etkilenmez
pub trait TranscriptSource {
    fn extract_highlights(
        &self,
        max_messages: usize,
        max_bytes: usize,
    ) -> Result<TranscriptHighlights>;
}

/// Birincil kaynak: Claude Code JSONL transcript dosyası
pub struct JsonlTranscriptSource<'a> {
    pub path: &'a Path,
}

/// Fallback: transcript okunamazsa git diff + commit log'dan minimal özet
pub struct GitDiffFallback<'a> {
    pub cwd: &'a Path,
}

/// Akıllı seçici: önce JSONL dene, başarısızsa git fallback
pub fn extract_highlights(
    transcript_path: &Path,
    cwd: &Path,
    max_messages: usize,
    max_bytes: usize,
) -> TranscriptHighlights {
    // Önce JSONL dene
    let jsonl = JsonlTranscriptSource { path: transcript_path };
    match jsonl.extract_highlights(max_messages, max_bytes) {
        Ok(h) if !h.user_messages.is_empty() => return h,
        Ok(_) | Err(_) => {
            eprintln!("[ctx-lab] WARN: transcript parse failed, falling back to git diff");
        }
    }

    // Fallback: git diff
    let fallback = GitDiffFallback { cwd };
    fallback.extract_highlights(max_messages, max_bytes)
        .unwrap_or_else(|_| TranscriptHighlights {
            user_messages: vec![],
            assistant_summaries: vec!["(transcript unavailable)".into()],
            tools_used: vec![],
        })
}

// --- JsonlTranscriptSource implementasyonu ---

impl<'a> TranscriptSource for JsonlTranscriptSource<'a> {
    fn extract_highlights(&self, max_messages: usize, max_bytes: usize) -> Result<TranscriptHighlights> {
        parse_jsonl(self.path, max_messages, max_bytes)
    }
}

// --- GitDiffFallback implementasyonu ---

impl<'a> TranscriptSource for GitDiffFallback<'a> {
    fn extract_highlights(&self, _max_messages: usize, _max_bytes: usize) -> Result<TranscriptHighlights> {
        // git log --oneline -10 ve git diff --stat'tan minimal özet üret
        // Detay: git_ops.rs'teki fonksiyonları kullan
        todo!("implement: git log + diff stat → TranscriptHighlights")
    }
}

/// JSONL transcript dosyasını sondan okur (tail-read)
fn parse_jsonl(
    path: &Path,
    max_messages: usize,
    max_bytes: usize,
) -> Result<TranscriptHighlights> {
    let file = std::fs::File::open(path)?;
    let file_size = file.metadata()?.len();

    // Dosyanın sonundan max_bytes kadar oku
    let reader = if file_size > max_bytes as u64 {
        let mut f = file;
        f.seek(SeekFrom::End(-(max_bytes as i64)))?;
        // İlk satırı at (yarım olabilir)
        let mut reader = BufReader::new(f);
        let mut _discard = String::new();
        reader.read_line(&mut _discard)?;
        reader
    } else {
        BufReader::new(file)
    };

    let mut highlights = TranscriptHighlights {
        user_messages: Vec::new(),
        assistant_summaries: Vec::new(),
        tools_used: Vec::new(),
    };

    let mut message_count = 0;
    for line in reader.lines() {
        let line = line?;
        if line.trim().is_empty() { continue; }

        if let Ok(entry) = serde_json::from_str::<serde_json::Value>(&line) {
            let role = entry.get("role").and_then(|r| r.as_str()).unwrap_or("");
            let msg_type = entry.get("type").and_then(|t| t.as_str()).unwrap_or("");

            match (role, msg_type) {
                ("user", _) => {
                    if let Some(text) = extract_text(&entry) {
                        // İlk 200 karakteri al
                        let truncated: String = text.chars().take(200).collect();
                        highlights.user_messages.push(truncated);
                    }
                }
                ("assistant", "text") => {
                    if let Some(text) = extract_text(&entry) {
                        // İlk cümleyi al
                        let first_sentence = text.split('.').next().unwrap_or(&text);
                        let truncated: String = first_sentence.chars().take(200).collect();
                        highlights.assistant_summaries.push(truncated);
                    }
                }
                ("assistant", "tool_use") => {
                    if let Some(name) = entry.get("name").and_then(|n| n.as_str()) {
                        if !highlights.tools_used.contains(&name.to_string()) {
                            highlights.tools_used.push(name.to_string());
                        }
                    }
                }
                _ => {}
            }

            message_count += 1;
            if message_count >= max_messages { break; }
        }
    }

    Ok(highlights)
}

fn extract_text(entry: &serde_json::Value) -> Option<String> {
    // "content" alanı string veya array olabilir
    entry.get("message")
        .or_else(|| entry.get("content"))
        .and_then(|c| {
            if let Some(s) = c.as_str() {
                Some(s.to_string())
            } else if let Some(arr) = c.as_array() {
                Some(arr.iter()
                    .filter_map(|item| item.get("text").and_then(|t| t.as_str()))
                    .collect::<Vec<_>>()
                    .join(" "))
            } else {
                None
            }
        })
}
```

### 4.4 Secret Sanitization (sanitize.rs)

```rust
// sanitize.rs

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

    SanitizeResult {
        text: result,
        redaction_count: count,
        patterns_found: patterns,
    }
}
```

### 4.5 Roadmap Parser (roadmap.rs)

```rust
// roadmap.rs — temel yapı

#[derive(Debug, Clone)]
pub struct RoadmapItem {
    pub status: ItemStatus,
    pub text: String,
    pub phase: Option<String>,
    pub line_number: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ItemStatus {
    Done,       // [x]
    Active,     // [>]
    Pending,    // [ ]
    Suspended,  // [~]
    Blocked,    // [!]
}

/// roadmap.md parse et → RoadmapItem listesi
pub fn parse_roadmap(content: &str) -> Vec<RoadmapItem> {
    // Markdown satırlarını parse et
    // - [x] Item → Done
    // - [>] Item → Active
    // - [ ] Item → Pending
    // ## Faz N: Title → phase bilgisi
    todo!("implement")
}

/// Belirli bir item'ı tamamlandı olarak işaretle, [>]'yi taşı
pub fn mark_complete(content: &str, item_text: &str) -> Option<String> {
    // 1. item_text ile eşleşen satırı bul
    // 2. [x] olarak işaretle
    // 3. [>]'yi bir sonraki [ ] item'a taşı
    // 4. Eşleşme yoksa None döndür
    todo!("implement")
}

/// Aktif item'ı döndür ([>] işareti)
pub fn active_item(content: &str) -> Option<RoadmapItem> {
    parse_roadmap(content).into_iter().find(|i| i.status == ItemStatus::Active)
}

/// Toplam ilerleme yüzdesi
pub fn progress_percent(content: &str) -> f32 {
    let items = parse_roadmap(content);
    let total = items.len() as f32;
    if total == 0.0 { return 0.0; }
    let done = items.iter().filter(|i| i.status == ItemStatus::Done).count() as f32;
    (done / total * 100.0).round()
}
```

### 4.6 CLAUDE.md Enjeksiyon Formatı (claude_md.rs)

**Kural:** ctx-lab, CLAUDE.md'deki mevcut kullanıcı içeriğine **asla dokunmaz**. Sadece kendi marker'ları arasındaki bloğu yönetir.

```rust
// claude_md.rs

const CTX_LAB_START: &str = "<!-- ctx-lab:start -->";
const CTX_LAB_END: &str = "<!-- ctx-lab:end -->";

/// CLAUDE.md'deki ctx-lab bloğunu güncelle.
/// Mevcut içerik korunur, sadece marker'lar arası değişir.
/// CLAUDE.md yoksa oluşturulur (sadece ctx-lab bloğu ile).
pub fn update_claude_md(project_dir: &Path, block_content: &str) -> Result<()> {
    let claude_md = project_dir.join("CLAUDE.md");
    let existing = std::fs::read_to_string(&claude_md).unwrap_or_default();

    let new_block = format!(
        "{}\n{}\n{}",
        CTX_LAB_START,
        block_content,
        CTX_LAB_END
    );

    let updated = if existing.contains(CTX_LAB_START) && existing.contains(CTX_LAB_END) {
        // Mevcut bloğu değiştir
        let start_idx = existing.find(CTX_LAB_START).unwrap();
        let end_idx = existing.find(CTX_LAB_END).unwrap() + CTX_LAB_END.len();
        format!("{}{}{}", &existing[..start_idx], new_block, &existing[end_idx..])
    } else if existing.is_empty() {
        // Yeni dosya
        new_block
    } else {
        // Mevcut dosyanın sonuna ekle (2 boş satır ayıracı)
        format!("{}\n\n{}", existing.trim_end(), new_block)
    };

    storage::atomic_write(&claude_md, updated.as_bytes())
}

/// ctx-lab bloğunu CLAUDE.md'den temizle (uninstall için)
pub fn remove_claude_md_block(project_dir: &Path) -> Result<()> {
    let claude_md = project_dir.join("CLAUDE.md");
    let existing = std::fs::read_to_string(&claude_md)?;

    if let (Some(start), Some(end)) = (existing.find(CTX_LAB_START), existing.find(CTX_LAB_END)) {
        // Marker'lar arası + önündeki boş satırları temizle
        let before = existing[..start].trim_end();
        let after = existing[end + CTX_LAB_END.len()..].trim_start();
        let cleaned = if before.is_empty() { after.to_string() }
                      else { format!("{}\n{}", before, after) };

        if cleaned.trim().is_empty() {
            std::fs::remove_file(&claude_md)?; // boş kaldıysa sil
        } else {
            storage::atomic_write(&claude_md, cleaned.as_bytes())?;
        }
    }
    Ok(())
}
```

**Blok içeriği örneği:**
```markdown
<!-- ctx-lab:start -->
## Proje Durumu (ctx-lab tarafından otomatik güncellenir)

**Son Oturum:** 2026-02-17 16:30 | Windows-Ofis
**Özet:** Cross-validation pipeline tamamlandı, F1 skorları tabloya eklendi.
**Aktif Roadmap Adımı:** [>] Sonuç görselleştirme ve karşılaştırma grafikleri

### Yol Haritası Özet
- [x] Veri ön işleme
- [x] Model eğitimi
- [x] Cross-validation
- [>] Sonuç görselleştirme     ← BURADAYIZ
- [ ] Makale taslağına entegre et
<!-- ctx-lab:end -->
```

---

## 5. Hook Subcommand Detayları

### 5.1 main.rs — Clap Routing

```rust
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "ctx-lab-hook", version, about = "ctx-lab Claude Code hook binary")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// SessionStart: proje algıla, bağlam yükle, additionalContext döndür
    SessionStart,
    /// PostToolUse: debounced checkpoint yaz (fire-and-forget)
    Checkpoint,
    /// Stop: roadmap öneri tespiti (fire-and-forget)
    Stop,
    /// SessionEnd: tam oturum logu + sync (hybrid)
    SessionEnd,
    /// Hook'ları ~/.claude/settings.json'a kur
    Install,
    /// Hook'ları kaldır
    Uninstall,
    /// Kurulum sağlığını kontrol et
    Doctor,
    /// Kuyruktaki ağır işleri işle (daemon/cron mode)
    ProcessQueue,
}

fn main() {
    let cli = Cli::parse();
    let result = match cli.command {
        Commands::SessionStart => session_start::run(),
        Commands::Checkpoint => checkpoint::run(),
        Commands::Stop => stop::run(),
        Commands::SessionEnd => session_end::run(),
        Commands::Install => install::run(),
        Commands::Uninstall => uninstall::run(),
        Commands::Doctor => doctor::run(),
        Commands::ProcessQueue => process_queue::run(),
    };

    if let Err(e) = result {
        eprintln!("[ctx-lab] ERROR: {}", e);
        // Hook hataları Claude Code'u bloklamamalı — exit 0
        std::process::exit(0);
    }
}
```

### 5.2 SessionStart (synchronous — additionalContext döndürür)

```
stdin → SessionStartPayload JSON
işlem:
  1. cwd'den proje algıla (.ctx dosyası veya .git)
  2. Yeni projeyse → otomatik kayıt + şablon roadmap oluştur
  3. Son oturum özetini oku
  4. Aktif roadmap adımını oku
  5. Orphan checkpoint varsa "recovered session" bilgisi ekle
  6. Roadmap boş/şablon mu kontrol et → boşsa additionalContext'e ekle:
     "Bu proje için henüz roadmap oluşturulmamış. Kullanıcı isterse
      projenin yol haritasını birlikte oluşturabilirsin. Roadmap dosyası:
      ~/.ctx-lab/projects/{slug}/roadmap.md"
  7. additionalContext üret (max 1500 char, truncation: özet → roadmap → meta)
stdout → SessionStartOutput JSON (additionalContext)
yan etki:
  - CLAUDE.md ctx-lab bloğu güncelle (ctx-lab:start/end marker'ları ile)
  - .events/ dizinine "session_started" event yaz
```

### 5.3 Checkpoint (fire-and-forget)

```
stdin → PostToolUsePayload JSON
işlem:
  1. Debounce kontrolü: ~/.ctx-lab/.last-checkpoint-{session_id} timestamp
     → Son checkpoint'ten 10dk geçmediyse → exit 0
  2. Payload'ı queue/ dizinine yaz (atomic write)
     → Kuyruk işleyici (process-queue veya Tauri daemon):
       a. git diff --stat al
       b. Son commit mesajlarını topla
       c. Checkpoint JSON yaz (checkpoints/ dizinine, atomic)
       d. .events/ dizinine "checkpoint_created" event yaz
       e. Debounce timestamp güncelle
stdout → yok
```

### 5.4 Stop (fire-and-forget)

```
stdin → StopPayload JSON
işlem:
  1. stop_hook_active == true → exit 0 (loop koruması)
  2. Payload'ı queue/ dizinine yaz
     → Kuyruk işleyici:
       a. transcript_path'ten son turn'ü oku
       b. Tamamlama sinyalleri ara (konservatif keyword matching)
       c. Eşleşme varsa → CLAUDE.md'ye öneri yaz
       d. roadmap.md'yi güncelleme (onay bekle)
stdout → yok
```

### 5.5 SessionEnd (hybrid: temel log hızlı, ağır iş kuyruğa)

```
stdin → SessionEndPayload JSON
işlem (synchronous, hızlı):
  1. Temel oturum bilgilerini topla (session_id, timestamps, cwd)
  2. git diff --stat al (hızlı)
  3. Minimal session JSON yaz (atomic write, sessions/ dizinine)
  4. .events/ dizinine "session_ended" event yaz

işlem (kuyruğa, async):
  5. Payload'ı queue/ dizinine yaz
     → Kuyruk işleyici:
       a. transcript_path'ten highlights parse et (max 100 msg / 6K token)
       b. Checkpoint'leri merge et
       c. Tam oturum logunu güncelle (session JSON'u zenginleştir)
       d. Sanitization uygula
       e. CLAUDE.md ctx-lab bloğunu güncelle
       f. Git sync: add → commit → push (non-blocking)
stdout → yok
```

---

## 6. Install / Uninstall / Doctor

### 6.1 Install (install.rs)

```
ctx-lab-hook install
  1. ~/.claude/settings.json'u oku
  2. Mevcut yedek al: settings.json.ctx-lab-backup
  3. hooks bloğunu patch et (varsa güncelle, yoksa ekle)
     - Her hook'a "ctx-lab-managed": true marker ekle (JSON comment yok, ayrı alan)
  4. JSON validate et (serde_json::from_str)
     → Geçersizse: yedekten geri yükle, hata raporla
  5. ~/.ctx-lab/ dizin yapısını initialize et
  6. config.toml yoksa varsayılan oluştur
  7. Makine profili oluştur (machines/{hostname}.toml)
  8. "✅ ctx-lab hooks installed" mesajı
```

### 6.2 Doctor (doctor.rs)

```
ctx-lab-hook doctor
  Kontroller:
  ✓ ~/.ctx-lab/ dizini var mı
  ✓ config.toml parse edilebiliyor mu
  ✓ ~/.claude/settings.json'da hook'lar tanımlı mı
  ✓ Hook binary PATH'te mi
  ✓ Git repo initialized mı
  ✓ SQLite (varsa) açılabiliyor mu
  ✓ Son 5 event dosyası okunabiliyor mu
  ✓ Quarantine'de dosya var mı (uyarı)
  ✓ Orphan checkpoint var mı (uyarı)

  Çıktı:
  ctx-lab doctor report:
    [OK] Data directory: ~/.ctx-lab/
    [OK] Config: valid
    [OK] Hooks: 4/4 registered
    [OK] Git repo: initialized
    [WARN] Quarantine: 2 files (run ctx-lab-hook doctor --fix to clean)
    [OK] Overall: healthy
```

---

## 7. Test Stratejisi

### 7.1 Golden Fixture Tests

`tests/fixtures/` altında 20 farklı senaryo:

| Fixture | Senaryo |
|---------|---------|
| `01_simple_session.json` | Normal oturum: başla → çalış → kapat |
| `02_crash_recovery.json` | Oturum kapanmadan terminal kill |
| `03_new_project.json` | İlk kez görülen proje (auto-register) |
| `04_resume_session.json` | source: "resume" ile devam eden oturum |
| `05_long_transcript.json` | 500+ mesajlık transcript (truncation testi) |
| `06_api_key_in_transcript.json` | Transcript'te API key (sanitization) |
| `07_concurrent_sessions.json` | Aynı projede 2 eşzamanlı oturum |
| `08_empty_roadmap.json` | Boş roadmap ile oturum |
| `09_all_phases_complete.json` | Tüm fazlar tamamlandıktan sonra oturum |
| `10_metadata_only_mode.json` | privacy_mode = "metadata-only" |

### 7.2 Chaos Tests

```rust
#[test]
fn test_half_written_json_quarantined() {
    // Yarım JSON yaz, safe_read_json'ın quarantine ettiğini doğrula
}

#[test]
fn test_concurrent_checkpoint_write() {
    // 3 thread aynı anda checkpoint yazıyor, hiçbiri bozulmuyor
}

#[test]
fn test_missing_fields_forward_compat() {
    // schema_version=1 JSON'da olmayan alanlar → default değer
}

#[test]
fn test_sanitize_all_patterns() {
    // Her secret pattern'i test et
}
```

---

## 8. Cross-Platform Build

```bash
# macOS (host machine)
cargo build --release -p ctx-lab-hook

# Cross-compile (CI'da)
# macOS aarch64
cargo build --release --target aarch64-apple-darwin -p ctx-lab-hook
# macOS x86_64
cargo build --release --target x86_64-apple-darwin -p ctx-lab-hook
# Windows
cargo build --release --target x86_64-pc-windows-msvc -p ctx-lab-hook
```

---

## 9. Faz A Çıkış Kriterleri

| Kriter | Detay |
|--------|-------|
| ✅ Temel akış | install → Claude Code oturumu → session log oluşur |
| ✅ Atomic write | Tüm dosya yazımları tmp→rename ile |
| ✅ Schema version | Her JSON'da schema_version=1 |
| ✅ Quarantine | Bozuk JSON quarantine'e taşınır |
| ✅ Doctor | `ctx-lab-hook doctor` sağlık raporu veriyor |
| ✅ Sanitization | API key içeren transcript'te [REDACTED] |
| ✅ Privacy config | `privacy_mode` alanı config'de var (v1'de sadece "full" çalışır) |
| ✅ Transcript fallback | Transcript okunamazsa git-diff fallback devreye giriyor |
| ✅ CLAUDE.md injection | ctx-lab:start/end marker'ları ile blok yazılıyor, mevcut içerik korunuyor |
| ✅ Crash recovery | Terminal kill → sonraki session'da recovered log |
| ✅ Cross-platform | macOS + Windows binary çalışıyor |
| ✅ Golden tests | 10+ fixture testi geçiyor |
| ✅ Latency | SessionStart <50ms, diğer hook'lar <5ms (fire-and-forget) |
| ✅ 50 oturum simülasyonu | 1 gün boyunca veri kaybı yok |

---

*Bu doküman Faz A'nın tam implementasyon spesifikasyonudur. Claude Code'a verildiğinde Cargo workspace + hook binary iskeletini büyük ölçüde üretebilir.*
