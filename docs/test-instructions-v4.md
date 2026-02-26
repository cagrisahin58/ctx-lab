# Seslog Desktop App — Test Instructions v4

**Date:** 2026-02-26
**For:** Reviewer / QA Agent
**Scope:** Full static code analysis + runtime UI testing after v3 report fixes + Phase 9 Polish

---

## 0. Build & Run Instructions

### Prerequisites
- Rust toolchain (rustup): `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- On macOS: Xcode Command Line Tools (`xcode-select --install`)
- On Linux: `libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev` (for Dioxus desktop WebView)
- Seslog data directory: `~/.seslog/` (auto-created if seslog-hook is installed)

### Quick Start
```bash
# Clone and navigate
cd /path/to/hooks

# Source Rust environment (if not in PATH)
source "$HOME/.cargo/env"

# Run all tests (181+ tests)
cargo test --workspace

# Check for warnings
cargo clippy --workspace -- -D warnings

# Build the desktop app
cargo build -p seslog-app

# Run the desktop app (opens a 1200x800 window)
cargo run -p seslog-app

# Release build (optimized)
cargo build -p seslog-app --release
```

### Sample Data Setup (for testing with real data)
If `~/.seslog/` is empty, the app will show empty states. To get test data:
```bash
# Option 1: Install the seslog hook and use Claude Code normally
cargo install --path crates/seslog-hook
seslog install

# Option 2: Create minimal test data manually
mkdir -p ~/.seslog/projects/test-project/sessions
cat > ~/.seslog/projects/test-project/meta.toml << 'EOF'
name = "test-project"
status = "active"
paths = ["/tmp/test-project"]
EOF

cat > ~/.seslog/projects/test-project/sessions/test-session.json << 'EOF'
{
  "session_id": "test-001",
  "started_at": "2026-02-26T10:00:00Z",
  "ended_at": "2026-02-26T10:30:00Z",
  "machine": "test-machine",
  "duration_minutes": 30,
  "files_changed": 5,
  "summary": "Test session for UI verification.\nThis is a multi-line summary.",
  "next_steps": "Continue testing the application.",
  "transcript_highlights": ["Fixed a bug", "Added a feature", "Wrote tests"],
  "model": "claude-sonnet-4-20250514",
  "token_count": 125000,
  "estimated_cost_usd": 0.42,
  "recovered": false
}
EOF

cat > ~/.seslog/projects/test-project/roadmap.md << 'EOF'
## Phase 1: Setup
- [x] Initialize project {id: init}
- [x] Setup CI/CD {id: ci, depends: init}

