use dioxus::prelude::*;
use crate::commands;
use crate::state::View;
use super::components::{CostBadge, EmptyState, GlassPanel, ProgressBar, StatusDot};

#[component]
pub fn ProjectDetail(project_id: String) -> Element {
    let mut current_view: Signal<View> = use_context();
    let _refresh: Signal<u64> = use_context();

    let pool = crate::get_db_pool();
    let detail = commands::get_project_detail_inner(pool, project_id.clone());

    let detail = match detail {
        Ok(d) => d,
        Err(_) => {
            return rsx! {
                div { class: "project-detail",
                    EmptyState {
                        icon: "\u{1F50D}".to_string(),
                        title: "Project Not Found".to_string(),
                        message: format!("Could not load project '{}'.", project_id),
                    }
                    button {
                        class: "btn btn-secondary",
                        style: "margin: 24px auto; display: block;",
                        onclick: move |_| current_view.set(View::Dashboard),
                        "\u{2190} Back to Dashboard"
                    }
                }
            };
        }
    };

    let summary = &detail.summary;
    let roadmap = &detail.roadmap;
    let sessions = &detail.recent_sessions;

    let project_name = summary.name.clone();
    let is_active = summary.status == "active";
    let progress = summary.progress_percent;
    let session_count = summary.session_count;
    let total_minutes = summary.total_minutes;
    let last_machine = summary.last_machine.clone().unwrap_or_else(|| "N/A".to_string());
    let last_active = summary.last_session_at.clone().unwrap_or_else(|| "Never".to_string());

    // Calculate total cost from sessions
    let total_cost: f64 = sessions
        .iter()
        .filter_map(|s| s.estimated_cost_usd)
        .sum();

    // Group roadmap items by phase into flat structs for rendering
    let mut phase_items: Vec<RoadmapItemRow> = Vec::new();
    let mut last_phase: Option<String> = None;
    for item in &roadmap.items {
        let phase_name = item.phase.clone().unwrap_or_else(|| "General".to_string());
        let show_phase = last_phase.as_ref() != Some(&phase_name);
        if show_phase {
            last_phase = Some(phase_name.clone());
        }
        phase_items.push(RoadmapItemRow {
            phase_heading: if show_phase { Some(phase_name) } else { None },
            text: item.item_text.clone(),
            status: item.status.clone(),
            item_id: item.item_id.clone(),
            has_deps: !item.depends_on.is_empty(),
        });
    }

    // Count done items for progress display
    let done_count = roadmap.items.iter().filter(|i| i.status == "done").count();
    let total_items = roadmap.items.len();
    let progress_text = format!("{} of {} tasks", done_count, total_items);
    let progress_pct_text = format!("{}%", progress as i32);

    // Build session rows for timeline
    let session_rows: Vec<TimelineRow> = sessions
        .iter()
        .take(5)
        .map(|s| TimelineRow {
            session_id: s.id.clone(),
            session_project_id: s.project_id.clone(),
            date: format_date(&s.started_at),
            summary_text: truncate_summary(&s.summary, 120),
            machine: s.machine.clone(),
            duration: s.duration_minutes.map(format_minutes).unwrap_or_else(|| "N/A".to_string()),
            files: s.files_changed,
            cost: s.estimated_cost_usd.filter(|c| *c > 0.0),
        })
        .collect();

    let has_roadmap = !roadmap.items.is_empty();
    let has_warnings = !roadmap.warnings.is_empty();
    let warnings: Vec<String> = roadmap.warnings.clone();

    // Actions state
    let mut action_msg = use_signal(String::new);
    let pid_for_editor = project_id.clone();

    let last_active_formatted = format_date(&last_active);

    rsx! {
        div { class: "project-detail",
            // Back button
            button {
                class: "btn btn-secondary",
                style: "margin-bottom: 16px;",
                onclick: move |_| current_view.set(View::Dashboard),
                "\u{2190} Back to Dashboard"
            }

            // Page header
            div { class: "page-header",
                div { style: "display: flex; align-items: center; gap: 12px;",
                    h1 { class: "page-title", "{project_name}" }
                    StatusDot { active: is_active }
                }
            }

            // Two-column layout
            div { style: "display: grid; grid-template-columns: 2fr 1fr; gap: 24px; align-items: start;",
                // Left column
                div {
                    // Roadmap section
                    if has_roadmap {
                        div { class: "roadmap glass-panel",
                            h3 { class: "section-header", "Roadmap" }
                            for ri in phase_items.iter() {
                                RoadmapRow {
                                    phase_heading: ri.phase_heading.clone(),
                                    text: ri.text.clone(),
                                    status: ri.status.clone(),
                                    item_id: ri.item_id.clone(),
                                    has_deps: ri.has_deps,
                                }
                            }
                            if has_warnings {
                                for warning in warnings.iter() {
                                    div {
                                        style: "color: var(--warning-color, #f59e0b); font-size: 13px; margin-top: 8px; padding: 8px; background: rgba(245, 158, 11, 0.1); border-radius: 6px;",
                                        "\u{26A0} {warning}"
                                    }
                                }
                            }
                        }
                    }

                    // Recent Sessions timeline
                    div { class: "glass-panel", style: "margin-top: 24px; padding: 24px;",
                        h3 { class: "section-header", "Recent Sessions" }
                        if session_rows.is_empty() {
                            p { style: "color: var(--text-muted);", "No sessions recorded yet." }
                        } else {
                            div { class: "timeline",
                                for sr in session_rows.iter() {
                                    TimelineItem {
                                        session_id: sr.session_id.clone(),
                                        session_project_id: sr.session_project_id.clone(),
                                        date: sr.date.clone(),
                                        summary_text: sr.summary_text.clone(),
                                        machine: sr.machine.clone(),
                                        duration: sr.duration.clone(),
                                        files: sr.files,
                                        cost: sr.cost,
                                    }
                                }
                            }
                        }
                    }
                }

                // Right column
                div {
                    // Progress panel
                    GlassPanel {
                        div { style: "text-align: center;",
                            div {
                                style: "font-size: 48px; font-weight: 700; color: var(--accent-color); line-height: 1;",
                                "{progress_pct_text}"
                            }
                            if total_items > 0 {
                                p {
                                    style: "color: var(--text-secondary); margin-top: 8px; font-size: 14px;",
                                    "{progress_text}"
                                }
                            }
                            div { style: "margin-top: 12px;",
                                ProgressBar { percent: progress }
                            }
                        }
                    }

                    // Statistics panel
                    div { class: "glass-panel", style: "margin-top: 16px; padding: 24px;",
                        h3 { class: "section-header", "Statistics" }
                        div { style: "display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 12px;",
                            StatItem { label: "Total Sessions".to_string(), value: format!("{}", session_count) }
                            StatItem { label: "Time Invested".to_string(), value: format_minutes(total_minutes) }
                            StatItem { label: "Last Machine".to_string(), value: last_machine }
                            StatItem { label: "Last Active".to_string(), value: last_active_formatted }
                        }
                        if total_cost > 0.0 {
                            div { style: "margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;",
                                span { style: "font-size: 13px; color: var(--text-secondary);", "Total Cost" }
                                CostBadge { cost: total_cost }
                            }
                        }
                    }

                    // Actions panel
                    div { class: "glass-panel", style: "margin-top: 16px; padding: 24px;",
                        h3 { class: "section-header", "Actions" }
                        div { style: "display: flex; flex-direction: column; gap: 8px; margin-top: 12px;",
                            button {
                                class: "btn btn-primary",
                                style: "width: 100%;",
                                onclick: move |_| {
                                    match commands::open_in_editor_inner(&pid_for_editor) {
                                        Ok(msg) => action_msg.set(msg),
                                        Err(e) => action_msg.set(format!("Error: {}", e)),
                                    }
                                },
                                "Open in VS Code"
                            }
                            button {
                                class: "btn btn-secondary",
                                style: "width: 100%;",
                                onclick: move |_| {
                                    let pool = crate::get_db_pool();
                                    match commands::rebuild_cache_inner(pool) {
                                        Ok(report) => action_msg.set(
                                            format!("Rebuilt: +{} -{} ~{}", report.added, report.removed, report.updated)
                                        ),
                                        Err(e) => action_msg.set(format!("Error: {}", e)),
                                    }
                                },
                                "Rebuild Cache"
                            }
                        }
                        if !action_msg().is_empty() {
                            p {
                                style: "font-size: 12px; color: var(--text-muted); margin-top: 8px;",
                                "{action_msg}"
                            }
                        }
                    }
                }
            }
        }
    }
}

