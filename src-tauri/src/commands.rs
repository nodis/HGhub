use serde_json::{json, Value};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;
#[tauri::command]
pub fn app_boot() -> Value {
    json!({"strict_security":crate::network_policy::strict_security()})
}
#[tauri::command]
pub fn security_set(strict: bool) -> Result<bool, String> {
    crate::network_policy::set_strict_security(strict)?;
    Ok(crate::network_policy::strict_security())
}
#[tauri::command]
pub fn debug_log(app: tauri::AppHandle, msg: String) -> Result<(), String> {
    crate::logging::append_debug(&app.path().app_data_dir().map_err(|e| e.to_string())?, &msg)
}
#[tauri::command]
pub fn open_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let target = crate::network_policy::parse_target(&url)?;
    app.opener()
        .open_url(target.as_str(), None::<&str>)
        .map_err(|e| e.to_string())
}
