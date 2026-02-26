use dioxus::prelude::*;
use crate::state::{View, Theme, Toast};
use super::sidebar::Sidebar;
use super::components::ToastContainer;
use super::dashboard::Dashboard;
use super::project_detail::ProjectDetail;
use super::session_detail::SessionDetail;
use super::settings::SettingsPage;
use super::overview::OverviewPage;

#[allow(non_snake_case)]
pub fn App() -> Element {
    let _view = use_context_provider(|| Signal::new(View::Dashboard));
    let theme = use_context_provider(|| Signal::new(Theme::Dark));
    let _toasts = use_context_provider(|| Signal::new(Vec::<Toast>::new()));

    // Refresh signal for watcher reactivity
    let _refresh = use_context_provider(|| Signal::new(0u64));

    // Poll refresh counter
    let mut refresh_sig: Signal<u64> = use_context();
    use_future(move || async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            let current = crate::get_refresh_count();
            if refresh_sig() != current {
                refresh_sig.set(current);
            }
        }
    });

    let css = include_str!("../../assets/styles.css");
    let current_view = use_context::<Signal<View>>();
    let theme_class = if *theme.read() == Theme::Light {
        "app-container theme-light"
    } else {
        "app-container"
    };

    let mut view_for_keys: Signal<View> = use_context();

    rsx! {
        div {
            class: "{theme_class}",
            tabindex: "0",
            onkeydown: move |evt: KeyboardEvent| {
                let key = evt.key();
                match key {
                    Key::Escape => {
                        // Navigate back
                        let new_view = match view_for_keys.read().clone() {
                            View::Session { project_id, .. } => Some(View::Project(project_id)),
                            View::Project(_) => Some(View::Dashboard),
                            _ => None,
                        };
                        if let Some(v) = new_view {
                            view_for_keys.set(v);
                        }
                    }
                    Key::Character(ref c) if c == "1" => view_for_keys.set(View::Dashboard),
                    Key::Character(ref c) if c == "2" => view_for_keys.set(View::Overview),
                    Key::Character(ref c) if c == "3" => view_for_keys.set(View::Settings),
                    _ => {}
                }
            },
            style { {css} }
            Sidebar {}
            div { class: "main-content",
                match current_view.read().clone() {
                    View::Dashboard => rsx! { Dashboard {} },
                    View::Project(id) => rsx! { ProjectDetail { project_id: id } },
                    View::Session { project_id, session_id } => rsx! { SessionDetail { project_id, session_id } },
                    View::Settings => rsx! { SettingsPage {} },
                    View::Overview => rsx! { OverviewPage {} },
                }
            }
            ToastContainer {}
        }
    }
}
