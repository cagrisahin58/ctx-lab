# ctx-lab

> Stop losing your train of thought across research projects and machines.
> Resume any project in seconds using your AI coding sessions.

A desktop application that automatically tracks your Claude Code sessions, builds a project dashboard with roadmaps, and syncs across machines via Git.

## Features

- **Automatic Session Tracking** - ctx-lab captures every Claude Code session automatically
- **Project Dashboard** - View all projects with progress, sessions, and summaries
- **Roadmap Management** - Track tasks with markdown-based roadmaps
- **Multi-Machine Sync** - Sync via Git to work across MacBook, desktop, etc.
- **Privacy Modes** - Choose what data to store (full, summary-only, metadata-only)
- **Glassmorphism UI** - Beautiful modern dark theme

## Quick Start

### From Source

```bash
# Clone and build
git clone https://github.com/cagri/ctx-lab
cd ctx-lab/ctx-lab

# Run
cargo run

# Build release
cargo build --release
```

### From Release

Download the latest release for your platform from [GitHub Releases](https://github.com/cagri/ctx-lab/releases).

## Usage

1. **Open ctx-lab** - Launch the app
2. **Work in Claude Code** - Your sessions are tracked automatically
3. **View Dashboard** - See all projects and progress
4. **Manage Roadmaps** - Add tasks and track completion

## Configuration

Settings are stored in `~/.ctx-lab/`:
- `cache.db` - SQLite database
- `config.toml` - User preferences

### Privacy Modes

| Mode | Description |
|------|-------------|
| `full` | Store all session data |
| `summary-only` | Only summaries, no file changes |
| `metadata-only` | Only timestamps and stats |

## Architecture

```
src/
├── lib.rs        # Main app (Dioxus UI)
├── db.rs         # SQLite database
├── reconcile.rs  # File system sync
├── watcher.rs    # File watching
├── commands.rs   # IPC commands
├── sync.rs       # Git sync
├── logging.rs    # Log rotation
└── tray.rs       # System tray
```

## Development

```bash
# Format
cargo fmt

# Lint
cargo clippy

# Test
cargo test
```

## License

MIT
