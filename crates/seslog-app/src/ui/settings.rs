use dioxus::prelude::*;
use crate::commands;
use crate::state::{Toast, ToastKind};
use super::components::{GlassPanel, show_toast};

#[allow(non_snake_case)]
pub fn SettingsPage() -> Element {
    let _refresh: Signal<u64> = use_context();
    let mut toasts: Signal<Vec<Toast>> = use_context();

    // Load current config
    let config = commands::get_settings_inner().ok();

    let privacy_mode = config
        .as_ref()
        .map(|c| format!("{:?}", c.privacy_mode).to_lowercase())
        .unwrap_or_else(|| "full".to_string());
    let sanitize_secrets = config.as_ref().map(|c| c.sanitize_secrets).unwrap_or(true);
    let checkpoint_interval = config
        .as_ref()
        .map(|c| c.checkpoint_interval_minutes)
        .unwrap_or(10);

    // Check if seslog hook binary is installed
    let hook_installed = std::process::Command::new("which")
        .arg("seslog")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    let mut privacy_val = use_signal(|| privacy_mode.clone());
    let mut sanitize_val = use_signal(|| sanitize_secrets);

    rsx! {
        div { class: "settings",
            div { class: "page-header",
                h1 { class: "page-title", "Settings" }
                p { class: "page-subtitle", "Configure Seslog" }
            }

            // Privacy section
            div { class: "settings-section",
                h3 { class: "section-header", "Privacy" }
                GlassPanel {
                    div { class: "settings-item",
                        div {
                            div { class: "settings-label", "Privacy Mode" }
                            div { class: "settings-description",
                                "Controls what data is collected from sessions."
                            }
                        }
                        select {
                            class: "form-select",
                            value: "{privacy_val}",
                            onchange: move |evt| {
                                let val = evt.value().to_string();
                                privacy_val.set(val.clone());
                                let json = serde_json::json!({ "privacy_mode": val });
                                match commands::update_settings_inner(json) {
                                    Ok(_) => show_toast(&mut toasts, "Privacy mode updated.".into(), ToastKind::Success),
                                    Err(e) => show_toast(&mut toasts, format!("Error: {}", e), ToastKind::Error),
                                }
                            },
                            option { value: "full", selected: privacy_val() == "full", "Full" }
                            option { value: "summary-only", selected: privacy_val() == "summary-only", "Summary Only" }
                            option { value: "metadata-only", selected: privacy_val() == "metadata-only", "Metadata Only" }
                        }
                    }

                    div { class: "settings-item", style: "margin-top: 16px;",
                        div {
                            div { class: "settings-label", "Sanitize Secrets" }
                            div { class: "settings-description",
                                "Strip API keys and tokens from transcripts before storing."
                            }
                        }
                        label { class: "toggle",
                            input {
                                r#type: "checkbox",
                                checked: sanitize_val(),
                                onchange: move |evt| {
                                    let val = evt.checked();
                                    sanitize_val.set(val);
                                    let json = serde_json::json!({ "sanitize_secrets": val });
                                    match commands::update_settings_inner(json) {
                                        Ok(_) => show_toast(&mut toasts, "Sanitize setting updated.".into(), ToastKind::Success),
                                        Err(e) => show_toast(&mut toasts, format!("Error: {}", e), ToastKind::Error),
                                    }
                                },
                            }
                            span { class: "toggle-knob" }
                        }
                    }

                    div { class: "settings-item", style: "margin-top: 16px;",
                        div {
                            div { class: "settings-label", "Checkpoint Interval" }
                            div { class: "settings-description",
                                "How often session data is checkpointed (in minutes)."
                            }
                        }
                        span { class: "checkpoint-value", "{checkpoint_interval} min" }
                    }
                }
            }

            // Hook Status section
            div { class: "settings-section section-gap",
                h3 { class: "section-header", "Hook Status" }
                GlassPanel {
                    div { class: "settings-item",
                        div { class: "settings-status-row",
                            span {
                                class: if hook_installed { "status-dot" } else { "status-dot archived" },
                            }
                            span { class: "settings-label",
                                if hook_installed { "Hook installed" } else { "Hook not detected" }
                            }
                        }
                    }

                    div { class: "settings-action-row",
                        button {
                            class: "btn btn-secondary",
                            onclick: move |_| {
                                match std::process::Command::new("seslog").arg("doctor").output() {
                                    Ok(output) => {
                                        let stdout = String::from_utf8_lossy(&output.stdout);
                                        let stderr = String::from_utf8_lossy(&output.stderr);
                                        if output.status.success() {
                                            show_toast(&mut toasts, format!("Doctor: {}", stdout.trim()), ToastKind::Success);
                                        } else {
                                            show_toast(&mut toasts, format!("Doctor failed: {}{}", stdout.trim(), stderr.trim()), ToastKind::Error);
                                        }
                                    }
                                    Err(e) => show_toast(&mut toasts, format!("Could not run seslog doctor: {}", e), ToastKind::Error),
                                }
                            },
                            "Run Doctor"
                        }
                        button {
                            class: "btn btn-secondary",
                            onclick: move |_| {
                                match std::process::Command::new("seslog").arg("install").output() {
                                    Ok(output) => {
                                        let stdout = String::from_utf8_lossy(&output.stdout);
                                        let stderr = String::from_utf8_lossy(&output.stderr);
                                        if output.status.success() {
                                            show_toast(&mut toasts, format!("Reinstalled: {}", stdout.trim()), ToastKind::Success);
                                        } else {
                                            show_toast(&mut toasts, format!("Reinstall failed: {}{}", stdout.trim(), stderr.trim()), ToastKind::Error);
                                        }
                                    }
                                    Err(e) => show_toast(&mut toasts, format!("Could not run seslog install: {}", e), ToastKind::Error),
                                }
                            },
                            "Reinstall Hook"
                        }
                    }
                }
            }

            // Sync section
            div { class: "settings-section section-gap",
                h3 { class: "section-header", "Sync" }
                GlassPanel {
                    SyncStatusPanel {}
                }
            }

            // Cache section
            div { class: "settings-section section-gap",
                h3 { class: "section-header", "Cache" }
                GlassPanel {
                    div { class: "settings-item",
                        div {
                            div { class: "settings-label", "Rebuild Cache" }
                            div { class: "settings-description",
                                "Re-scan all project files and rebuild the SQLite cache."
                            }
                        }
                        button {
                            class: "btn btn-primary",
                            onclick: move |_| {
                                let pool = crate::get_db_pool();
                                match commands::rebuild_cache_inner(pool) {
                                    Ok(report) => {
                                        let msg = format!(
                                            "Rebuild complete: {} added, {} removed, {} updated{}",
                                            report.added,
                                            report.removed,
                                            report.updated,
                                            if report.errors.is_empty() {
                                                String::new()
                                            } else {
                                                format!(", {} errors", report.errors.len())
                                            }
                                        );
                                        show_toast(&mut toasts, msg, ToastKind::Success);
                                    }
                                    Err(e) => show_toast(&mut toasts, format!("Rebuild failed: {}", e), ToastKind::Error),
                                }
                            },
                            "Rebuild Cache"
                        }
                    }
                }
            }

            // Diagnostics section
            div { class: "settings-section section-gap",
                h3 { class: "section-header", "Diagnostics" }
                GlassPanel {
                    div { class: "settings-item",
                        div {
                            div { class: "settings-label", "Support Bundle" }
                            div { class: "settings-description",
                                "Generate a ZIP with system info, logs, and config for troubleshooting."
                            }
                        }
                        button {
                            class: "btn btn-secondary",
                            onclick: move |_| {
                                let data_dir = seslog_core::storage::seslog_dir().unwrap_or_default();
                                let output_dir = dirs::download_dir().unwrap_or_else(|| data_dir.clone());
                                match crate::bundle::generate_support_bundle(&output_dir, &data_dir, 200) {
                                    Ok(path) => show_toast(&mut toasts, format!("Bundle saved: {}", path.display()), ToastKind::Success),
                                    Err(e) => show_toast(&mut toasts, format!("Bundle failed: {}", e), ToastKind::Error),
                                }
                            },
                            "Generate Bundle"
                        }
                    }
                }
            }

        }
    }
}

#[component]
fn SyncStatusPanel() -> Element {
    let data_dir = seslog_core::storage::seslog_dir().unwrap_or_default();
    let status = crate::sync::get_sync_status(&data_dir);

    let status_text = if !status.is_repo {
        "Not a git repository"
    } else if !status.has_remote {
        "Local only (no remote)"
    } else if status.pending_changes {
        "Changes pending push"
    } else {
        "Synced"
    };

    let is_ok = status.is_repo && status.has_remote && !status.pending_changes;

    rsx! {
        div { class: "settings-item",
            div { class: "settings-status-row",
                span {
                    class: if is_ok { "status-dot" } else { "status-dot archived" },
                }
                span { class: "settings-label",
                    "{status_text}"
                }
            }
            if let Some(last) = &status.last_sync {
                div { class: "settings-description", "Last commit: {last}" }
            }
        }

        div { class: "settings-item", style: "margin-top: 12px;",
            div {
                div { class: "settings-label", "Machine" }
                div { class: "settings-description",
                    {
                        let profile = crate::sync::get_machine_profile();
                        format!("{} ({}/{})", profile.hostname, profile.platform, profile.arch)
                    }
                }
            }
        }
    }
}