// Helper structs for pre-computed row data

struct RoadmapItemRow {
    phase_heading: Option<String>,
    text: String,
    status: String,
    item_id: Option<String>,
    has_deps: bool,
}

struct TimelineRow {
    session_id: String,
    session_project_id: String,
    date: String,
    summary_text: String,
    machine: String,
    duration: String,
    files: i64,
    cost: Option<f64>,
}

// Sub-components

#[component]
fn RoadmapRow(
    phase_heading: Option<String>,
    text: String,
    status: String,
    item_id: Option<String>,
    has_deps: bool,
) -> Element {
    let is_done = status == "done";
    let indent_class = if has_deps { "roadmap-item dependency-indent" } else { "roadmap-item" };
    let checkbox_class = if is_done { "roadmap-checkbox checked" } else { "roadmap-checkbox" };
    let id_badge = item_id.map(|id| format!("[{}]", id)).unwrap_or_default();

    rsx! {
        if let Some(heading) = phase_heading {
            h4 { style: "color: var(--text-secondary); margin-bottom: 8px; margin-top: 16px; font-size: 14px;",
                "{heading}"
            }
        }
        div { class: "{indent_class}",
            span { class: "{checkbox_class}" }
            span { class: "roadmap-item-text", "{text}" }
            if !id_badge.is_empty() {
                span {
                    style: "font-size: 11px; color: var(--text-muted); background: var(--bg-tertiary); padding: 2px 6px; border-radius: 4px; margin-left: 8px; font-family: monospace;",
                    "{id_badge}"
                }
            }
        }
    }
}

