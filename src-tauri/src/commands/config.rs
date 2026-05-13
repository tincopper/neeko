use crate::models::*;
use crate::AppError;
use crate::AppStateWrapper;
use tauri::State;

#[derive(serde::Deserialize)]
pub struct WslProjectThemeTarget {
    pub distro: String,
    pub path: String,
}

#[derive(serde::Deserialize)]
pub struct ProjectThemeTargets {
    #[serde(default)]
    pub local_paths: Vec<String>,
    #[serde(default)]
    pub wsl: Vec<WslProjectThemeTarget>,
}

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
    wsl_entries: Vec<WSLEntrySession>,
    remote_entries: Vec<RemoteEntrySession>,
    sidebar_width: Option<u32>,
    worktree_state: Option<std::collections::HashMap<String, String>>,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let projects = state
        .project_manager
        .lock()
        .map_err(AppError::from)?
        .list_projects();
    let mut session = state.storage_manager.create_session_from_projects(
        &projects,
        Some(&wsl_entries),
        Some(&remote_entries),
        sidebar_width,
    );
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

#[tauri::command]
pub fn sync_opencode_theme(theme: String, targets: ProjectThemeTargets) -> Result<(), AppError> {
    for path in &targets.local_paths {
        if let Err(e) = crate::opencode_theme::write_project_tui_config(path, &theme) {
            log::warn!(
                "[OpenCodeTheme] Failed to sync tui.json for local project {}: {}",
                path,
                e
            );
        }
    }
    for target in &targets.wsl {
        if let Err(e) =
            crate::opencode_theme::write_wsl_tui_config(&target.distro, &target.path, &theme)
        {
            log::warn!(
                "[OpenCodeTheme] Failed to sync tui.json for WSL project {} ({}): {}",
                target.path,
                target.distro,
                e
            );
        }
    }
    Ok(())
}
