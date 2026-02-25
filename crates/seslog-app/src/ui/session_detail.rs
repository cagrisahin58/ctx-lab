use dioxus::prelude::*;
use crate::commands;
use crate::state::View;
use super::components::{CostBadge, EmptyState, GlassPanel};

#[component]
pub fn SessionDetail(project_id: String, session_id: String) -> Element {
    let mut current_view: Signal<View> = use_context();
    let _refresh: Signal<u64> = use_context();

    let pool = crate::get_db_pool();
    let sessions = commands::get_sessions_inner(pool, project_id.clone(), 100).unwrap_or_default();
    let session = sessions.iter().find(|s| s.id == session_id);

    let pid_for_back = project_id.clone();

    let session = match session {
        Some(s) => s,
        None => {
            return rsx! {
                div { class: "session-detail",
                    EmptyState {
                        icon: "\u{1F50D}".to_string(),
                        title: "Session Not Found".to_string(),
                        message: format!("Could not find session '{}'.", session_id),
                    }
                    button {
                        class: "btn btn-secondary",
                        style: "margin: 24px auto; display: block;",
                        onclick: move |_| {
                            current_view.set(View::Project(pid_for_back.clone()));
                        },
                        "\u{2190} Back to Project"
                    }
                }
            };
        }
    };

    let title = session
        .summary
        .lines()
        .next()
        .unwrap_or("Session")
        .to_string();
    let date = format_date(&session.started_at);
    let machine = session.machine.clone();
    let duration = session
        .duration_minutes
        .map(format_minutes)
        .unwrap_or_else(|| "N/A".to_string());
    let files = session.files_changed;
    let model = session.model.clone().unwrap_or_else(|| "Unknown".to_string());
    let recovered = session.recovered;
    let summary_text = session.summary.clone();
    let next_steps_text = session.next_steps.clone();
    let highlights = session.transcript_highlights.clone();
    let token_count = session.token_count;
    let cost = session.estimated_cost_usd;

    let pid_for_nav = project_id.clone();

    rsx! {
        div { class: "session-detail",
            // Back button
            button {
                class: "btn btn-secondary",
                style: "margin-bottom: 16px;",
                onclick: move |_| {
                    current_view.set(View::Project(pid_for_nav.clone()));
                },
                "\u{2190} Back to Project"
            }

            // Page header
            div { class: "page-header",
                h1 { class: "page-title", "{title}" }
                p { class: "page-subtitle", "{date}" }
            }

            // Meta grid
            div { class: "session-meta-grid",
                MetaCard { label: "Machine".to_string(), value: machine }
                MetaCard { label: "Duration".to_string(), value: duration }
                MetaCard { label: "Files Changed".to_string(), value: format!("{}", files) }
                MetaCard { label: "Model".to_string(), value: model.clone() }
                MetaCard {
                    label: "Recovered".to_string(),
                    value: if recovered { "Yes".to_string() } else { "No".to_string() },
                }
            }

            // Cost section
            if token_count.is_some() || cost.is_some() {
                GlassPanel {
                    h3 { class: "section-header", "Cost & Tokens" }
                    div { style: "display: flex; gap: 24px; align-items: center; margin-top: 12px;",
                        if let Some(tokens) = token_count {
                            div {
                                div { style: "font-size: 12px; color: var(--text-muted);", "Tokens" }
                                div { style: "font-size: 18px; font-weight: 600; color: var(--text-primary); font-family: monospace;",
                                    "{format_tokens(tokens)}"
                                }
                            }
                        }
                        if let Some(c) = cost {
                            div {
                                div { style: "font-size: 12px; color: var(--text-muted);", "Estimated Cost" }
                                div { style: "margin-top: 4px;",
                                    CostBadge { cost: c }
                                }
                            }
                        }
                        div {
                            div { style: "font-size: 12px; color: var(--text-muted);", "Model" }
                            div { style: "font-size: 14px; color: var(--text-primary);", "{model}" }
                        }
                    }
                }
            }

            // Summary section
            if !summary_text.is_empty() {
                div { style: "margin-top: 24px;",
                    GlassPanel {
                        h3 { class: "section-header", "Summary" }
                        p { style: "color: var(--text-primary); line-height: 1.6; margin-top: 12px; white-space: pre-wrap;",
                            "{summary_text}"
                        }
                    }
                }
            }

            // Next Steps section
            if !next_steps_text.is_empty() {
                div { style: "margin-top: 16px;",
                    GlassPanel {
                        h3 { class: "section-header", "Next Steps" }
                        p { style: "color: var(--text-primary); line-height: 1.6; margin-top: 12px; white-space: pre-wrap;",
                            "{next_steps_text}"
                        }
                    }
                }
            }

            // Highlights section
            if !highlights.is_empty() {
                div { style: "margin-top: 16px;",
                    GlassPanel {
                        h3 { class: "section-header", "Transcript Highlights" }
                        div { style: "margin-top: 12px; display: flex; flex-direction: column; gap: 8px;",
                            for hl in highlights.iter() {
                                div { class: "highlight-item", "{hl}" }
                            }
                        }
                    }
                }
            }
        }
    }
}

#[component]
fn MetaCard(label: String, value: String) -> Element {
    rsx! {
        div { class: "glass-panel", style: "padding: 16px; text-align: center;",
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
        return dt.format("%b %d, %Y at %H:%M").to_string();
    }
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(raw, "%Y-%m-%dT%H:%M:%S%.fZ") {
        return dt.format("%b %d, %Y at %H:%M").to_string();
    }
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(raw, "%Y-%m-%d %H:%M:%S") {
        return dt.format("%b %d, %Y at %H:%M").to_string();
    }
    raw.to_string()
}

fn format_tokens(count: i64) -> String {
    if count >= 1_000_000 {
        format!("{:.1}M", count as f64 / 1_000_000.0)
    } else if count >= 1_000 {
        format!("{:.1}K", count as f64 / 1_000.0)
    } else {
        format!("{}", count)
    }
}
