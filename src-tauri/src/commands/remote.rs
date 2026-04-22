use crate::models::*;
use crate::AppError;
use crate::AppStateWrapper;
use tauri::State;

#[tauri::command]
pub async fn create_remote_terminal_session(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    project_path: String,
    cols: u16,
    rows: u16,
    state: State<'_, AppStateWrapper>,
    app_handle: tauri::AppHandle,
) -> Result<TerminalSession, AppError> {
    state
        .remote_terminal_manager
        .create_session(
            &host,
            port,
            &username,
            &auth,
            &project_path,
            cols,
            rows,
            app_handle,
        )
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub fn close_remote_terminal_session(session_id: String, state: State<AppStateWrapper>) {
    state.remote_terminal_manager.close_session(&session_id);
}

#[tauri::command]
pub fn resize_remote_terminal(
    session_id: String,
    cols: u16,
    rows: u16,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    state
        .remote_terminal_manager
        .resize_session(&session_id, cols, rows)
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn test_remote_connection(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
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
    auth: AuthMethod,
    path: String,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<String>, AppError> {
    state
        .remote_terminal_manager
        .list_directories(&host, port, &username, &auth, &path)
        .await
        .map_err(AppError::from)
}
