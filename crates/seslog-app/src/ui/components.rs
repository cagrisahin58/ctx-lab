use dioxus::prelude::*;
use crate::state::{Toast, ToastKind, View};

pub fn format_minutes(total: i64) -> String {
    let hours = total / 60;
    let mins = total % 60;
    if hours > 0 {
        format!("{}h {}m", hours, mins)
    } else {
        format!("{}m", mins)
    }
}

pub fn format_date(raw: &str) -> String {
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

/// Format cost in a human-friendly way
pub fn format_cost(cost: f64) -> String {
    if cost < 0.01 {
        "< $0.01".to_string()
    } else if cost < 10.0 {
        format!("${:.2}", cost)
    } else {
        format!("${:.0}", cost)
    }
}

/// Get progress bar color based on percentage
fn progress_color(percent: f64) -> &'static str {
    if percent <= 33.0 {
        "var(--error)"
    } else if percent <= 66.0 {
        "var(--warning)"
    } else {
        "var(--success)"
    }
}

#[component]
pub fn ProgressBar(percent: f64) -> Element {
    let color = progress_color(percent);
    rsx! {
        div { class: "project-progress",
            div { class: "progress-label",
                span { "Progress" }
                span { "{percent as i32}%" }
            }
            div { class: "progress-bar",
                div {
                    class: "progress-fill",
                    style: "width: {percent}%; background: {color};",
                }
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
    let display = format_cost(cost);
    rsx! {
        span { class: "{class}", "{display}" }
    }
}

#[component]
pub fn EmptyState(icon: String, title: String, message: String) -> Element {
    rsx! {
        div { class: "empty-state",
            div { class: "empty-state-icon",
                dangerous_inner_html: "{icon}",
            }
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

// Skeleton loading components

#[component]
pub fn SkeletonLine(width: Option<String>) -> Element {
    let class = match width.as_deref() {
        Some("short") => "skeleton skeleton-line short",
        Some("long") => "skeleton skeleton-line long",
        _ => "skeleton skeleton-line medium",
    };
    rsx! { div { class: "{class}" } }
}

#[component]
pub fn SkeletonCard() -> Element {
    rsx! {
        div { class: "glass-panel skeleton-card",
            div { class: "skeleton skeleton-line short" }
            div { class: "skeleton skeleton-line long", style: "margin-top: 16px;" }
            div { class: "skeleton skeleton-line medium" }
            div { class: "skeleton skeleton-progress" }
        }
    }
}

#[component]
pub fn SkeletonRow() -> Element {
    rsx! { div { class: "skeleton skeleton-row" } }
}

/// Dashboard skeleton: hero card + 2 project cards
#[allow(non_snake_case)]
pub fn DashboardSkeleton() -> Element {
    rsx! {
        div { class: "dashboard",
            div { class: "page-header",
                div { class: "skeleton skeleton-line short", style: "height: 28px; width: 160px;" }
                div { class: "skeleton skeleton-line short", style: "height: 14px; width: 120px; margin-top: 8px;" }
            }
            // Hero skeleton
            div { class: "glass-panel", style: "padding: 24px; margin-bottom: 24px;",
                div { class: "skeleton skeleton-badge" }
                div { class: "skeleton skeleton-line medium", style: "height: 24px; margin-top: 16px;" }
                div { class: "skeleton skeleton-line long", style: "margin-top: 12px;" }
                div { class: "skeleton skeleton-progress" }
            }
            // Card grid skeleton
            div { class: "projects-grid",
                SkeletonCard {}
                SkeletonCard {}
            }
        }
    }
}

/// Project detail skeleton: roadmap + stats
#[allow(non_snake_case)]
pub fn ProjectDetailSkeleton() -> Element {
    rsx! {
        div { class: "project-detail",
            div { class: "skeleton skeleton-line short", style: "height: 36px; width: 100px; margin-bottom: 16px;" }
            div { class: "skeleton skeleton-line medium", style: "height: 28px; width: 240px;" }
            div { class: "project-layout",
                div {
                    // Roadmap skeleton
                    div { class: "glass-panel", style: "padding: 24px;",
                        div { class: "skeleton skeleton-line short", style: "height: 20px; width: 100px; margin-bottom: 16px;" }
                        for _ in 0..5 {
                            div { class: "skeleton skeleton-line long", style: "margin-bottom: 12px;" }
                        }
                    }
                    // Timeline skeleton
                    div { class: "glass-panel", style: "padding: 24px; margin-top: 24px;",
                        div { class: "skeleton skeleton-line short", style: "height: 20px; width: 140px; margin-bottom: 16px;" }
                        for _ in 0..3 {
                            div { class: "skeleton skeleton-row", style: "margin-bottom: 8px;" }
                        }
                    }
                }
                div {
                    // Progress skeleton
                    div { class: "glass-panel", style: "padding: 24px; text-align: center;",
                        div { class: "skeleton skeleton-circle", style: "margin: 0 auto;" }
                        div { class: "skeleton skeleton-line short", style: "margin: 12px auto 0; width: 80px;" }
                        div { class: "skeleton skeleton-progress" }
                    }
                    // Stats skeleton
                    div { class: "glass-panel section-gap-sm", style: "padding: 24px;",
                        div { class: "skeleton skeleton-line short", style: "height: 20px; width: 100px; margin-bottom: 16px;" }
                        div { class: "stat-grid",
                            for _ in 0..4 {
                                div {
                                    div { class: "skeleton skeleton-line short", style: "height: 12px; width: 80px;" }
                                    div { class: "skeleton skeleton-line medium", style: "height: 18px; width: 60px; margin-top: 4px;" }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Session detail skeleton
#[allow(non_snake_case)]
pub fn SessionDetailSkeleton() -> Element {
    rsx! {
        div { class: "session-detail",
            div { class: "skeleton skeleton-line short", style: "height: 36px; width: 140px; margin-bottom: 16px;" }
            div { class: "skeleton skeleton-line medium", style: "height: 28px; width: 300px;" }
            div { class: "skeleton skeleton-line short", style: "height: 14px; width: 180px; margin-top: 8px;" }
            // Meta grid skeleton
            div { class: "session-meta-grid", style: "margin-top: 24px;",
                for _ in 0..6 {
                    div { class: "glass-panel", style: "padding: 16px; text-align: center;",
                        div { class: "skeleton skeleton-line short", style: "height: 12px; width: 60px; margin: 0 auto;" }
                        div { class: "skeleton skeleton-line medium", style: "height: 18px; width: 80px; margin: 8px auto 0;" }
                    }
                }
            }
            // Summary skeleton
            div { class: "glass-panel section-gap", style: "padding: 24px;",
                div { class: "skeleton skeleton-line short", style: "height: 20px; width: 100px; margin-bottom: 16px;" }
                div { class: "skeleton skeleton-line long" }
                div { class: "skeleton skeleton-line long" }
                div { class: "skeleton skeleton-line medium" }
            }
        }
    }
}

/// Overview skeleton: header + rows
#[allow(non_snake_case)]
pub fn OverviewSkeleton() -> Element {
    rsx! {
        div { class: "overview",
            div { class: "page-header",
                div { class: "skeleton skeleton-line short", style: "height: 28px; width: 140px;" }
                div { class: "skeleton skeleton-line short", style: "height: 14px; width: 100px; margin-top: 8px;" }
            }
            div { style: "overflow-x: auto; margin-top: 16px;",
                div { class: "skeleton skeleton-row", style: "opacity: 0.7;" }
                for _ in 0..5 {
                    div { class: "skeleton skeleton-row", style: "margin-top: 4px;" }
                }
            }
        }
    }
}

// Breadcrumb navigation

#[derive(Clone, PartialEq)]
pub struct Crumb {
    pub label: String,
    pub view: Option<View>,
}

#[component]
pub fn Breadcrumb(crumbs: Vec<Crumb>) -> Element {
    let mut current_view: Signal<View> = use_context();

    if crumbs.len() <= 1 {
        return rsx! {};
    }

    rsx! {
        nav { class: "breadcrumb", "aria-label": "Breadcrumb",
            for (i, crumb) in crumbs.iter().enumerate() {
                {
                    let is_last = i == crumbs.len() - 1;
                    let label = crumb.label.clone();
                    if is_last {
                        rsx! {
                            span { class: "breadcrumb-current", "{label}" }
                        }
                    } else if let Some(view) = crumb.view.clone() {
                        rsx! {
                            button {
                                class: "breadcrumb-link",
                                onclick: move |_| current_view.set(view.clone()),
                                "{label}"
                            }
                            span { class: "breadcrumb-sep", "\u{203A}" }
                        }
                    } else {
                        rsx! {
                            span { class: "breadcrumb-current", "{label}" }
                        }
                    }
                }
            }
        }
    }
}

// Toast notification system

static TOAST_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn next_toast_id() -> u64 {
    TOAST_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

/// Show a toast message. Call from any component that has toast context.
pub fn show_toast(toasts: &mut Signal<Vec<Toast>>, message: String, kind: ToastKind) {
    let id = next_toast_id();
    toasts.write().push(Toast { message, kind, id });
}

/// Toast container — renders at the top-right, manages auto-dismiss.
#[allow(non_snake_case)]
pub fn ToastContainer() -> Element {
    let mut toasts: Signal<Vec<Toast>> = use_context();

    // Auto-dismiss: poll every 100ms, remove toasts older than 3s
    // We track creation time via a separate map keyed by toast id
    let mut timers: Signal<Vec<(u64, f64)>> = use_signal(Vec::new);

    // Register new toasts for timing
    {
        let current_toasts = toasts.read();
        let mut current_timers = timers.write();
        for toast in current_toasts.iter() {
            if !current_timers.iter().any(|(id, _)| *id == toast.id) {
                // Use a simple counter — we'll dismiss after ~3 seconds of polling
                current_timers.push((toast.id, 30.0)); // 30 ticks × 100ms = 3s
            }
        }
    }

    // Poll for dismiss
    use_future(move || async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            let mut expired = Vec::new();
            {
                let mut t = timers.write();
                for entry in t.iter_mut() {
                    entry.1 -= 1.0;
                    if entry.1 <= 0.0 {
                        expired.push(entry.0);
                    }
                }
                t.retain(|(id, _)| !expired.contains(id));
            }
            if !expired.is_empty() {
                toasts.write().retain(|t| !expired.contains(&t.id));
            }
        }
    });

    let current = toasts.read();
    if current.is_empty() {
        return rsx! {};
    }

    rsx! {
        div { class: "toast-container",
            for toast in current.iter() {
                {
                    let kind_class = match toast.kind {
                        ToastKind::Success => "toast toast-success",
                        ToastKind::Error => "toast toast-error",
                        ToastKind::Info => "toast toast-info",
                    };
                    let icon = match toast.kind {
                        ToastKind::Success => "\u{2713}",
                        ToastKind::Error => "\u{2717}",
                        ToastKind::Info => "\u{2139}",
                    };
                    let msg = toast.message.clone();
                    let tid = toast.id;
                    rsx! {
                        div { class: "{kind_class}", key: "{tid}",
                            span { class: "toast-icon", "{icon}" }
                            span { class: "toast-message", "{msg}" }
                            button {
                                class: "toast-close",
                                onclick: move |_| {
                                    toasts.write().retain(|t| t.id != tid);
                                },
                                "\u{2715}"
                            }
                        }
                    }
                }
            }
        }
    }
}
