#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use ctx_lab_app::commands::DbPool;
use ctx_lab_app::{commands, events, reconcile, tray, watcher};

use std::sync::Mutex;
use tauri::{Emitter, Manager};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let ctx_lab_dir = ctx_lab_core::storage::ctx_lab_dir()
                .map_err(|e| Box::new(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())) as Box<dyn std::error::Error>)?;
            let db_path = ctx_lab_dir.join("cache.db");

            // Initialize DB + full rebuild
            let pool = DbPool::new(&db_path)
                .map_err(|e| Box::new(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;
            {
                let conn = pool.get()
                    .map_err(|e| Box::new(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;
                if let Err(e) = reconcile::full_rebuild(&conn, &ctx_lab_dir) {
                    eprintln!("[ctx-lab] Warning: full_rebuild failed: {}", e);
                }
            }

            // Start file watcher
            let (tx, rx) = std::sync::mpsc::channel();
            watcher::start_watcher(ctx_lab_dir.clone(), tx);

            // Watcher consumer thread
            let pool_for_watcher = DbPool::new(&db_path)
                .map_err(|e| Box::new(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;
            let dir_for_watcher = ctx_lab_dir.clone();
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                for event in rx {
                    match event {
                        watcher::WatchEvent::NewEvent(path) => {
                            if let Ok(conn) = pool_for_watcher.get() {
                                let _ = events::process_event(&conn, &path, &dir_for_watcher);
                                let _ = app_handle.emit("ctx-lab-refresh", ());
                            }
                        }
                        watcher::WatchEvent::DataChanged(path) => {
                            if let Ok(conn) = pool_for_watcher.get() {
                                let _ = reconcile::incremental_update(&conn, &path, &dir_for_watcher);
                                let _ = app_handle.emit("ctx-lab-refresh", ());
                            }
                        }
                    }
                }
            });

            // Periodic reconcile (every 10 minutes)
            let pool_for_reconcile = DbPool::new(&db_path)
                .map_err(|e| Box::new(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;
            let dir_for_reconcile = ctx_lab_dir.clone();
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(600));
                    if let Ok(conn) = pool_for_reconcile.get() {
                        let _ = reconcile::reconcile(&conn, &dir_for_reconcile);
                    }
                }
            });

            // Manage state
            app.manage(Mutex::new(pool));

            // System tray
            tray::setup_tray(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_projects,
            commands::get_project_detail,
            commands::get_sessions,
            commands::get_roadmap,
            commands::rebuild_cache,
            commands::get_settings,
            commands::update_settings,
            commands::open_in_editor,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