#[component]
fn TimelineItem(
    session_id: String,
    session_project_id: String,
    date: String,
    summary_text: String,
    machine: String,
    duration: String,
    files: i64,
    cost: Option<f64>,
) -> Element {
    let mut current_view: Signal<View> = use_context();
    let files_text = format!("{} files", files);

    rsx! {
        div {
            class: "timeline-item",
            onclick: move |_| {
                current_view.set(View::Session {
                    project_id: session_project_id.clone(),
                    session_id: session_id.clone(),
                });
            },
            div { class: "timeline-date", "{date}" }
            div { class: "timeline-content",
                p { class: "timeline-summary", "{summary_text}" }
                div { class: "timeline-meta",
                    style: "display: flex; gap: 12px; font-size: 12px; color: var(--text-muted); margin-top: 4px;",
                    span { "{machine}" }
                    span { "{duration}" }
                    span { "{files_text}" }
                    if let Some(c) = cost {
                        CostBadge { cost: c }
                    }
                }
            }
        }
    }
}

#[component]
fn StatItem(label: String, value: String) -> Element {
    rsx! {
        div {
            div { style: "font-size: 12px; color: var(--text-muted); margin-bottom: 4px;", "{label}" }
            div { style: "font-size: 16px; font-weight: 600; color: var(--text-primary);", "{value}" }
        }
    }
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

fn format_date(raw: &str) -> String {
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(raw, "%Y-%m-%dT%H:%M:%SZ") {
        return dt.format("%b %d, %Y %H:%M").to_string();
    }
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(raw, "%Y-%m-%dT%H:%M:%S%.fZ") {
        return dt.format("%b %d, %Y %H:%M").to_string();
    }
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(raw, "%Y-%m-%d %H:%M:%S") {
        return dt.format("%b %d, %Y %H:%M").to_string();
    }
    raw.to_string()
}

fn truncate_summary(text: &str, max_len: usize) -> String {
    let first_line = text.lines().next().unwrap_or(text);
    if first_line.len() > max_len {
        format!("{}...", &first_line[..max_len])
    } else {
        first_line.to_string()
    }
}