## Phase 2: Development
- [>] Implement core feature {id: core, depends: ci}
- [ ] Add tests {id: tests, depends: core}
- [~] Optional enhancement {id: enhance}
EOF
```

### What the App Does on Startup
1. Initializes tracing/logging (to `~/.seslog/logs/`)
2. Runs git sync pull (if remote configured)
3. Opens/creates SQLite cache at `~/.seslog/cache.db`
4. Full rebuild: scans `~/.seslog/projects/` and `~/.seslog/machines/`
5. Starts filesystem watcher on `~/.seslog/`
6. Starts periodic reconcile (every 10 min)
7. Opens Dioxus desktop window (1200×800, title "Seslog")

---

## Background

This is the **fourth review cycle** of the Seslog Dioxus desktop application. Previous reviews:
- **v1:** Found 22 issues → all fixed
- **v2:** Found P0/P1/P2 improvements → all fixed
- **v3:** Scored 8/10 overall PASS, found 2 actionable items + rated P3 polish items
- **This cycle:** v3 actionable items fixed + all P3 polish items (except P3-low) implemented

## What Changed Since v3

### v3 Actionable Fixes
1. **Section 7.2 — total_cost scope:** `total_cost` was computed from `detail.recent_sessions` (last 20). Now `ProjectSummaryResponse` has a dedicated `total_cost: f64` field populated by `COALESCE(SUM(s.estimated_cost_usd), 0.0)` aggregate query across ALL sessions. Verify in:
   - `commands.rs`: `get_projects_inner` SQL query and struct mapping
   - `commands.rs`: `get_project_detail_inner` SQL query and struct mapping
   - `project_detail.rs`: uses `summary.total_cost` not session sum

2. **Section 9 — Responsiveness (was 7/10):** Added two responsive breakpoints:
   - `@media (max-width: 768px)`: sidebar collapses, grids stack to single column, overview table scrolls horizontally, project-layout stacks vertically
   - `@media (max-width: 480px)`: further font/padding reductions for very narrow screens
   - Verify in `assets/styles.css` at the bottom

### Phase 9 New Features (6 items)

#### P1: Skeleton Loading States
- **Files:** `components.rs` (skeleton components), `styles.css` (shimmer animation)
- **Components created:** `SkeletonLine`, `SkeletonCard`, `SkeletonRow`, `DashboardSkeleton`, `ProjectDetailSkeleton`, `SessionDetailSkeleton`, `OverviewSkeleton`
- **Integration:** All 4 data pages use `use_resource` → show skeleton while data loads, then real content
- **CSS:** `@keyframes shimmer` gradient animation, `.skeleton` base class with variants
- **Verify:** Each page (dashboard, project_detail, session_detail, overview) has a `match resource() { None => return rsx! { XxxSkeleton {} }, ... }` pattern

#### P2: Toast Notification System
- **Files:** `state.rs` (Toast, ToastKind types), `components.rs` (show_toast, ToastContainer), `app.rs` (context provider), `styles.css` (toast CSS)
- **Types:** `Toast { message, kind, id }`, `ToastKind { Success, Error, Info }`
- **Auto-dismiss:** 3-second timer via polling (100ms ticks × 30)
- **Manual dismiss:** X button on each toast
- **Animation:** `@keyframes toast-slide-in` from right
- **Glass morphism:** `backdrop-filter: blur(10px)`, border colors per type (green/red/blue)
- **Integration points:**
  - `settings.rs`: All 10+ status messages converted from `status_msg` signal to `show_toast()`
  - `project_detail.rs`: "Open in VS Code" and "Rebuild Cache" actions use toasts
- **Verify:** No `status_msg` signal should remain anywhere. `use_context::<Signal<Vec<Toast>>>()` should be used instead
- **Light theme:** Verify `.theme-light .toast` overrides exist

#### P2: Breadcrumb Navigation
- **Files:** `components.rs` (Crumb struct, Breadcrumb component), `styles.css` (breadcrumb CSS)
- **Structure:** `Vec<Crumb>` where `Crumb { label, view: Option<View> }` — last item has `view: None` (current page, not clickable)
- **Integration:**
  - `project_detail.rs`: Dashboard > ProjectName
  - `session_detail.rs`: Dashboard > ProjectID > SessionTitle
- **CSS classes:** `.breadcrumb`, `.breadcrumb-link`, `.breadcrumb-sep` (shows " / "), `.breadcrumb-current`
- **Verify:** Back buttons should NOT exist anymore on project_detail and session_detail pages. Breadcrumbs replace them.
- **Light theme:** Verify `.theme-light .breadcrumb-link` styles

#### P2: Keyboard Shortcuts
- **File:** `app.rs`
- **Root div:** Must have `tabindex: "0"` for keyboard focus
- **Handler:** `onkeydown` on the root `div.app-container`
- **Shortcuts:**
  - `Escape`: Navigate back (Session → Project, Project → Dashboard, others → no-op)
  - `1`: Go to Dashboard
  - `2`: Go to Overview
  - `3`: Go to Settings
- **Verify:** Uses `Key::Escape`, `Key::Character(ref c) if c == "1"` pattern (Dioxus keyboard API)

#### P2: Sidebar Project Search/Filter
- **File:** `sidebar.rs`
- **Search input:** `<input class="sidebar-search" placeholder="Search projects...">` positioned between "Projects" label and project list
- **Filter logic:** Case-insensitive `.contains()` on project name
- **Empty state:** `<div class="sidebar-empty">No matches</div>` when filter yields no results
- **CSS classes:** `.sidebar-search`, `.sidebar-empty`
- **Verify:** `search_query` signal, `filtered_projects` used for iteration (not `projects` directly)

#### P2: Async Data Loading (use_resource)
- **All 4 data pages** converted from synchronous DB calls to `use_resource`:
  - `dashboard.rs`: `use_resource(|| async { get_projects_inner(pool) })`
  - `project_detail.rs`: `use_resource(|| async { get_project_detail_inner(pool, pid) })`
  - `session_detail.rs`: `use_resource(|| async { get_session_by_id(pool, &pid, &sid) })`
  - `overview.rs`: `use_resource(|| async { get_overview_inner(pool, include_archived) })`
- **Pattern:** Each resource returns `Option<T>` (using `.ok()` or `.unwrap_or_default()`) because `anyhow::Error` doesn't implement `Clone` (required by Dioxus `Resource<T>`)
- **Dependency tracking:** Each resource closure calls `refresh()` to track the refresh signal, ensuring re-fetch when watcher detects filesystem changes
- **Verify:** No synchronous `commands::xxx()` calls should remain in the rendering path of these 4 pages

---

## Full Review Checklist

Please score each section and identify any remaining issues.

### A. Data Layer (commands.rs, db.rs, reconcile.rs)

1. **total_cost aggregate query**: Verify `get_projects_inner` and `get_project_detail_inner` both have `COALESCE(SUM(s.estimated_cost_usd), 0.0) AS total_cost` in their SQL
2. **ProjectSummaryResponse**: Verify `total_cost: f64` field exists and is mapped from query results
3. **project_detail.rs**: Verify it uses `summary.total_cost` (not computed from `detail.recent_sessions`)
4. **All existing tests still pass**: 181+ tests (developer-reported: `cargo test --workspace` passes)

### B. Skeleton Loading States

1. Verify `@keyframes shimmer` animation in CSS
2. Verify 7 skeleton components exist: `SkeletonLine`, `SkeletonCard`, `SkeletonRow`, `DashboardSkeleton`, `ProjectDetailSkeleton`, `SessionDetailSkeleton`, `OverviewSkeleton`
3. Verify all 4 pages use `use_resource` + skeleton fallback pattern
4. Verify skeleton CSS classes: `.skeleton`, `.skeleton-line`, `.skeleton-card`, `.skeleton-row`, `.skeleton-circle`, `.skeleton-progress`, `.skeleton-badge`

### C. Toast Notification System

1. Verify `Toast` and `ToastKind` types in `state.rs`
2. Verify `show_toast()` helper and `ToastContainer` component in `components.rs`
3. Verify toast context provider in `app.rs`: `Signal<Vec<Toast>>`
4. Verify `ToastContainer {}` is rendered in the root App
5. Verify auto-dismiss logic (polling timer, 3s timeout)
6. Verify `settings.rs` has NO remaining `status_msg` signal — all replaced by toast calls
7. Verify `project_detail.rs` uses toast for action feedback
8. Verify toast CSS: `.toast-container`, `.toast`, `.toast-success`, `.toast-error`, `.toast-info`, animation, light theme variants
9. Verify toast close button (`.toast-close`)

### D. Breadcrumb Navigation

1. Verify `Crumb` struct and `Breadcrumb` component in `components.rs`
2. Verify breadcrumb CSS classes in `styles.css`
3. Verify `project_detail.rs` renders `Breadcrumb { crumbs: [...] }` (Dashboard > ProjectName)
4. Verify `session_detail.rs` renders breadcrumb (Dashboard > ProjectID > SessionTitle)
5. Verify NO back buttons remain on project_detail and session_detail pages
6. Verify clickable segments navigate correctly (view is `Some(...)`)
7. Verify current segment is non-clickable (view is `None`)

### E. Keyboard Shortcuts

1. Verify root div in `app.rs` has `tabindex: "0"`
2. Verify `onkeydown` handler with Escape, 1, 2, 3 keys
3. Verify Escape logic: Session→Project, Project→Dashboard, others→no-op
4. Verify number keys: 1→Dashboard, 2→Overview, 3→Settings

### F. Sidebar Search

1. Verify search input in `sidebar.rs` with `.sidebar-search` class
2. Verify case-insensitive filtering logic
3. Verify "No matches" empty state
4. Verify CSS for `.sidebar-search` and `.sidebar-empty`
5. Verify filtering doesn't affect nav items (Dashboard, Overview, Settings should always show)

### G. Async Data Loading

1. Verify all 4 pages use `use_resource` (not synchronous calls in render)
2. Verify each resource tracks `refresh()` dependency
3. Verify return types are `Option<T>` (not `Result<T, anyhow::Error>`)
4. Verify `overview.rs` also tracks `include_archived()` as a dependency

### H. Responsive CSS

1. Verify `@media (max-width: 768px)` breakpoint exists with:
   - Sidebar hiding/collapsing
   - Grid stacking (`.projects-grid`, `.session-meta-grid`, `.stat-grid`)
   - Overview table horizontal scroll
   - `.project-layout` stacking to single column
2. Verify `@media (max-width: 480px)` breakpoint with further reductions
3. Check that breakpoints don't conflict with existing 900px breakpoint on `.project-layout`

### I. Regression Check

Verify that all items from v1, v2, v3 still pass:
1. All 22 original issues (v1) remain fixed
2. P0/P1/P2 items from v2 remain fixed
3. CSS variable completeness (no missing variables)
4. SVG icon system intact (9 icons, consistent sizing)
5. No dead CSS classes reintroduced
6. Timeline dots still render
7. Toggle switch still works
8. CostBadge humanized format intact

### J. Code Quality

1. **No compilation errors** (developer reports: `cargo build` clean)
2. **No clippy warnings** (developer reports: `cargo clippy -- -D warnings` clean)
3. **Import hygiene**: No unused imports, proper module structure
4. **Pattern consistency**: All pages follow the same `use_resource → skeleton → content` pattern
5. **Signal usage**: Proper `use_context()` / `use_context_provider()` pairing

---

## Files to Review

### Primary (changed since v3)
| File | What to Check |
|------|---------------|
| `crates/seslog-app/src/commands.rs` | `total_cost` field in `ProjectSummaryResponse`, SQL aggregate queries |
| `crates/seslog-app/src/state.rs` | `Toast`, `ToastKind` types |
| `crates/seslog-app/src/ui/components.rs` | Skeleton components, Breadcrumb, Toast system, show_toast |
| `crates/seslog-app/src/ui/app.rs` | Toast context provider, ToastContainer, keyboard handler, tabindex |
| `crates/seslog-app/src/ui/dashboard.rs` | use_resource + DashboardSkeleton |
| `crates/seslog-app/src/ui/project_detail.rs` | use_resource + skeleton, breadcrumb, toast, total_cost |
| `crates/seslog-app/src/ui/session_detail.rs` | use_resource + skeleton, breadcrumb |
| `crates/seslog-app/src/ui/overview.rs` | use_resource + skeleton |
| `crates/seslog-app/src/ui/settings.rs` | All status_msg → toast migration |
| `crates/seslog-app/src/ui/sidebar.rs` | Search input + filter logic |
| `crates/seslog-app/assets/styles.css` | Skeleton CSS, toast CSS, breadcrumb CSS, search CSS, responsive breakpoints |

### Secondary (unchanged but verify for regression)
| File | What to Check |
|------|---------------|
| `crates/seslog-app/src/db.rs` | Schema unchanged |
| `crates/seslog-app/src/reconcile.rs` | Reconcile logic unchanged |
| `crates/seslog-app/src/ui/icons.rs` | 9 SVG icons intact |
| `crates/seslog-app/src/lib.rs` | Bootstrap + watcher unchanged |

---

## Expected Scoring (Developer Estimate)

Based on the work done, we expect improvements in these v3 categories:
- **Responsiveness:** Was 7/10 → should be 8-9/10 (two breakpoints added)
- **Accessibility:** Was 6/10 → should be 7/10 (keyboard shortcuts added)
- **Performance:** Was 7/10 → should be 8-9/10 (async loading + skeletons)
- **UI completeness:** Was 9/10 → should remain 9-10/10 (toast, breadcrumb, search added)

**Target overall: 9/10**

---

## Output Format

Please produce a test report in the same format as previous versions (test-report-v3.md), with:
1. Executive summary
2. Per-section analysis tables (PASS/FAIL/NOTE)
3. New features verification
4. Regression check results
5. Final scoring matrix
6. Any remaining items or observations

---

---

## K. Runtime UI Test Checklist

**These tests require running the app** (`cargo run -p seslog-app`). Perform them with at least one project in `~/.seslog/projects/`.

### K.1 App Launch & Window
| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 1 | Run `cargo run -p seslog-app` | Window opens, 1200×800, title "Seslog" | |
| 2 | Window background | Dark navy `#0f0f23` background, no white flash | |
| 3 | Sidebar visible | Left sidebar with logo "SL" + "Seslog", nav items | |
| 4 | Dashboard loads | Default view is Dashboard with project cards or empty state | |

