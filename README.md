# Seslog

> Automatic session tracking and context management for Claude Code.

Seslog hooks into [Claude Code](https://docs.anthropic.com/en/docs/claude-code)'s lifecycle events to track every coding session, inject project context at startup, and sync progress across machines -- all without manual tagging.

[TODO: screenshot of desktop app]

## Features

- **Automatic session tracking** -- Every Claude Code session is recorded with timestamps, file changes, and summaries. No manual start/stop.
- **Context injection** -- At session start, Seslog writes project status, last session summary, and active roadmap step into `CLAUDE.md` so Claude always knows where you left off.
- **Roadmap tracking** -- Markdown-based roadmap format with phase headers and status checkboxes (`[x]` done, `[>]` active, `[ ]` pending, `[~]` suspended, `[!]` blocked). Progress is calculated and displayed automatically.
- **Session summaries** -- Generate summaries via voice command ("oturum ozet") with a priority chain: manual summary > transcript analysis > git diff fallback.
- **Multi-machine sync** -- The `~/.seslog/` data directory is a git repository. Seslog pulls on session start and pushes on session end, keeping all machines in sync.
- **Privacy mode** -- Secret sanitization strips API keys, tokens, and credentials from stored data. Configurable via `config.toml`.
- **Desktop app** -- Native macOS application built with Tauri v2. Sidebar project list, accordion session rows, session timeline, roadmap viewer, and decision history.
- **Dark/light theme** -- System-aware theme toggle with persistent preference.
- **Zoom control** -- Adjustable font size with localStorage persistence.
- **Internationalization** -- English and Turkish language support with in-app language selector.

## How It Works

Seslog registers four hooks into Claude Code's hook system (`~/.claude/settings.json`):

```
SessionStart          PostToolUse           Stop               SessionEnd
(synchronous)         (fire-and-forget)     (fire-and-forget)  (fire-and-forget)
     |                      |                    |                   |
     v                      v                    v                   v
 Git sync pull         Checkpoint:           Record stop        Finalize session
 Load project meta     record file changes   event              Git sync push
 Inject context        Queue processing                         Process queue
 Update CLAUDE.md
 Output JSON to stdout
```

1. **SessionStart** -- Runs synchronously. Pulls latest data from git remote, loads the project's last session summary and active roadmap step, injects context into `CLAUDE.md`, and returns `additionalContext` JSON to Claude Code via stdout.
2. **PostToolUse (Checkpoint)** -- Fires after each tool use. Records file changes and queues them for processing.
3. **Stop** -- Records the stop event for session duration tracking.
4. **SessionEnd** -- Finalizes the session record, processes any remaining queue items, and pushes changes to the git remote.

## Installation

### From Source

```bash
# Clone the repository
git clone https://github.com/cagrisahin/seslog.git
cd seslog

# Build the release binary
cargo build --release

# Install hooks into Claude Code
./target/release/seslog install
```

The `seslog install` command:
- Patches `~/.claude/settings.json` with all four hook entries
- Creates the `~/.seslog/` data directory with default config
- Sets up `.gitignore` for cache files
- Registers the current machine
- Creates a symlink at `/usr/local/bin/seslog`

### Verify Installation

```bash
seslog doctor
```

### Uninstall

```bash
seslog uninstall
```

## Configuration

Seslog stores its configuration at `~/.seslog/config.toml`:

```toml
schema_version = 1
privacy_mode = "full"
checkpoint_interval_minutes = 10
additional_context_max_chars = 1500
transcript_max_messages = 100
transcript_max_tokens = 6000
sanitize_secrets = true
```

| Key                            | Default  | Description                                      |
| ------------------------------ | -------- | ------------------------------------------------ |
| `privacy_mode`                 | `"full"` | Privacy level for stored data (future-proof field)|
| `checkpoint_interval_minutes`  | `10`     | Minimum minutes between checkpoint writes         |
| `additional_context_max_chars` | `1500`   | Max characters for context injected at session start |
| `transcript_max_messages`      | `100`    | Max messages to store from session transcript     |
| `transcript_max_tokens`        | `6000`   | Max tokens for transcript storage                 |
| `sanitize_secrets`             | `true`   | Strip API keys and tokens from stored data        |

### Data Directory Structure

```
~/.seslog/
  config.toml
  .gitignore
  machines/
    macbook.toml
    desktop.toml
  projects/
    my-project/
      meta.toml
      roadmap.md
      sessions/
        2026-02-22T10-30-00Z.json
  queue/
  cache.db
```

## Roadmap Format

Seslog uses a markdown-based roadmap format stored at `~/.seslog/projects/<slug>/roadmap.md`. Phase headers are `##` headings, and items use checkbox syntax with five status markers:

```markdown
## Phase 1: Foundation
- [x] Completed item
- [>] Currently active item
- [ ] Pending item
- [~] Suspended item
- [!] Blocked item

## Phase 2: Features
- [ ] Upcoming work
- [ ] Another task
```

| Marker | Status    | Meaning                          |
| ------ | --------- | -------------------------------- |
| `[x]`  | Done      | Completed                        |
| `[>]`  | Active    | Currently being worked on        |
| `[ ]`  | Pending   | Not yet started                  |
| `[~]`  | Suspended | Paused, will resume later        |
| `[!]`  | Blocked   | Cannot proceed, dependency issue |

Progress percentage is calculated as `done / total * 100`. When you complete the active item, the next pending item is automatically promoted to active.

## Desktop App

The desktop application is built with Tauri v2 (Rust backend) and React 19 + TypeScript + Tailwind CSS 4 (frontend).

```bash
# Development
cd frontend && npm install && npm run dev

# Build (requires Tauri CLI)
cargo tauri build
```

[TODO: screenshot of desktop app dashboard]

### App Features

- Project list sidebar with search
- Session timeline with accordion rows
- Roadmap viewer with progress bar
- Decision history tracking
- Quick resume for recent sessions
- Dark/light theme toggle
- Zoom/font-size controls
- Settings page with language selector (English/Turkish)

## CLI Commands

| Command             | Description                                      |
| ------------------- | ------------------------------------------------ |
| `seslog install`    | Register hooks in Claude Code settings           |
| `seslog uninstall`  | Remove hooks from Claude Code settings           |
| `seslog doctor`     | Verify installation and diagnose issues          |
| `seslog summary "<text>"` | Store a session summary manually           |
| `seslog process-queue`    | Process pending queue items                |

The following commands are invoked automatically by Claude Code hooks and are not intended for direct use:

| Command                | Hook Event    |
| ---------------------- | ------------- |
| `seslog session-start` | SessionStart  |
| `seslog checkpoint`    | PostToolUse   |
| `seslog stop`          | Stop          |
| `seslog session-end`   | SessionEnd    |

## Comparison

| Feature                          | Seslog | ccboard | ccusage | Claude Squad |
| -------------------------------- | :----: | :-----: | :-----: | :----------: |
| Automatic session tracking       |   Yes  |   Yes   |    --   |     Yes      |
| Context injection (CLAUDE.md)    |   Yes  |    --   |    --   |      --      |
| Roadmap tracking                 |   Yes  |    --   |    --   |      --      |
| Session summaries                |   Yes  |    --   |    --   |      --      |
| Multi-machine git sync           |   Yes  |    --   |    --   |      --      |
| Desktop app (native)             |   Yes  |    --   |    --   |      --      |
| Web dashboard                    |   --   |   Yes   |    --   |      --      |
| Cost / token tracking            |   --   |    --   |   Yes   |      --      |
| Multi-session management (tmux)  |   --   |    --   |    --   |     Yes      |
| Privacy / secret sanitization    |   Yes  |    --   |    --   |      --      |
| Chrome extension                 |   --   |    --   |    --   |      --      |
| Hook-based (zero friction)       |   Yes  |   Yes   |    --   |      --      |

**Seslog's differentiators:** context injection into `CLAUDE.md` so Claude knows your project state on every session start, structured roadmap tracking with automatic progress calculation, and multi-machine sync via git.

## Tech Stack

| Layer     | Technology                             |
| --------- | -------------------------------------- |
| Core lib  | Rust (`seslog-core`)                   |
| CLI       | Rust + Clap (`seslog`)                 |
| Desktop   | Tauri v2 (`seslog-app`)               |
| Frontend  | React 19 + TypeScript + Tailwind CSS 4 |
| Storage   | JSON files + SQLite cache              |
| Sync      | Git (libgit2 via `git2` crate)         |

## License

MIT
