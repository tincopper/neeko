#[tauri::command]
pub async fn get_system_fonts() -> Vec<String> {
    crate::common::utils::fonts::get_monospace_fonts()
}