### K.2 Sidebar Navigation
| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 5 | Click "Dashboard" | Dashboard view loads, nav item highlighted | |
| 6 | Click "Overview" | Overview table loads, nav item highlighted | |
| 7 | Click "Settings" | Settings page loads, nav item highlighted | |
| 8 | Click a project name | Project detail loads, project name highlighted in sidebar | |
| 9 | Sidebar scroll | If >10 projects, project list scrolls independently | |
| 10 | "Projects" section label | Shows "Projects" with uppercase, muted styling | |
| 11 | Dividers | Subtle horizontal lines separate nav sections | |

### K.3 Sidebar Search (NEW)
| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 12 | Search input visible | Text input between "Projects" label and project list | |
| 13 | Type project name | Project list filters to matching projects | |
| 14 | Case insensitive | "HOOKS" matches "hooks" project | |
| 15 | No matches | Shows "No matches" text in muted style | |
| 16 | Clear search | All projects reappear | |
| 17 | Nav items unaffected | Dashboard/Overview/Settings always visible during search | |

### K.4 Theme Toggle
| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 18 | Find toggle | Bottom of sidebar: moon icon + "Dark Mode" (default) | |
| 19 | Click toggle | Entire app switches to light theme (white/gray bg) | |
| 20 | Toggle text changes | Shows sun icon + "Light Mode" when in light theme | |
| 21 | Click again | Returns to dark theme | |
| 22 | Light sidebar | White bg, subtle shadow, readable text | |
| 23 | Light glass panels | White/translucent, no blur, subtle shadows | |
| 24 | Light buttons | Readable contrast in light mode | |

