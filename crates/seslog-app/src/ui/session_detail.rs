use dioxus::prelude::*;
use crate::commands;
use crate::state::View;
use super::components::{Breadcrumb, CostBadge, Crumb, EmptyState, GlassPanel, SessionDetailSkeleton, format_minutes, format_date};

#[component]
pub fn SessionDetail(project_id: String, session_id: String) -> Element {
    let mut current_view: Signal<View> = use_context();
    let refresh: Signal<u64> = use_context();

    let pid = project_id.clone();
    let sid = session_id.clone();
    let resource = use_resource(move || {
        let pid = pid.clone();
        let sid = sid.clone();
        async move {
            refresh(); // track refresh dependency
            let pool = crate::get_db_pool();
            commands::get_session_by_id(pool, &pid, &sid).ok().flatten()
        }
    });

    let pid_for_back = project_id.clone();

    let session = match resource() {
        None => return rsx! { SessionDetailSkeleton {} },
        Some(None) => {
            return rsx! {
                div { class: "session-detail",
                    EmptyState {
                        icon: super::icons::SVG_SEARCH.to_string(),
                        title: "Session Not Found".to_string(),
                        message: format!("Could not find session '{}'.", session_id),
                    }
                    button {
                        class: "btn btn-secondary",
                        style: "margin: 24px auto; display: block;",
                        onclick: move |_| {
                            current_view.set(View::Project(pid_for_back.clone()));
                        },
                        {super::icons::SVG_ARROW_LEFT} " Back to Project"
                    }
                }
            };
        }
        Some(Some(s)) => s,
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

    let pid_for_breadcrumb = project_id.clone();
    let breadcrumbs = vec![
        Crumb { label: "Dashboard".into(), view: Some(View::Dashboard) },
        Crumb { label: project_id.clone(), view: Some(View::Project(pid_for_breadcrumb)) },
        Crumb { label: title.clone(), view: None },
    ];

    rsx! {
        div { class: "session-detail",
            Breadcrumb { crumbs: breadcrumbs }

            // Page header
            div { class: "page-header",
                h1 { class: "page-title", "{title}" }
                p { class: "page-subtitle", "{date}" }
            }

            // Meta grid
            div { class: "session-meta-grid",
                MetaCard { label: "Date".to_string(), value: date.clone() }
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
                    div { class: "cost-layout",
                        if let Some(tokens) = token_count {
                            div {
                                div { class: "cost-token-label", "Tokens" }
                                div { class: "cost-token-value", "{format_tokens(tokens)}" }
                            }
                        }
                        if let Some(c) = cost {
                            div {
                                div { class: "cost-token-label", "Estimated Cost" }
                                div { style: "margin-top: 4px;",
                                    CostBadge { cost: c }
                                }
                            }
                        }
                        div {
                            div { class: "cost-token-label", "Model" }
                            div { class: "cost-model-value", "{model}" }
                        }
                    }
                }
            }

            // Summary section
            if !summary_text.is_empty() {
                div { class: "section-gap",
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
                div { class: "section-gap-sm",
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
                div { class: "section-gap-sm",
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
            div { class: "meta-label", "{label}" }
            div { class: "meta-value", "{value}" }
        }
    }
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
