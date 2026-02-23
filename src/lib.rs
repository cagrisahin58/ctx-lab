// ctx-lab - Main entry point
// A desktop app that tracks Claude Code sessions

use dioxus::prelude::*;

mod state;

use state::{get_demo_projects, get_demo_sessions, Project, ProjectStatus};

pub fn main() {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive(tracing::Level::INFO.into()),
        )
        .init();

    tracing::info!("Starting ctx-lab desktop app");

    // Build and run the Dioxus desktop app
    dioxus::launch(App);
}

#[derive(Debug, Clone, PartialEq)]
enum View {
    Dashboard,
    Project(String),
    Settings,
}

fn App() -> Element {
    let mut current_view = use_signal(|| View::Dashboard);
    let selected_project = use_signal(|| Option::<String>::None);

    // Load CSS
    let css = include_str!("../assets/styles.css");

    let current = current_view.read().clone();

    rsx! {
        div {
            class: "app-container",
            style { "{css}" }

            // Sidebar
            div {
                class: "sidebar",
                div { class: "sidebar-logo", div { class: "sidebar-logo-icon", "CL" } div { class: "sidebar-logo-text", "ctx-lab" } }
                div {
                    class: "sidebar-nav",
                    button { class: if matches!(current, View::Dashboard) { "nav-item active" } else { "nav-item" }, onclick: move |_| current_view.set(View::Dashboard), span { class: "nav-icon", "📊" } "Dashboard" }
                    div { style: "height: 1px; background: var(--border-color); margin: 16px 0;" }
                    div { style: "font-size: 12px; color: var(--text-muted); padding: 8px 16px; text-transform: uppercase; letter-spacing: 1px;", "Projects" }
                    button { class: if matches!(current, View::Settings) { "nav-item active" } else { "nav-item" }, onclick: move |_| current_view.set(View::Settings), span { class: "nav-icon", "⚙️" } "Settings" }
                }
                div { style: "margin-top: auto; padding-top: 24px; border-top: 1px solid var(--border-color);", div { style: "display: flex; align-items: center; gap: 8px; padding: 12px; font-size: 13px; color: var(--text-muted);", span { "🔄" } "Synced 5m ago" } }
            }

            // Main content
            div {
                class: "main-content",
                match current {
                    View::Dashboard => render_dashboard(),
                    View::Project(ref id) => render_project_detail(id.to_string()),
                    View::Settings => render_settings(),
                }
            }
        }
    }
}

fn render_dashboard() -> Element {
    let projects = get_demo_projects();
    let active: Vec<_> = projects.iter().filter(|p| p.status == ProjectStatus::Active).collect();
    let archived: Vec<_> = projects.iter().filter(|p| p.status == ProjectStatus::Archived).collect();
    let recent = active.first();
    let count = active.len();

    let recent_name = recent.as_ref().map(|p| p.name.clone());
    let recent_summary = recent.and_then(|p| p.last_summary.clone());

    rsx! {
        div { class: "dashboard",
            div { class: "page-header", h1 { class: "page-title", "Dashboard" } p { class: "page-subtitle", "Welcome back!" } }

            if let (Some(name), Some(summary)) = (recent_name.as_ref(), recent_summary.as_ref()) {
                div { class: "hero-card glass-panel",
                    div { class: "hero-card-header", div { class: "hero-label", "Quick Resume" } div { class: "project-status", span { class: "status-dot" } "Active" } }
                    h2 { class: "hero-project-name", "{name}" }
                    p { class: "hero-summary", "{summary}" }
                    div { class: "hero-actions", button { class: "btn btn-primary", "Continue Working" span { "→" } } button { class: "btn btn-secondary", "View Details" } }
                }
            }

            div { style: "margin-top: 32px;",
                div { style: "display: flex; justify-content: space-between; margin-bottom: 20px;", h2 { style: "font-size: 20px; font-weight: 600;", "Active Projects" } span { style: "font-size: 14px; color: var(--text-muted);", "{count} projects" } }
                div { class: "projects-grid",
                    for p in active.iter() {
                        div { class: "project-card glass-panel",
                            div { class: "project-card-header",
                                h3 { class: "project-name", "{p.name}" }
                                div { class: "project-status", span { class: "status-dot" } "Active" }
                            }
                            p { class: "project-summary", "{p.last_summary.clone().unwrap_or_default()}" }
                            div { class: "project-progress",
                                div { class: "progress-label", span { "Progress" } span { "{p.progress_percent as i32}%" } }
                                div { class: "progress-bar", div { class: "progress-fill", style: "width: {p.progress_percent}%" } }
                            }
                            div { class: "project-meta", span { "{p.session_count} sessions • {p.total_minutes / 60}h {p.total_minutes % 60}m" } span { "{p.last_machine.clone().unwrap_or_default()}" } }
                        }
                    }
                }
            }

            if !archived.is_empty() {
                div { style: "margin-top: 40px;",
                    div { style: "display: flex; justify-content: space-between; margin-bottom: 20px;", h2 { style: "font-size: 20px; font-weight: 600; color: var(--text-muted);", "Archived Projects" } }
                    div { class: "projects-grid",
                        for p in archived.iter() {
                            div { class: "project-card glass-panel",
                                div { class: "project-card-header",
                                    h3 { class: "project-name", "{p.name}" }
                                    div { class: "project-status", span { class: "status-dot archived" } "Archived" }
                                }
                                p { class: "project-summary", "{p.last_summary.clone().unwrap_or_default()}" }
                                div { class: "project-progress",
                                    div { class: "progress-label", span { "Progress" } span { "{p.progress_percent as i32}%" } }
                                    div { class: "progress-bar", div { class: "progress-fill", style: "width: {p.progress_percent}%" } }
                                }
                                div { class: "project-meta", span { "{p.session_count} sessions • {p.total_minutes / 60}h {p.total_minutes % 60}m" } span { "{p.last_machine.clone().unwrap_or_default()}" } }
                            }
                        }
                    }
                }
            }
        }
    }
}