### K.5 Dashboard
| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 25 | Skeleton on load | Brief shimmer animation before data appears (may be instant on fast machines) | |
| 26 | Empty state | If no projects: folder icon + "No Projects Yet" message | |
| 27 | Hero card | Most recent active project shown as large card at top | |
| 28 | Hero click | Clicking hero card navigates to project detail | |
| 29 | "View Details" button | On hero card, navigates to project detail (no double-nav) | |
| 30 | Project grid | Active projects shown in responsive grid cards | |
| 31 | Card content | Each card: name, summary snippet, progress bar, session count, time | |
| 32 | Progress bar colors | Red (≤33%), amber (34-66%), green (>66%) | |
| 33 | Status dot | Green for active, gray/muted for archived | |
| 34 | Archived section | If archived projects exist: separate "Archived" section below | |
| 35 | Card click | Clicking any card navigates to project detail | |
| 36 | Subtitle | "N active projects" with correct count and pluralization | |

### K.6 Overview Table
| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 37 | Skeleton on load | Brief shimmer animation while loading | |
| 38 | Table headers | Name, Last Activity, Progress, Sessions, Time, Cost | |
| 39 | Sort by Name | Click "Name" header — rows reorder alphabetically | |
| 40 | Sort toggle | Click same header again — toggles Asc/Desc, arrow changes ↑/↓ | |
| 41 | Sort by Progress | Click "Progress" — sorts by percentage | |
| 42 | Sort by Cost | Click "Cost" — sorts by cost value | |
| 43 | Active sort highlight | Active column header has accent background | |
| 44 | Row click | Clicking a row navigates to project detail | |
| 45 | Include Archived | Toggle checkbox — archived projects appear/disappear | |
| 46 | Archived badge | Archived projects show small muted "archived" pill | |
| 47 | Cost column | Shows CostBadge (green ≤$1, amber >$1) or em-dash for zero | |
| 48 | Relative time | "Just now", "N min ago", "N hours ago", etc. in Last Activity column | |
| 49 | Empty state | If no projects: icon + "No Projects" message | |

