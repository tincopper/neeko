/// Retrieve the list of fonts installed on the system (cached per process).
/// First call enumerates font directories on a blocking thread (pillar 7).
#[tauri::command]
pub async fn get_system_fonts() -> Vec<String> {
    tokio::task::spawn_blocking(crate::common::utils::fonts::get_monospace_fonts)
        .await
        .unwrap_or_default()
}

/// Invalidate the process-level font cache so the next `get_system_fonts`
/// re-enumerates system fonts (e.g. after installing a new font).
#[tauri::command]
pub async fn reset_font_cache() {
    let _ = tokio::task::spawn_blocking(crate::common::utils::fonts::reset_font_cache).await;
}
