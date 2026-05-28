#[tauri::command]
pub async fn get_system_fonts() -> Vec<String> {
    crate::utils::fonts::get_monospace_fonts()
}
