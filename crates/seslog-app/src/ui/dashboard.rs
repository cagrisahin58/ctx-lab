use dioxus::prelude::*;
use crate::commands;
use crate::state::View;
use super::components::{DashboardSkeleton, EmptyState, ProgressBar, StatusDot, format_minutes};

#[allow(non_snake_case)]
pub fn Dashboard() -> Element {
    let mut current_view: Signal<View> = use_context();
    let refresh: Signal<u64> = use_context();

    let resource = use_resource(move || async move {
        refresh(); // track refresh dependency
        let pool = crate::get_db_pool();
        commands::get_projects_inner(pool).unwrap_or_default()
    });

    let projects = match resource() {
        None => return rsx! { DashboardSkeleton {} },
        Some(p) => p,
    };

    // Split into active and archived
    let active: Vec<_> = projects
        .iter()
        .filter(|p| p.status == "active")
        .collect();
    let archived: Vec<_> = projects
        .iter()
        .filter(|p| p.status == "archived")
        .collect();

    if active.is_empty() && archived.is_empty() {
        return rsx! {
            div { class: "dashboard",
                EmptyState {
                    icon: super::icons::SVG_FOLDER.to_string(),
                    title: "No Projects Yet".to_string(),
                    message: "Start a Claude Code session in any project to see it here.".to_string(),
                }
            }
        };
    }

    // Precompute subtitle outside rsx
    let subtitle = {
        let count = active.len();
        if count == 1 {
            "1 active project".to_string()
        } else {
            format!("{} active projects", count)
        }
    };

    // Hero card data
    let hero = active.first().map(|p| {
        (
            p.id.clone(),
            p.name.clone(),
            p.last_summary.clone().unwrap_or_default(),
            p.progress_percent,
        )
    });

    rsx! {
        div { class: "dashboard",
            div { class: "page-header",
                h1 { class: "page-title", "Dashboard" }
                p { class: "page-subtitle", "{subtitle}" }
            }

            // Hero Card
            if let Some((hero_id, hero_name, hero_summary, hero_progress)) = hero {
                {
                    let hero_id_for_btn = hero_id.clone();
                    rsx! {
                        div { class: "hero-card glass-panel",
                            onclick: move |_| {
                                current_view.set(View::Project(hero_id.clone()));
                            },
                            div { class: "hero-card-header",
                                span { class: "hero-label", "Quick Resume" }
                            }
                            h2 { class: "hero-project-name", "{hero_name}" }
                            if !hero_summary.is_empty() {
                                p { class: "hero-summary", "{hero_summary}" }
                            }
                            ProgressBar { percent: hero_progress }
                            div { style: "margin-top: 16px;",
                                button { class: "btn btn-primary",
                                    onclick: move |evt| {
                                        evt.stop_propagation();
                                        current_view.set(View::Project(hero_id_for_btn.clone()));
                                    },
                                    "View Details"
                                }
                            }
                        }
                    }
                }
            }

            // Active Projects Grid (skip hero)
            if active.len() > 1 {
                div { class: "section-header",
                    h2 { "Active Projects" }
                }
                div { class: "projects-grid",
                    for project in active.iter().skip(1) {
                        ProjectCard {
                            id: project.id.clone(),
                            name: project.name.clone(),
                            summary: project.last_summary.clone().unwrap_or_default(),
                            progress: project.progress_percent,
                            sessions: project.session_count,
                            minutes: project.total_minutes,
                            active: true,
                        }
                    }
                }
            }

            // Archived Projects
            if !archived.is_empty() {
                div { class: "section-header",
                    h2 { "Archived" }
                }
                div { class: "projects-grid",
                    for project in archived.iter() {
                        ProjectCard {
                            id: project.id.clone(),
                            name: project.name.clone(),
                            summary: project.last_summary.clone().unwrap_or_default(),
                            progress: project.progress_percent,
                            sessions: project.session_count,
                            minutes: project.total_minutes,
                            active: false,
                        }
                    }
                }
            }
        }
    }
}

#[component]
fn ProjectCard(
    id: String,
    name: String,
    summary: String,
    progress: f64,
    sessions: i64,
    minutes: i64,
    active: bool,
) -> Element {
    let mut current_view: Signal<View> = use_context();
    let time_str = format_minutes(minutes);
    let meta_text = format!("{} sessions", sessions);

    rsx! {
        div {
            class: "project-card glass-panel",
            onclick: move |_| {
                current_view.set(View::Project(id.clone()));
            },
            div { class: "project-card-header",
                span { class: "project-name", "{name}" }
                StatusDot { active: active }
            }
            if !summary.is_empty() {
                p { class: "project-summary", "{summary}" }
            }
            ProgressBar { percent: progress }
            div { class: "project-meta",
                span { "{meta_text}" }
                span { "\u{00B7}" }
                span { "{time_str}" }
            }
        }
    }
}