### K.7 Project Detail
| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 50 | Skeleton on load | Brief shimmer animation | |
| 51 | Breadcrumb | "Dashboard / ProjectName" at top (Dashboard is clickable, ProjectName is not) | |
| 52 | Click breadcrumb | Click "Dashboard" in breadcrumb → navigates to Dashboard | |
| 53 | No back button | Old back button should NOT exist | |
| 54 | Page title | Project name + status dot (green for active) | |
| 55 | Two-column layout | Left: roadmap + sessions. Right: progress + stats + actions | |
| 56 | Roadmap section | Phase headings, checkbox items, dependency indentation | |
| 57 | Roadmap checkboxes | Done items: filled checkbox + strikethrough text | |
| 58 | Dependency items | Items with dependencies indented to the right | |
| 59 | Item ID badges | Monospace badges like `[init]`, `[core]` on roadmap items | |
| 60 | Dependency warnings | Amber warning boxes for broken dependency references | |
| 61 | Progress hero | Large percentage number (48px), task count below | |
| 62 | Progress bar | Color-coded, matches percentage | |
| 63 | Statistics panel | 4 stats: Total Sessions, Time Invested, Last Machine, Last Active | |
| 64 | Total cost | Shown with CostBadge below stats (if > $0) — reflects ALL sessions, not just last 20 | |
| 65 | Recent Sessions | Last 5 sessions as timeline items with dots | |
| 66 | Timeline dots | Small colored dots on left side of each timeline entry | |
| 67 | Timeline click | Click a session → navigates to Session Detail | |
| 68 | Timeline meta | Each session shows: machine, duration, files, cost badge | |
| 69 | "Open in VS Code" | Button works (opens VS Code at project path, or shows error toast) | |
| 70 | "Rebuild Cache" | Button works, shows toast with added/removed/updated counts | |
| 71 | Toast on action | Success/error toast appears (green/red), auto-dismisses after 3s | |

