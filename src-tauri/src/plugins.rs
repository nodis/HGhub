//! Tauri adapter; the development harness shares the exact same dispatcher.
use hghub_hpp::{PluginManager, Result};
use serde_json::Value;
use std::sync::Arc;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::FsExt;

/// Document-provider access stays in the host adapter, never in a plugin API.
pub struct PickedDocuments(pub tauri::AppHandle);
impl hghub_hpp::manager::DocumentReader for PickedDocuments {
    fn read(&self, location: &str, limit: usize) -> Result<Vec<u8>> {
        use std::io::Read;
        let file: tauri_plugin_fs::FilePath = location
            .parse()
            .map_err(|_| hghub_hpp::PluginError::invalid("文件选择器返回了无效地址"))?;
        let mut bytes = Vec::new();
        let mut options = tauri_plugin_fs::OpenOptions::new();
        options.read(true);
        self.0
            .fs()
            .open(file, options)?
            .take((limit + 1) as u64)
            .read_to_end(&mut bytes)?;
        Ok(bytes)
    }
}

#[tauri::command]
pub async fn pick_plugin_files(app: tauri::AppHandle) -> Result<Vec<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("HPP 插件或列表", &["js", "mjs", "json"])
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .map(|file| Ok(file.to_string()))
            .collect()
    })
    .await
    .map_err(|_| hghub_hpp::PluginError::internal("无法打开文件选择器"))?
}

#[tauri::command]
pub async fn hpp_manage(
    manager: tauri::State<'_, Arc<PluginManager>>,
    action: String,
    params: Value,
) -> Result<Value> {
    hghub_hpp::ipc::dispatch(manager.inner(), action, params).await
}
