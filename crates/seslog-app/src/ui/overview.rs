use dioxus::prelude::*;
use crate::commands::{self, OverviewRow};
use crate::state::View;
use super::components::{CostBadge, EmptyState, ProgressBar};

#[derive(Debug, Clone, Copy, PartialEq)]
enum SortField {
    Name,
    LastActivity,
    Progress,
    Sessions,
    Time,
    Cost,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum SortDir {
    Asc,
    Desc,
}

#[allow(non_snake_case)]
pub fn OverviewPage() -> Element {
    let _refresh: Signal<u64> = use_context();

    let mut include_archived = use_signal(|| false);
    let mut sort_field = use_signal(|| SortField::LastActivity);
    let mut sort_dir = use_signal(|| SortDir::Desc);

    let pool = crate::get_db_pool();
    let mut rows = commands::get_overview_inner(pool, include_archived()).unwrap_or_default();

    // Sort the rows
    sort_rows(&mut rows, sort_field(), sort_dir());

    let subtitle = if rows.is_empty() {
        "Cross-project overview".to_string()
    } else if rows.len() == 1 {
        "1 project".to_string()
    } else {
        format!("{} projects", rows.len())
    };

    if rows.is_empty() {
        return rsx! {
            div { class: "overview",
                div { class: "page-header",
                    h1 { class: "page-title", "Overview" }
                    p { class: "page-subtitle", "Cross-project overview" }
                }
                div { style: "margin-bottom: 16px;",
                    label { style: "display: flex; align-items: center; gap: 8px; color: var(--text-secondary); cursor: pointer;",
                        input {
                            r#type: "checkbox",
                            checked: include_archived(),
                            onchange: move |evt| {
                                include_archived.set(evt.checked());
                            },
                        }
                        "Include Archived"
                    }
                }
                EmptyState {
                    icon: "\u{1F4CB}".to_string(),
                    title: "No Projects".to_string(),
                    message: "No projects found. Start a Claude Code session to see data here.".to_string(),
                }
            }
        };
    }

    rsx! {
        div { class: "overview",
            div { class: "page-header",
                h1 { class: "page-title", "Overview" }
                p { class: "page-subtitle", "{subtitle}" }
            }

            // Controls
            div { style: "margin-bottom: 16px;",
                label { style: "display: flex; align-items: center; gap: 8px; color: var(--text-secondary); cursor: pointer;",
                    input {
                        r#type: "checkbox",
                        checked: include_archived(),
                        onchange: move |evt| {
                            include_archived.set(evt.checked());
                        },
                    }
                    "Include Archived"
                }
            }

            // Table
            div { style: "overflow-x: auto;",
                // Table header
                div { class: "overview-header",
                    SortButton {
                        label: "Project".to_string(),
                        field: SortField::Name,
                        current_field: sort_field(),
                        current_dir: sort_dir(),
                        on_click: move |_| toggle_sort(&mut sort_field, &mut sort_dir, SortField::Name),
                    }
                    SortButton {
                        label: "Last Activity".to_string(),
                        field: SortField::LastActivity,
                        current_field: sort_field(),
                        current_dir: sort_dir(),
                        on_click: move |_| toggle_sort(&mut sort_field, &mut sort_dir, SortField::LastActivity),
                    }
                    SortButton {
                        label: "Progress".to_string(),
                        field: SortField::Progress,
                        current_field: sort_field(),
                        current_dir: sort_dir(),
                        on_click: move |_| toggle_sort(&mut sort_field, &mut sort_dir, SortField::Progress),
                    }
                    SortButton {
                        label: "Sessions".to_string(),
                        field: SortField::Sessions,
                        current_field: sort_field(),
                        current_dir: sort_dir(),
                        on_click: move |_| toggle_sort(&mut sort_field, &mut sort_dir, SortField::Sessions),
                    }
                    SortButton {
                        label: "Time".to_string(),
                        field: SortField::Time,
                        current_field: sort_field(),
                        current_dir: sort_dir(),
                        on_click: move |_| toggle_sort(&mut sort_field, &mut sort_dir, SortField::Time),
                    }
                    SortButton {
                        label: "Cost".to_string(),
                        field: SortField::Cost,
                        current_field: sort_field(),
                        current_dir: sort_dir(),
                        on_click: move |_| toggle_sort(&mut sort_field, &mut sort_dir, SortField::Cost),
                    }
                }

                // Table rows
                for row in rows.iter() {
                    OverviewTableRow {
                        id: row.id.clone(),
                        name: row.name.clone(),
                        status: row.status.clone(),
                        last_session_at: row.last_session_at.clone().unwrap_or_default(),
                        progress_percent: row.progress_percent,
                        session_count: row.session_count,
                        total_minutes: row.total_minutes,
                        total_cost: row.total_cost,
                    }
                }
            }
        }
    }
}

#[component]
fn OverviewTableRow(
    id: String,
    name: String,
    status: String,
    last_session_at: String,
    progress_percent: f64,
    session_count: i64,
    total_minutes: i64,
    total_cost: f64,
) -> Element {
    let mut current_view: Signal<View> = use_context();
    let is_archived = status == "archived";
    let time_str = format_minutes(total_minutes);
    let activity_str = format_relative_time(&last_session_at);

    rsx! {
        div {
            class: "overview-row",
            onclick: move |_| {
                current_view.set(View::Project(id.clone()));
            },
            // Name
            div { style: "display: flex; align-items: center; gap: 8px;",
                span { style: "font-weight: 600; color: var(--text-primary);", "{name}" }
                if is_archived {
                    span {
                        style: "font-size: 11px; padding: 2px 6px; border-radius: 4px; background: var(--bg-tertiary); color: var(--text-muted);",
                        "Archived"
                    }
                }
            }
            // Last Activity
            div { style: "color: var(--text-secondary); font-size: 13px;",
                "{activity_str}"
            }
            // Progress
            div { style: "min-width: 120px;",
                ProgressBar { percent: progress_percent }
            }
            // Sessions
            div { style: "color: var(--text-secondary); text-align: center; font-family: monospace;",
                "{session_count}"
            }
            // Time
            div { style: "color: var(--text-secondary); font-family: monospace;",
                "{time_str}"
            }
            // Cost
            div {
                if total_cost > 0.0 {
                    CostBadge { cost: total_cost }
                } else {
                    span { style: "color: var(--text-muted);", "\u{2014}" }
                }
            }
        }
    }
}

#[component]
fn SortButton(
    label: String,
    field: SortField,
    current_field: SortField,
    current_dir: SortDir,
    on_click: EventHandler<()>,
) -> Element {
    let is_active = field == current_field;
    let class = if is_active {
        "sort-header active"
    } else {
        "sort-header"
    };

    let display_text = if is_active {
        match current_dir {
            SortDir::Asc => format!("{} \u{2191}", label),
            SortDir::Desc => format!("{} \u{2193}", label),
        }
    } else {
        label
    };

    rsx! {
        button {
            class: "{class}",
            onclick: move |_| on_click.call(()),
            "{display_text}"
        }
    }
}

fn toggle_sort(
    sort_field: &mut Signal<SortField>,
    sort_dir: &mut Signal<SortDir>,
    field: SortField,
) {
    if sort_field() == field {
        sort_dir.set(match sort_dir() {
            SortDir::Asc => SortDir::Desc,
            SortDir::Desc => SortDir::Asc,
        });
    } else {
        sort_field.set(field);
        sort_dir.set(SortDir::Desc);
    }
}

fn sort_rows(rows: &mut [OverviewRow], field: SortField, dir: SortDir) {
    rows.sort_by(|a, b| {
        let ordering = match field {
            SortField::Name => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
            SortField::LastActivity => {
                let a_val = a.last_session_at.as_deref().unwrap_or("");
                let b_val = b.last_session_at.as_deref().unwrap_or("");
                a_val.cmp(b_val)
            }
            SortField::Progress => a
                .progress_percent
                .partial_cmp(&b.progress_percent)
                .unwrap_or(std::cmp::Ordering::Equal),
            SortField::Sessions => a.session_count.cmp(&b.session_count),
            SortField::Time => a.total_minutes.cmp(&b.total_minutes),
            SortField::Cost => a
                .total_cost
                .partial_cmp(&b.total_cost)
                .unwrap_or(std::cmp::Ordering::Equal),
        };
        match dir {
            SortDir::Asc => ordering,
            SortDir::Desc => ordering.reverse(),
        }
    });
}

fn format_minutes(total: i64) -> String {
    let hours = total / 60;
    let mins = total % 60;
    if hours > 0 {
        format!("{}h {}m", hours, mins)
    } else {
        format!("{}m", mins)
    }
}

fn format_relative_time(raw: &str) -> String {
    if raw.is_empty() {
        return "Never".to_string();
    }

    let parsed = chrono::NaiveDateTime::parse_from_str(raw, "%Y-%m-%dT%H:%M:%SZ")
        .or_else(|_| chrono::NaiveDateTime::parse_from_str(raw, "%Y-%m-%dT%H:%M:%S%.fZ"))
        .or_else(|_| chrono::NaiveDateTime::parse_from_str(raw, "%Y-%m-%d %H:%M:%S"));

    match parsed {
        Ok(dt) => {
            let now = chrono::Utc::now().naive_utc();
            let diff = now.signed_duration_since(dt);
            let total_seconds = diff.num_seconds();

            if total_seconds < 0 {
                return dt.format("%b %d, %Y").to_string();
            }

            let minutes = total_seconds / 60;
            let hours = minutes / 60;
            let days = hours / 24;

            if minutes < 1 {
                "Just now".to_string()
            } else if minutes < 60 {
                format!("{} min ago", minutes)
            } else if hours < 24 {
                if hours == 1 {
                    "1 hour ago".to_string()
                } else {
                    format!("{} hours ago", hours)
                }
            } else if days < 30 {
                if days == 1 {
                    "1 day ago".to_string()
                } else {
                    format!("{} days ago", days)
                }
            } else {
                dt.format("%b %d, %Y").to_string()
            }
        }
        Err(_) => raw.to_string(),
    }
}
