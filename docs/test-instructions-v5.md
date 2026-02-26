# Seslog Desktop App — Test Instructions v5

**Date:** 2026-02-26
**For:** Reviewer / QA Agent
**Scope:** Targeted review of v4 report fixes + sidebar async migration
**Method:** Static analysis of changed files only (no need for full regression — v4 covered it)
**Build Status (developer-reported):** cargo build OK, clippy clean, 181 tests pass

---

## What Changed Since v4

Five items from the v4 report have been addressed:

### Fix 1: Dead CSS Removal (v4 L.1 #1, #2)
- **Removed** `.action-msg` class from `styles.css` (was line 744)
- **Removed** `.status-msg` class from `styles.css` (was line 751)
- **Verify:** Neither class should exist anywhere in `styles.css`. No Rust code ever referenced them (toast system replaced both).

### Fix 2: Keyboard Shortcut Input Conflict (v4 L.1 #3)
- **Added** `onkeydown: move |evt: KeyboardEvent| { evt.stop_propagation(); }` to the sidebar search `<input>` in `sidebar.rs`
- **Effect:** Typing "123" in the search box no longer triggers page navigation
- **Verify:** The search input element has both `oninput` and `onkeydown` handlers. The `onkeydown` calls `stop_propagation()` which prevents the event from bubbling to the root div's keyboard handler.
- **Edge case check:** Settings dropdowns and checkboxes do NOT need this fix (users don't type characters into select/checkbox elements).

### Fix 3: Sidebar Async Loading (v4 L.2 #2)
- **Changed** `sidebar.rs` from synchronous `commands::get_projects_inner(pool)` to `use_resource` with async closure
- **Removed** the old `_refresh: Signal<u64>` unused variable (was just a dependency trigger)
- **New pattern:**
  ```rust
  let refresh: Signal<u64> = use_context();
  let resource = use_resource(move || async move {
      refresh(); // track refresh dependency
      let pool = crate::get_db_pool();
      commands::get_projects_inner(pool).unwrap_or_default()
  });
  let projects = resource().unwrap_or_default();
  ```
- **Verify:** Sidebar now follows the same `use_resource` pattern as all 4 data pages. While resource is loading, `projects` defaults to empty vec (sidebar shows no projects momentarily).
- **Note:** This means the sidebar now tracks the refresh signal properly — when the watcher detects file changes, the sidebar project list updates automatically (same mechanism as dashboard/overview).

### Fix 4: ARIA Labels (v4 L.3 #4)
- **Added** `"aria-label": "Breadcrumb"` to the `<nav>` element in the `Breadcrumb` component in `components.rs`
- **Verify:** The `nav` element rendering the breadcrumb now has: `nav { class: "breadcrumb", "aria-label": "Breadcrumb", ... }`

### Fix 5: Keyboard Shortcut Hints (v4 L.3 #5)
- **Added** `span { class: "shortcut-hint", "1" }` to Dashboard nav item
- **Added** `span { class: "shortcut-hint", "2" }` to Overview nav item
- **Added** `span { class: "shortcut-hint", "3" }` to Settings nav item
- **Added** `.shortcut-hint` CSS class to `styles.css`:
  ```css
  .shortcut-hint {
      margin-left: auto;
      font-size: 11px;
      color: var(--text-muted);
      background: var(--bg-tertiary);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: monospace;
      line-height: 1;
      opacity: 0.6;
  }
  ```
- **Verify:** Each of the 3 main nav items (Dashboard, Overview, Settings) shows a small monospace badge on the right side indicating the keyboard shortcut number.

---

## Files to Review

| File | Changes |
|------|---------|
| `crates/seslog-app/assets/styles.css` | `.action-msg` removed, `.status-msg` removed, `.shortcut-hint` added |
| `crates/seslog-app/src/ui/sidebar.rs` | `use_resource` async, `onkeydown` stop_propagation on search input, shortcut hint spans |
| `crates/seslog-app/src/ui/components.rs` | `aria-label` on breadcrumb nav |

---

## Review Checklist

### A. Dead CSS Verification
| Check | Expected |
|-------|----------|
| `.action-msg` in styles.css | NOT present |
| `.status-msg` in styles.css | NOT present |
| No other dead CSS introduced | True |

### B. Keyboard Input Guard
| Check | Expected |
|-------|----------|
| `sidebar.rs` search input has `onkeydown` handler | Present, calls `evt.stop_propagation()` |
| Typing in search does NOT trigger nav shortcuts | Correct (event doesn't bubble) |
| Escape key in search still works for app nav | Depends — Escape is also stopped. Developer may want to only stop `Character` keys. Check if this is acceptable. |

### C. Sidebar Async
| Check | Expected |
|-------|----------|
| `use_resource` in sidebar.rs | Present with `refresh()` dependency |
| No synchronous `get_projects_inner` in render path | Correct |
| Old `_refresh` variable removed | Yes |
| `resource().unwrap_or_default()` handles loading state | Yes (empty project list during load) |

### D. ARIA
| Check | Expected |
|-------|----------|
| Breadcrumb `<nav>` has `aria-label` | `"Breadcrumb"` |

### E. Shortcut Hints
| Check | Expected |
|-------|----------|
| Dashboard nav item has `shortcut-hint` span with "1" | Yes |
| Overview nav item has `shortcut-hint` span with "2" | Yes |
| Settings nav item has `shortcut-hint` span with "3" | Yes |
| `.shortcut-hint` CSS class defined | Yes |
| Hints align to right side of nav item | `margin-left: auto` |
| Hints are subtle/muted | `opacity: 0.6`, muted color, small font |

### F. Regression Quick Check
| Check | Expected |
|-------|----------|
| Build succeeds | `cargo build -p seslog-app` OK |
| All tests pass | 181 tests, 0 failures |
| Clippy clean | No warnings |
| Sidebar search still works | Filtering projects by name |
| Keyboard shortcuts 1/2/3 still work | Navigate to Dashboard/Overview/Settings |
| Escape still navigates back | Session→Project, Project→Dashboard |
| Toast notifications still work | Settings and project detail actions |
| Breadcrumbs still render | Project detail and session detail |

---

## Expected Outcome

These are all minor fixes (dead CSS, UX polish, consistency). No scoring changes expected — the app should remain at **9/10 overall** with these v4 issues resolved.

If this review finds no new issues, this can be the final review cycle.

---

*Instructions prepared for targeted v5 review.*
