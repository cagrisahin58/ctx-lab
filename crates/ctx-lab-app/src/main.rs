#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod commands;
mod db;
pub mod events;
pub mod reconcile;
pub mod watcher;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
