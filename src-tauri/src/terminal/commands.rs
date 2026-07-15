#[allow(clippy::wildcard_imports)]
use crate::common::terminal::types::*;
use crate::AppError;
use crate::AppStateWrapper;
use tauri::State;

#[tauri::command]
pub async fn create_terminal_session(
    project_id: String,
    cols: u16,
    rows: u16,
    shell: Option<String>,
    working_dir: Option<String>,
    command: Option<String>,
    state: State<'_, AppStateWrapper>,
    app_handle: tauri::AppHandle,
) -> Result<TerminalSession, AppError> {
    let path = {
        let manager = state.project_manager.lock().map_err(AppError::from)?;
        let project = manager
            .get_project(&project_id)
            .ok_or_else(|| AppError::NotFound(format!("Project not found: {}", project_id)))?;
        project.path.to_string_lossy().to_string()
    };

    // Theme sync — skip for task terminals (command != None)
    if command.is_none() {
        let _ = crate::theme::service::write_project_theme_config(
            &crate::theme::service::ThemeContext::Local,
            &path,
        )
        .await;
    }

    state
        .terminal_manager
        .create_session(&path, cols, rows, shell, working_dir, command, app_handle)
        .map_err(AppError::from)
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
pub async fn create_wsl_terminal_session(
    distro: String,
    project_path: String,
    cols: u16,
    rows: u16,
    state: State<'_, AppStateWrapper>,
    app_handle: tauri::AppHandle,
) -> Result<TerminalSession, AppError> {
    if !cfg!(target_os = "windows") {
        return Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ));
    }

    // WSL theme sync — install theme files and write project-level configs
    // All errors are non-fatal: terminal creation proceeds regardless
    {
        use crate::theme::{
            common::read_neeko_theme,
            opencode::{
                install_wsl_theme_files, read_enable_opencode_theme_sync,
                read_enable_pi_theme_sync, write_wsl_tui_config,
            },
            pi,
        };

        if let Err(e) = install_wsl_theme_files(&distro).await {
            log::warn!("[WSL] Failed to install OpenCode theme files: {}", e);
        }
        if let Err(e) = pi::install_wsl_pi_theme_files(&distro).await {
            log::warn!("[WSL] Failed to install Pi theme files: {}", e);
        }
        let current_theme = read_neeko_theme().unwrap_or_else(|| "dark".to_string());
        if read_enable_opencode_theme_sync() {
            if let Err(e) = write_wsl_tui_config(&distro, &project_path, &current_theme).await {
                log::warn!("[WSL] Failed to write OpenCode tui.json: {}", e);
            }
        }
        if read_enable_pi_theme_sync() {
            if let Err(e) = pi::write_wsl_pi_settings(&distro, &project_path, &current_theme).await
            {
                log::warn!("[WSL] Failed to write Pi settings.json: {}", e);
            }
        }
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
    auth: crate::common::connection::types::AuthMethod,
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
