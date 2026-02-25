pub mod bundle;
pub mod commands;
pub mod db;
pub mod events;
pub mod logging;
pub mod process_watcher;
pub mod reconcile;
pub mod state;
pub mod sync;
pub mod tray;
pub mod ui;
pub mod watcher;

use commands::DbConnector;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};

static DB_POOL: OnceLock<DbConnector> = OnceLock::new();
static REFRESH_COUNTER: AtomicU64 = AtomicU64::new(0);

pub fn get_db_pool() -> &'static DbConnector {
    DB_POOL.get().expect("Database not initialized")
}

pub fn trigger_refresh() {
    REFRESH_COUNTER.fetch_add(1, Ordering::Relaxed);
}

pub fn get_refresh_count() -> u64 {
    REFRESH_COUNTER.load(Ordering::Relaxed)
}

pub fn run() {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive(tracing::Level::INFO.into()),
        )
        .init();

    tracing::info!("Starting Seslog desktop app");

    // Initialize database
    let data_dir = seslog_core::storage::seslog_dir().expect("Failed to find seslog directory");

    // Initialize log rotation
    let log_dir = data_dir.join("logs");
    if let Err(e) = logging::init_logging(&log_dir, 10, 5) {
        tracing::warn!("Log rotation init failed: {}", e);
    }

    // Sync on startup (pull latest from remote if configured)
    let sync_result = sync::sync_on_startup(&data_dir);
    tracing::info!("Startup sync: {:?}", sync_result);
    let db_path = data_dir.join("cache.db");
    let pool = DbConnector::new(&db_path).expect("Failed to initialize database");

    // Full rebuild on startup
    if let Ok(conn) = pool.get() {
        match reconcile::full_rebuild(&conn, &data_dir) {
            Ok(report) => {
                if !report.errors.is_empty() {
                    for err in &report.errors {
                        tracing::warn!("Rebuild error: {}", err);
                    }
                }
                tracing::info!(
                    "Rebuild complete: added={}, removed={}, updated={}",
                    report.added,
                    report.removed,
                    report.updated
                );
            }
            Err(e) => tracing::error!("Full rebuild failed: {}", e),
        }
    }

    // Start file watcher
    let (tx, rx) = std::sync::mpsc::channel();
    watcher::start_watcher(data_dir.clone(), tx);

    // Watcher consumer thread
    let pool_for_watcher = DbConnector::new(&db_path).expect("Failed to create watcher pool");
    let dir_for_watcher = data_dir.clone();
    std::thread::spawn(move || {
        for event in rx {
            match event {
                watcher::WatchEvent::NewEvent(path) => {
                    if let Ok(conn) = pool_for_watcher.get() {
                        let _ = events::process_event(&conn, &path, &dir_for_watcher);
                        trigger_refresh();
                    }
                }
                watcher::WatchEvent::DataChanged(path) => {
                    if let Ok(conn) = pool_for_watcher.get() {
                        let _ = reconcile::incremental_update(&conn, &path, &dir_for_watcher);
                        trigger_refresh();
                    }
                }
            }
        }
    });

    // Periodic reconcile (every 10 minutes)
    let pool_for_reconcile = DbConnector::new(&db_path).expect("Failed to create reconcile pool");
    let dir_for_reconcile = data_dir;
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_secs(600));
            if let Ok(conn) = pool_for_reconcile.get() {
                let _ = reconcile::reconcile(&conn, &dir_for_reconcile);
                trigger_refresh();
            }
        }
    });

    // Store pool globally for UI access
    DB_POOL.set(pool).expect("Database already initialized");

    // Setup system tray (placeholder for future Dioxus tray support)
    tray::setup_tray();

    // Launch Dioxus desktop app
    dioxus::LaunchBuilder::desktop()
        .with_cfg(
            dioxus::desktop::Config::new().with_window(
                dioxus::desktop::WindowBuilder::new()
                    .with_title("Seslog")
                    .with_inner_size(dioxus::desktop::LogicalSize::new(1200.0, 800.0)),
            ),
        )
        .launch(ui::app::App);
}
