use crate::connection::services;
use crate::AppError;
use crate::AppStateWrapper;
use tauri::State;

#[tauri::command]
pub fn get_wsl_distros() -> Result<Vec<String>, AppError> {
    services::get_wsl_distros()
}

#[tauri::command]
pub fn get_wsl_directories(distro: String, path: Option<String>) -> Result<Vec<String>, AppError> {
    services::get_wsl_directories(&distro, path.as_deref())
}

#[tauri::command]
pub fn get_wsl_home_dir(distro: String) -> Result<String, AppError> {
    services::get_wsl_home_dir(&distro)
}

#[tauri::command]
pub async fn test_remote_connection(
    host: String,
    port: u16,
    username: String,
    auth: crate::connection::types::AuthMethod,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    state
        .remote_terminal_manager
        .test_connection(&host, port, &username, &auth)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn list_remote_directories(
    host: String,
    port: u16,
    username: String,
    auth: crate::connection::types::AuthMethod,
    path: String,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<String>, AppError> {
    state
        .remote_terminal_manager
        .list_directories(&host, port, &username, &auth, &path)
        .await
        .map_err(AppError::from)
}