fn render_card_item(p: &Project, active: bool) -> Element {
    let name = p.name.clone();
    let summary = p.last_summary.clone().unwrap_or_default();
    let progress = p.progress_percent;
    let sessions = p.session_count;
    let machine = p.last_machine.clone().unwrap_or_default();
    let hours = p.total_minutes / 60;
    let mins = p.total_minutes % 60;
    let duration = if hours > 0 { format!("{}h {}m", hours, mins) } else { format!("{}m", mins) };

    rsx! {
        div { class: "project-card glass-panel",
            div { class: "project-card-header",
                h3 { class: "project-name", "{name}" }
                div { class: "project-status", span { class: if active { "status-dot" } else { "status-dot archived" } } if active { "Active" } else { "Archived" } }
            }
            p { class: "project-summary", "{summary}" }
            div { class: "project-progress",
                div { class: "progress-label", span { "Progress" } span { "{progress as i32}%" } }
                div { class: "progress-bar", div { class: "progress-fill", style: "width: {progress}%" } }
            }
            div { class: "project-meta", span { "{sessions} sessions • {duration}" } span { "{machine}" } }
        }
    }
}

fn render_project_detail(project_id: String) -> Element {
    let projects = get_demo_projects();
    let sessions = get_demo_sessions();

    if let Some(p) = projects.iter().find(|p| p.id == project_id) {
        let name = p.name.clone();
        let progress = p.progress_percent;
        let hours = p.total_minutes / 60;
        let mins = p.total_minutes % 60;
        let time = format!("{}h {}m", hours, mins);
        let machine = p.last_machine.clone().unwrap_or_default();
        let last = p.last_session_at.clone().unwrap_or_default();

        rsx! {
            div { class: "project-detail",
                button { class: "btn btn-secondary", style: "margin-bottom: 24px;", "← Back to Dashboard" }
                div { class: "page-header",
                    div { style: "display: flex; justify-content: space-between; align-items: flex-start;",
                        div { h1 { class: "page-title", "{name}" } p { class: "page-subtitle", "Project Overview" } }
                        button { class: "btn btn-primary", "Open in VS Code" span { "↗" } }
                    }
                }
                div { style: "display: grid; grid-template-columns: 2fr 1fr; gap: 24px;",
                    div {
                        div { style: "margin-bottom: 24px;", h2 { style: "font-size: 20px; font-weight: 600; margin-bottom: 16px;", "Roadmap" } div { class: "roadmap glass-panel", style: "padding: 24px;",
                            div { class: "roadmap-phase", h3 { class: "roadmap-phase-title", "Phase A" } div { class: "roadmap-items",
                                div { class: "roadmap-item", div { class: "roadmap-checkbox checked", span { "✓" } } span { class: "roadmap-text done", "Setup Cargo workspace" } }
                                div { class: "roadmap-item", div { class: "roadmap-checkbox checked", span { "✓" } } span { class: "roadmap-text done", "Implement ctx-lab-core" } }
                                div { class: "roadmap-item", div { class: "roadmap-checkbox checked", span { "✓" } } span { class: "roadmap-text done", "Implement ctx-lab-hook" } }
                            } }
                            div { class: "roadmap-phase", style: "margin-top: 16px;", h3 { class: "roadmap-phase-title", "Phase B" } div { class: "roadmap-items",
                                div { class: "roadmap-item", div { class: "roadmap-checkbox checked", span { "✓" } } span { class: "roadmap-text done", "Setup Dioxus desktop" } }
                                div { class: "roadmap-item", div { class: "roadmap-checkbox", } span { class: "roadmap-text", "Implement SQLite layer" } }
                                div { class: "roadmap-item", div { class: "roadmap-checkbox", } span { class: "roadmap-text", "Build Glassmorphism UI" } }
                            } }
                            div { class: "roadmap-phase", style: "margin-top: 16px;", h3 { class: "roadmap-phase-title", "Phase C" } div { class: "roadmap-items",
                                div { class: "roadmap-item", div { class: "roadmap-checkbox", } span { class: "roadmap-text", "Multi-machine sync" } }
                            } }
                        } }
                        div { h2 { style: "font-size: 20px; font-weight: 600; margin-bottom: 16px;", "Recent Sessions" } div { class: "timeline",
                            for s in sessions.iter().take(5) { div { class: "timeline-item", div { class: "timeline-dot" } div { class: "timeline-content",
                                div { class: "timeline-date", "{s.started_at.split('T').next().unwrap_or(&s.started_at)}" }
                                div { class: "timeline-title", "{s.summary}" }
                                div { class: "timeline-meta", span { "{s.machine}" } span { "{s.duration_minutes.unwrap_or(0)} min" } span { "{s.files_changed} files" } }
                            } } }
                        } }
                    }
                    div {
                        div { class: "glass-panel", style: "padding: 24px; margin-bottom: 24px;", h3 { style: "font-size: 16px; font-weight: 600; margin-bottom: 16px;", "Progress" } div { style: "text-align: center; font-size: 48px; font-weight: 700; color: var(--accent-primary);", "{progress as i32}%" } div { style: "text-align: center; color: var(--text-secondary); margin-top: 8px;", "5 of 8 tasks completed" } }
                        div { class: "glass-panel", style: "padding: 24px; margin-bottom: 24px;", h3 { style: "font-size: 16px; font-weight: 600; margin-bottom: 16px;", "Statistics" }
                            div { style: "display: grid; gap: 16px;",
                                div { style: "display: flex; justify-content: space-between;", span { style: "color: var(--text-secondary);", "Total Sessions" } span { style: "font-weight: 600;", "{p.session_count}" } }
                                div { style: "display: flex; justify-content: space-between;", span { style: "color: var(--text-secondary);", "Time Invested" } span { style: "font-weight: 600;", "{time}" } }
                                div { style: "display: flex; justify-content: space-between;", span { style: "color: var(--text-secondary);", "Last Machine" } span { style: "font-weight: 600;", "{machine}" } }
                                div { style: "display: flex; justify-content: space-between;", span { style: "color: var(--text-secondary);", "Last Active" } span { style: "font-weight: 600;", "{last}" } }
                            } }
                        div { class: "glass-panel", style: "padding: 24px;", h3 { style: "font-size: 16px; font-weight: 600; margin-bottom: 16px;", "Actions" } div { style: "display: flex; flex-direction: column; gap: 12px;",
                            button { class: "btn btn-secondary", style: "width: 100%; justify-content: flex-start;", "📊 View Analytics" }
                            button { class: "btn btn-secondary", style: "width: 100%; justify-content: flex-start;", "📝 Edit Roadmap" }
                            button { class: "btn btn-secondary", style: "width: 100%; justify-content: flex-start;", "🗑️ Archive Project" }
                        } }
                    }
                }
            }
        }
    } else {
        rsx! { div { class: "empty-state", div { class: "empty-state-icon", "🔍" } h2 { class: "empty-state-title", "Project Not Found" } p { class: "empty-state-text", "The requested project could not be found." } button { class: "btn btn-primary", "Back to Dashboard" } } }
    }
}

