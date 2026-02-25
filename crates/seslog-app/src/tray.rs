// System tray module for seslog
// Dioxus 0.6 does not have native tray icon support.
// This module provides the data model; actual tray integration
// will be added when Dioxus ships tray APIs or via tray-icon crate.

/// Setup system tray for the application.
/// Currently a no-op placeholder — will be implemented when Dioxus adds tray support.
pub fn setup_tray() {
    tracing::info!("System tray: not yet available in Dioxus 0.6 (placeholder)");
}

/// Tray project info for building context menus.
#[derive(Debug, Clone)]
pub struct TrayProject {
    pub id: String,
    pub name: String,
    pub is_active: bool,
}

/// Tray menu item descriptor.
#[derive(Debug, Clone)]
pub struct TrayMenuItem {
    pub id: String,
    pub label: String,
    pub enabled: bool,
}

/// Build menu items for the tray context menu.
pub fn get_tray_menu_items(projects: &[TrayProject]) -> Vec<TrayMenuItem> {
    let mut items = Vec::new();

    for project in projects.iter().take(5) {
        items.push(TrayMenuItem {
            id: format!("project_{}", project.id),
            label: project.name.clone(),
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

    items.push(TrayMenuItem {
        id: "dashboard".to_string(),
        label: "Open Dashboard".to_string(),
        enabled: true,
    });

    items.push(TrayMenuItem {
        id: "settings".to_string(),
        label: "Settings".to_string(),
        enabled: true,
    });

    items.push(TrayMenuItem {
        id: "sep2".to_string(),
        label: "---".to_string(),
        enabled: false,
    });

    items.push(TrayMenuItem {
        id: "quit".to_string(),
        label: "Quit".to_string(),
        enabled: true,
    });

    items
}