### K.8 Session Detail
| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 72 | Skeleton on load | Brief shimmer animation | |
| 73 | Breadcrumb | "Dashboard / ProjectID / SessionTitle" at top | |
| 74 | Click breadcrumb | Click "Dashboard" → Dashboard. Click "ProjectID" → Project Detail | |
| 75 | No back button | Old back button should NOT exist | |
| 76 | Page title | First line of summary as title, date as subtitle | |
| 77 | Meta grid | 6 cards: Date, Machine, Duration, Files Changed, Model, Recovered | |
| 78 | Cost & Tokens panel | Glass panel with token count (formatted K/M), estimated cost, model name | |
| 79 | Token formatting | e.g., 125000 → "125.0K", 1500000 → "1.5M" | |
| 80 | Cost badge | Green for ≤$1.00, amber for >$1.00, "< $0.01" for tiny amounts | |
| 81 | Summary section | Multi-line summary with preserved whitespace (pre-wrap) | |
| 82 | Next Steps section | Shown if non-empty, same pre-wrap styling | |
| 83 | Transcript Highlights | Each highlight in a styled card | |
| 84 | Not-found state | Navigate to invalid session → "Session Not Found" with icon | |

### K.9 Settings Page
| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 85 | Privacy dropdown | "Full" / "Summary Only" / "Metadata Only" — changes save | |
| 86 | Sanitize secrets toggle | Visual toggle switch (click to toggle), saves | |
| 87 | Checkpoint interval | Read-only display in monospace | |
| 88 | Hook status | Shows installed/not found status | |
| 89 | Run Doctor | Button executes `seslog doctor`, shows toast with result | |
| 90 | Reinstall Hook | Button executes `seslog install`, shows toast with result | |
| 91 | Sync status | Shows git repo status, remote, pending changes | |
| 92 | Machine profile | Shows hostname, platform, architecture | |
| 93 | Rebuild Cache | Full rebuild, shows toast with counts | |
| 94 | Support Bundle | Generates ZIP to Downloads, shows toast with path | |
| 95 | Toast behavior | ALL actions show toast (no old inline status text anywhere) | |

