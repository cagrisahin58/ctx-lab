// System tray module for ctx-lab
// Provides system tray icon and menu

use dioxus::prelude::*;

/// Setup system tray for the application
pub fn setup_tray() {
    // Note: Dioxus 0.7 system tray setup requires accessing the desktop config
    // For now, this is a placeholder that will be integrated when we add
    // proper Tauri/Dioxus desktop integration
    tracing::info!("System tray setup placeholder");
}

/// Get tray menu items for projects
pub fn get_tray_menu_items(projects: &[TrayProject]) -> Vec<TrayMenuItem> {
    let mut items = Vec::new();

    // Add projects section
    for project in projects.iter().take(5) {
        items.push(TrayMenuItem {
            id: format!("project_{}", project.id),
            label: format!("📁 {}", project.name),
            enabled: true,
        });
    }

    if !items.is_empty() {
        items.push(TrayMenuItem {
            id: "sep1".to_string(),
            label: "---".to_string(),
            enabled: false,
        });
    }

    // Standard menu items
    items.push(TrayMenuItem {
        id: "dashboard".to_string(),
        label: "📊 Open Dashboard".to_string(),
        enabled: true,
    });

    items.push(TrayMenuItem {
        id: "settings".to_string(),
        label: "⚙️ Settings".to_string(),
        enabled: true,
    });

    items.push(TrayMenuItem {
        id: "sep2".to_string(),
        label: "---".to_string(),
        enabled: false,
    });

    items.push(TrayMenuItem {
        id: "quit".to_string(),
        label: "❌ Quit".to_string(),
        enabled: true,
    });

    items
}

/// Tray project info
#[derive(Debug, Clone)]
pub struct TrayProject {
    pub id: String,
    pub name: String,
    pub last_summary: Option<String>,
    pub is_active: bool,
}

/// Tray menu item
#[derive(Debug, Clone)]
pub struct TrayMenuItem {
    pub id: String,
    pub label: String,
    pub enabled: bool,
}
