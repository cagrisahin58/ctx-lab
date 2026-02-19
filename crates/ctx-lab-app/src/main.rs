#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
pub mod reconcile;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
