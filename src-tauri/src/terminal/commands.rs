use crate::terminal::types::*;
use crate::AppError;
use crate::AppStateWrapper;
use tauri::State;

#[tauri::command]
pub fn create_terminal_session(
    project_id: String,
    cols: u16,
    rows: u16,
    shell: Option<String>,
    working_dir: Option<String>,
    command: Option<String>,
    state: State<AppStateWrapper>,
    app_handle: tauri::AppHandle,
) -> Result<TerminalSession, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        let path = project.path.to_string_lossy().to_string();
        state
            .terminal_manager
            .create_session(&path, cols, rows, shell, working_dir, command, app_handle)
            .map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn close_terminal_session(session_id: String, state: State<AppStateWrapper>) {
    state
        .terminal_manager
        .close_session_in_background(&session_id);
}

#[tauri::command]
pub fn resize_terminal(
    session_id: String,
    cols: u16,
    rows: u16,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    state
        .terminal_manager
        .resize_session(&session_id, cols, rows)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn create_wsl_terminal_session(
    distro: String,
    project_path: String,
    cols: u16,
    rows: u16,
    state: State<AppStateWrapper>,
    app_handle: tauri::AppHandle,
) -> Result<TerminalSession, AppError> {
    if !cfg!(target_os = "windows") {
        return Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ));
    }
    state
        .terminal_manager
        .create_wsl_session(&distro, &project_path, cols, rows, app_handle)
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn create_remote_terminal_session(
    host: String,
    port: u16,
    username: String,
    auth: crate::connection::types::AuthMethod,
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
