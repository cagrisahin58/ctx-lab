use dioxus::prelude::*;
use crate::state::{View, Theme};
use crate::commands;

#[allow(non_snake_case)]
pub fn Sidebar() -> Element {
    let mut current_view: Signal<View> = use_context();
    let mut theme: Signal<Theme> = use_context();
    let _refresh: Signal<u64> = use_context(); // trigger re-render on data change

    // Load projects from DB
    let pool = crate::get_db_pool();
    let projects = commands::get_projects_inner(pool).unwrap_or_default();

    let is_dashboard = matches!(*current_view.read(), View::Dashboard);
    let is_overview = matches!(*current_view.read(), View::Overview);
    let is_settings = matches!(*current_view.read(), View::Settings);
    let is_dark = *theme.read() == Theme::Dark;

    rsx! {
        div { class: "sidebar",
            // Logo
            div { class: "sidebar-logo",
                div { class: "sidebar-logo-icon", "SL" }
                div { class: "sidebar-logo-text", "Seslog" }
            }

            // Navigation
            div { class: "sidebar-nav",
                button {
                    class: if is_dashboard { "nav-item active" } else { "nav-item" },
                    onclick: move |_| current_view.set(View::Dashboard),
                    span { class: "nav-icon", "\u{1F4CA}" }
                    "Dashboard"
                }
                button {
                    class: if is_overview { "nav-item active" } else { "nav-item" },
                    onclick: move |_| current_view.set(View::Overview),
                    span { class: "nav-icon", "\u{1F4CB}" }
                    "Overview"
                }

                div { style: "height: 1px; background: var(--border-color); margin: 16px 0;" }
                div { style: "font-size: 12px; color: var(--text-muted); padding: 8px 16px; text-transform: uppercase; letter-spacing: 1px;", "Projects" }

                // Project list
                for p in projects.iter() {
                    {
                        let pid = p.id.clone();
                        let name = p.name.clone();
                        let progress = p.progress_percent;
                        let is_active = matches!(*current_view.read(), View::Project(ref id) if id == &pid);
                        rsx! {
                            button {
                                class: if is_active { "nav-item active" } else { "nav-item" },
                                onclick: move |_| {
                                    let pid = pid.clone();
                                    current_view.set(View::Project(pid));
                                },
                                style: "justify-content: space-between;",
                                span { "{name}" }
                                span { style: "font-size: 11px; color: var(--text-muted); font-family: monospace;", "{progress as i32}%" }
                            }
                        }
                    }
                }

                div { style: "height: 1px; background: var(--border-color); margin: 16px 0;" }

                button {
                    class: if is_settings { "nav-item active" } else { "nav-item" },
                    onclick: move |_| current_view.set(View::Settings),
                    span { class: "nav-icon", "\u{2699}\u{FE0F}" }
                    "Settings"
                }
            }

            // Footer
            div { style: "margin-top: auto; padding-top: 24px; border-top: 1px solid var(--border-color);",
                button {
                    class: "nav-item",
                    onclick: move |_| {
                        if is_dark {
                            theme.set(Theme::Light);
                        } else {
                            theme.set(Theme::Dark);
                        }
                    },
                    span { class: "nav-icon", if is_dark { "\u{2600}\u{FE0F}" } else { "\u{1F319}" } }
                    if is_dark { "Light Mode" } else { "Dark Mode" }
                }
            }
        }
    }
}
