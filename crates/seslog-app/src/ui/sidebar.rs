use dioxus::prelude::*;
use crate::state::{View, Theme};
use crate::commands;

#[allow(non_snake_case)]
pub fn Sidebar() -> Element {
    let mut current_view: Signal<View> = use_context();
    let mut theme: Signal<Theme> = use_context();

    let mut search_query = use_signal(String::new);

    // Load projects from DB (async, tracks refresh signal)
    let refresh: Signal<u64> = use_context();
    let resource = use_resource(move || async move {
        refresh(); // track refresh dependency
        let pool = crate::get_db_pool();
        commands::get_projects_inner(pool).unwrap_or_default()
    });

    let projects = resource().unwrap_or_default();

    // Filter by search query
    let query = search_query().to_lowercase();
    let filtered_projects: Vec<_> = if query.is_empty() {
        projects
    } else {
        projects.into_iter().filter(|p| p.name.to_lowercase().contains(&query)).collect()
    };

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
                    span { class: "nav-icon", {super::icons::SVG_DASHBOARD} }
                    "Dashboard"
                    span { class: "shortcut-hint", "1" }
                }
                button {
                    class: if is_overview { "nav-item active" } else { "nav-item" },
                    onclick: move |_| current_view.set(View::Overview),
                    span { class: "nav-icon", {super::icons::SVG_TABLE} }
                    "Overview"
                    span { class: "shortcut-hint", "2" }
                }

                div { class: "sidebar-divider" }
                div { class: "sidebar-section-label", "Projects" }

                // Search input
                input {
                    class: "sidebar-search",
                    r#type: "text",
                    placeholder: "Search projects...",
                    value: "{search_query}",
                    oninput: move |evt| {
                        search_query.set(evt.value().to_string());
                    },
                    onkeydown: move |evt: KeyboardEvent| {
                        evt.stop_propagation();
                    },
                }

                // Project list (scrollable, filtered)
                div { class: "sidebar-projects",
                    if filtered_projects.is_empty() && !query.is_empty() {
                        div { class: "sidebar-empty", "No matches" }
                    }
                    for p in filtered_projects.iter() {
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
                                    span { class: "sidebar-progress", "{progress as i32}%" }
                                }
                            }
                        }
                    }
                }

                div { class: "sidebar-divider" }

                button {
                    class: if is_settings { "nav-item active" } else { "nav-item" },
                    onclick: move |_| current_view.set(View::Settings),
                    span { class: "nav-icon", {super::icons::SVG_SETTINGS} }
                    "Settings"
                    span { class: "shortcut-hint", "3" }
                }
            }

            // Footer
            div { class: "sidebar-footer",
                button {
                    class: "nav-item",
                    onclick: move |_| {
                        if is_dark {
                            theme.set(Theme::Light);
                        } else {
                            theme.set(Theme::Dark);
                        }
                    },
                    span { class: "nav-icon", if is_dark { {super::icons::SVG_SUN} } else { {super::icons::SVG_MOON} } }
                    if is_dark { "Light Mode" } else { "Dark Mode" }
                }
            }
        }
    }
}
