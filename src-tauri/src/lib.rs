mod commands;
mod db;
mod models;
mod parse;
mod storage;

use std::sync::Mutex;

use tauri::Manager;

use db::DbPoolManager;
use models::ConnectionConfig;

pub struct AppState {
    pub connections: Mutex<Vec<ConnectionConfig>>,
    pub pools: DbPoolManager,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.show();
                let _ = main.set_focus();
                let _ = main.center();
            }
            Ok(())
        })
        .manage(AppState {
            connections: Mutex::new(Vec::new()),
            pools: DbPoolManager::new(),
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::load_connections,
            commands::save_connections,
            commands::test_connection,
            commands::db_connect,
            commands::db_disconnect,
            commands::list_databases,
            commands::execute_query,
            commands::apply_changes,
            commands::get_primary_key,
            commands::list_scripts,
            commands::load_script,
            commands::save_script
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
