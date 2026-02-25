use dioxus::prelude::*;
use crate::commands;
use super::components::GlassPanel;

#[allow(non_snake_case)]
pub fn SettingsPage() -> Element {
    let _refresh: Signal<u64> = use_context();

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

    let mut status_msg = use_signal(String::new);
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
                            div { style: "font-weight: 600; color: var(--text-primary);", "Privacy Mode" }
                            div { style: "font-size: 13px; color: var(--text-muted); margin-top: 4px;",
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
                                    Ok(_) => status_msg.set("Privacy mode updated.".to_string()),
                                    Err(e) => status_msg.set(format!("Error: {}", e)),
                                }
                            },
                            option { value: "full", selected: privacy_val() == "full", "Full" }
                            option { value: "summary-only", selected: privacy_val() == "summary-only", "Summary Only" }
                            option { value: "metadata-only", selected: privacy_val() == "metadata-only", "Metadata Only" }
                        }
                    }

                    div { class: "settings-item", style: "margin-top: 16px;",
                        div {
                            div { style: "font-weight: 600; color: var(--text-primary);", "Sanitize Secrets" }
                            div { style: "font-size: 13px; color: var(--text-muted); margin-top: 4px;",
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
                                        Ok(_) => status_msg.set("Sanitize setting updated.".to_string()),
                                        Err(e) => status_msg.set(format!("Error: {}", e)),
                                    }
                                },
                            }
                            span { class: "toggle-slider" }
                        }
                    }

                    div { class: "settings-item", style: "margin-top: 16px;",
                        div {
                            div { style: "font-weight: 600; color: var(--text-primary);", "Checkpoint Interval" }
                            div { style: "font-size: 13px; color: var(--text-muted); margin-top: 4px;",
                                "How often session data is checkpointed (in minutes)."
                            }
                        }
                        span { style: "font-size: 16px; font-weight: 600; color: var(--text-primary); font-family: monospace;",
                            "{checkpoint_interval} min"
                        }
                    }
                }
            }

            // Hook Status section
            div { class: "settings-section", style: "margin-top: 24px;",
                h3 { class: "section-header", "Hook Status" }
                GlassPanel {
                    div { class: "settings-item",
                        div { style: "display: flex; align-items: center; gap: 8px;",
                            span {
                                class: if hook_installed { "status-dot" } else { "status-dot archived" },
                            }
                            span { style: "font-weight: 600; color: var(--text-primary);",
                                if hook_installed { "Hook installed" } else { "Hook not detected" }
                            }
                        }
                    }

                    div { style: "display: flex; gap: 8px; margin-top: 16px;",
                        button {
                            class: "btn btn-secondary",
                            onclick: move |_| {
                                status_msg.set("Doctor check: not yet implemented.".to_string());
                            },
                            "Run Doctor"
                        }
                        button {
                            class: "btn btn-secondary",
                            onclick: move |_| {
                                status_msg.set("Reinstall: not yet implemented.".to_string());
                            },
                            "Reinstall Hook"
                        }
                    }
                }
            }

            // Sync section
            div { class: "settings-section", style: "margin-top: 24px;",
                h3 { class: "section-header", "Sync" }
                GlassPanel {
                    SyncStatusPanel {}
                }
            }

            // Cache section
            div { class: "settings-section", style: "margin-top: 24px;",
                h3 { class: "section-header", "Cache" }
                GlassPanel {
                    div { class: "settings-item",
                        div {
                            div { style: "font-weight: 600; color: var(--text-primary);", "Rebuild Cache" }
                            div { style: "font-size: 13px; color: var(--text-muted); margin-top: 4px;",
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
                                        status_msg.set(msg);
                                    }
                                    Err(e) => status_msg.set(format!("Rebuild failed: {}", e)),
                                }
                            },
                            "Rebuild Cache"
                        }
                    }
                }
            }

            // Diagnostics section
            div { class: "settings-section", style: "margin-top: 24px;",
                h3 { class: "section-header", "Diagnostics" }
                GlassPanel {
                    div { class: "settings-item",
                        div {
                            div { style: "font-weight: 600; color: var(--text-primary);", "Support Bundle" }
                            div { style: "font-size: 13px; color: var(--text-muted); margin-top: 4px;",
                                "Generate a ZIP with system info, logs, and config for troubleshooting."
                            }
                        }
                        button {
                            class: "btn btn-secondary",
                            onclick: move |_| {
                                let data_dir = seslog_core::storage::seslog_dir().unwrap_or_default();
                                let output_dir = dirs::download_dir().unwrap_or_else(|| data_dir.clone());
                                match crate::bundle::generate_support_bundle(&output_dir, &data_dir, 200) {
                                    Ok(path) => status_msg.set(format!("Bundle saved: {}", path.display())),
                                    Err(e) => status_msg.set(format!("Bundle failed: {}", e)),
                                }
                            },
                            "Generate Bundle"
                        }
                    }
                }
            }

            // Status message
            if !status_msg().is_empty() {
                div {
                    style: "margin-top: 16px; padding: 12px 16px; background: var(--bg-tertiary); border-radius: 8px; font-size: 13px; color: var(--text-secondary);",
                    "{status_msg}"
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
            div { style: "display: flex; align-items: center; gap: 8px;",
                span {
                    class: if is_ok { "status-dot" } else { "status-dot archived" },
                }
                span { style: "font-weight: 600; color: var(--text-primary);",
                    "{status_text}"
                }
            }
            if let Some(last) = &status.last_sync {
                div { style: "font-size: 12px; color: var(--text-muted); margin-top: 4px;",
                    "Last commit: {last}"
                }
            }
        }

        div { class: "settings-item", style: "margin-top: 12px;",
            div {
                div { style: "font-weight: 600; color: var(--text-primary);", "Machine" }
                div { style: "font-size: 13px; color: var(--text-muted); margin-top: 4px;",
                    {
                        let profile = crate::sync::get_machine_profile();
                        format!("{} ({}/{})", profile.hostname, profile.platform, profile.arch)
                    }
                }
            }
        }
    }
}