fn render_settings() -> Element {
    rsx! {
        div { class: "settings",
            div { class: "page-header", h1 { class: "page-title", "Settings" } p { class: "page-subtitle", "Configure your ctx-lab preferences" } }

            div { class: "settings-section",
                h2 { class: "settings-section-title", "Privacy" }
                div { class: "glass-panel", style: "padding: 24px;",
                    div { class: "settings-item",
                        div { class: "settings-item-info", h4 { "Privacy Mode" } p { "What data to store about your sessions" } }
                        select { class: "form-select", style: "width: 200px;",
                            option { value: "full", "Full" }
                            option { value: "summary-only", "Summary Only" }
                            option { value: "metadata-only", "Metadata Only" }
                        }
                    }
                }
            }

            div { class: "settings-section",
                h2 { class: "settings-section-title", "Notifications" }
                div { class: "glass-panel", style: "padding: 24px;",
                    div { class: "settings-item",
                        div { class: "settings-item-info", h4 { "Enable Notifications" } p { "Show desktop notifications for session events" } }
                        div { class: "toggle active", div { class: "toggle-knob" } }
                    }
                }
            }

            div { class: "settings-section",
                h2 { class: "settings-section-title", "Hook Status" }
                div { class: "glass-panel", style: "padding: 24px;",
                    div { style: "display: flex; align-items: center; gap: 12px; margin-bottom: 16px;", span { style: "width: 10px; height: 10px; border-radius: 50%; background: var(--success);" } span { style: "font-weight: 600;", "Hook is installed and running" } }
                    div { style: "background: var(--bg-primary); padding: 16px; border-radius: 8px; font-family: monospace; font-size: 13px; color: var(--text-secondary); white-space: pre;", "Hook Version: 0.1.0\nLast Heartbeat: 5 minutes ago\nEvents Processed: 127" }
                    div { style: "margin-top: 16px; display: flex; gap: 12px;", button { class: "btn btn-secondary", "Run Doctor" } button { class: "btn btn-secondary", "Reinstall Hook" } }
                }
            }
        }
    }
}
