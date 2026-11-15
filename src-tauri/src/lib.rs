mod commands;
mod logging;
#[cfg(target_os = "macos")]
mod macos_titlebar;
mod network_policy;
mod plugins;
use tauri::Manager;
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            network_policy::bind_security(&dir);
            let manager = std::sync::Arc::new(
                hghub_hpp::PluginManager::open(dir.join("hpp"))?
                    .with_document_reader(std::sync::Arc::new(plugins::PickedDocuments(app.handle().clone()))),
            );
            app.manage(manager.clone());
            tauri::async_runtime::spawn(async move {
                manager.initialize_enabled().await;
            });
            #[cfg(target_os = "macos")]
            macos_titlebar::create_main_window(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            plugins::hpp_manage,
            plugins::pick_plugin_files,
            commands::app_boot,
            commands::security_set,
            commands::debug_log,
            commands::open_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running HGhub");
}
