use dioxus::prelude::*;

#[component]
pub fn ProgressBar(percent: f64) -> Element {
    rsx! {
        div { class: "project-progress",
            div { class: "progress-label",
                span { "Progress" }
                span { "{percent as i32}%" }
            }
            div { class: "progress-bar",
                div { class: "progress-fill", style: "width: {percent}%" }
            }
        }
    }
}

#[component]
pub fn StatusDot(active: bool) -> Element {
    rsx! {
        span { class: if active { "status-dot" } else { "status-dot archived" } }
    }
}

#[component]
pub fn CostBadge(cost: f64) -> Element {
    let class = if cost > 1.0 { "cost-badge amber" } else { "cost-badge green" };
    rsx! {
        span { class: "{class}", "${cost:.4}" }
    }
}

#[component]
pub fn EmptyState(icon: String, title: String, message: String) -> Element {
    rsx! {
        div { class: "empty-state",
            div { class: "empty-state-icon", "{icon}" }
            h2 { class: "empty-state-title", "{title}" }
            p { class: "empty-state-text", "{message}" }
        }
    }
}

#[component]
pub fn GlassPanel(children: Element) -> Element {
    rsx! {
        div { class: "glass-panel", style: "padding: 24px;", {children} }
    }
}