### K.10 Toast Notifications (NEW)
| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 96 | Toast appearance | Slides in from right side | |
| 97 | Success toast | Green accent, appears on successful actions | |
| 98 | Error toast | Red accent, appears on failed actions | |
| 99 | Auto-dismiss | Toast disappears after ~3 seconds | |
| 100 | Manual dismiss | Click X button on toast → immediately disappears | |
| 101 | Multiple toasts | Trigger multiple actions → toasts stack vertically | |
| 102 | Glass morphism | Toast has blur backdrop, semi-transparent background | |
| 103 | Light theme | Toast readable and styled in light theme | |

### K.11 Keyboard Shortcuts (NEW)
| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 104 | Focus requirement | Click on the app window first (focus needed for keyboard events) | |
| 105 | Press "1" | Navigates to Dashboard | |
| 106 | Press "2" | Navigates to Overview | |
| 107 | Press "3" | Navigates to Settings | |
| 108 | Navigate to Session, press Escape | Goes back to Project Detail | |
| 109 | In Project Detail, press Escape | Goes back to Dashboard | |
| 110 | In Dashboard, press Escape | No change (already at top level) | |

### K.12 Skeleton Loading States (NEW)
| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 111 | Dashboard skeleton | Gray shimmer cards visible before data loads | |
| 112 | Project Detail skeleton | Shimmer blocks for roadmap, stats, timeline areas | |
| 113 | Session Detail skeleton | Shimmer blocks for meta grid, sections | |
| 114 | Overview skeleton | Shimmer rows in table format | |
| 115 | No flash of empty | Pages should NOT show empty state then switch to content | |
| 116 | Shimmer animation | Smooth left-to-right gradient animation on skeleton elements | |

### K.13 Responsiveness
| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 117 | Resize to <768px wide | Sidebar collapses, grids stack to single column | |
| 118 | Overview at narrow | Table scrolls horizontally instead of squishing | |
| 119 | Project detail narrow | Two-column layout stacks to single column | |
| 120 | Resize to <480px | Further reductions in font size and padding | |
| 121 | Resize back to full | Layout restores to normal | |

### K.14 File Watcher Reactivity
| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 122 | App running + create new session JSON in `~/.seslog/projects/xxx/sessions/` | Dashboard updates within ~1 second | |
| 123 | Edit a project's `meta.toml` (change name) | Sidebar and dashboard reflect new name | |
| 124 | Edit a project's `roadmap.md` (check an item) | Project detail progress updates | |

---

## Scoring Guide

Please rate each category 1-10:

| Category | v3 Score | Expected v4 |
|----------|----------|-------------|
| Data integrity | 9/10 | 9-10/10 |
| UI completeness | 9/10 | 9-10/10 |
| Visual design | 8/10 | 8-9/10 |
| Code quality | 9/10 | 9-10/10 |
| CSS hygiene | 9/10 | 9/10 |
| Responsiveness | 7/10 | 8-9/10 |
| Accessibility | 6/10 | 7-8/10 |
| Performance | 7/10 | 8-9/10 |
| **UX Polish (NEW)** | — | ?/10 |

New "UX Polish" category covers: skeleton states, toast notifications, breadcrumbs, keyboard shortcuts, search/filter.

---

*Instructions prepared for comprehensive static code analysis + runtime UI testing.*
