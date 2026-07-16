use crate::session::types::{RemoteEntrySession, SessionStore, WSLEntrySession};
use crate::session::StorageManager;
use crate::AppError;
use crate::AppStateWrapper;
use tauri::State;

#[tauri::command]
pub fn save_config(
    config: serde_json::Value,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    state
        .storage_manager
        .save_config(&config)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn load_config(state: State<AppStateWrapper>) -> Result<serde_json::Value, AppError> {
    state.storage_manager.load_config().map_err(AppError::from)
}

#[tauri::command]
pub fn save_session(
    _wsl_entries: Vec<WSLEntrySession>,
    _remote_entries: Vec<RemoteEntrySession>,
    sidebar_width: Option<u32>,
    worktree_state: Option<std::collections::HashMap<String, String>>,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let projects = state
        .project_manager
        .lock()
        .map_err(AppError::from)?
        .list_projects();

    // 从 ProjectManager 推导 WSL/Remote entries，忽略前端传入值
    let wsl = StorageManager::collect_wsl_projects(&projects);
    let remote = StorageManager::collect_remote_projects(&projects);

    let active_id = state
        .active_project_id
        .lock()
        .map_err(AppError::from)?
        .clone();

    let mut session = state.storage_manager.create_session_from_projects(
        &projects,
        Some(&wsl),
        Some(&remote),
        sidebar_width,
    );
    session.active_project_id = active_id;
    if let Some(wt) = worktree_state {
        session.worktree_state = wt;
    }
    state
        .storage_manager
        .save_session(&session)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn load_session(state: State<AppStateWrapper>) -> Result<SessionStore, AppError> {
    state.storage_manager.load_session().map_err(AppError::from)
}

#[tauri::command]
pub fn get_config_dir(state: State<AppStateWrapper>) -> String {
    state
        .storage_manager
        .get_config_dir()
        .to_string_lossy()
        .to_string()
}

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Neeko!", name)
}

#[tauri::command]
pub fn save_vcs_settings_command(
    project_id: String,
    settings: serde_json::Value,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    state
        .storage_manager
        .save_vcs_settings(&project_id, &settings)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn load_vcs_settings_command(
    project_id: String,
    state: State<AppStateWrapper>,
) -> Result<serde_json::Value, AppError> {
    state
        .storage_manager
        .load_vcs_settings(&project_id)
        .map_err(AppError::from)
}
