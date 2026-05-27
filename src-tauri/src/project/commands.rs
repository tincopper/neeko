use crate::project::types::{GitInfo, Project};
use crate::AppError;
use crate::AppStateWrapper;
use std::path::PathBuf;
use tauri::State;

#[tauri::command]
pub fn add_project(
    path: String,
    agent_id: Option<String>,
    ide: Option<String>,
    avatar_color: Option<String>,
    state: State<AppStateWrapper>,
    app_handle: tauri::AppHandle,
) -> Result<Project, AppError> {
    let project = state
        .project_manager
        .lock()
        .map_err(AppError::from)?
        .add_project(PathBuf::from(path), agent_id, ide, avatar_color)
        .map_err(AppError::from)?;

    state
        .watcher_manager
        .watch(project.id.clone(), project.path.clone(), app_handle);

    Ok(project)
}

#[tauri::command]
pub fn remove_project(project_id: String, state: State<AppStateWrapper>) {
    let mut pm = match state.project_manager.lock() {
        Ok(guard) => guard,
        Err(_) => {
            log::error!("project_manager lock poisoned");
            return;
        }
    };
    pm.remove_project(&project_id);
    drop(pm);
    state.terminal_manager.close_session(&project_id);
    state.watcher_manager.unwatch(&project_id);
    if let Ok(pm) = state.project_manager.lock() {
        let projects = pm.list_projects();
        let session = state
            .storage_manager
            .create_session_from_projects(&projects, None, None, None);
        if let Err(e) = state.storage_manager.save_session(&session) {
            log::error!(
                "Failed to save session after removing project {}: {}",
                project_id,
                e
            );
        }
    }
}

#[tauri::command]
pub fn list_projects(state: State<AppStateWrapper>) -> Vec<Project> {
    state
        .project_manager
        .lock()
        .map(|pm| pm.list_projects())
        .unwrap_or_default()
}

#[tauri::command]
pub fn get_project(project_id: String, state: State<AppStateWrapper>) -> Result<Project, AppError> {
    state
        .project_manager
        .lock()
        .map_err(AppError::from)?
        .get_project(&project_id)
        .cloned()
        .ok_or_else(|| AppError::NotFound(format!("Project not found: {}", project_id)))
}

#[tauri::command]
pub fn refresh_git_info(
    project_id: String,
    state: State<AppStateWrapper>,
) -> Result<GitInfo, AppError> {
    let mut manager = state.project_manager.lock().map_err(AppError::from)?;
    manager
        .refresh_git_info(&project_id)
        .map_err(AppError::from)?;
    manager
        .get_project(&project_id)
        .and_then(|p| p.git_info.clone())
        .ok_or_else(|| AppError::NotFound(format!("Project not found: {}", project_id)))
}

#[tauri::command]
pub fn set_active_project(project_id: String, state: State<AppStateWrapper>) {
    if let Ok(mut guard) = state.active_project_id.lock() {
        *guard = Some(project_id);
    }
}

#[tauri::command]
pub fn get_active_project(state: State<AppStateWrapper>) -> Option<String> {
    state.active_project_id.lock().ok().and_then(|g| g.clone())
}

#[tauri::command]
pub fn set_view_terminal(project_id: String, state: State<AppStateWrapper>) {
    if let Ok(mut pm) = state.project_manager.lock() {
        pm.set_view_terminal(&project_id);
    }
}

#[tauri::command]
pub fn set_view_diff(project_id: String, file_path: String, state: State<AppStateWrapper>) {
    if let Ok(mut pm) = state.project_manager.lock() {
        pm.set_view_diff(&project_id, PathBuf::from(file_path));
    }
}

#[tauri::command]
pub fn set_project_collapsed(project_id: String, collapsed: bool, state: State<AppStateWrapper>) {
    if let Ok(mut pm) = state.project_manager.lock() {
        pm.set_collapsed(&project_id, collapsed);
    }
    if let Ok(pm) = state.project_manager.lock() {
        let projects = pm.list_projects();
        let session = state
            .storage_manager
            .create_session_from_projects(&projects, None, None, None);
        if let Err(e) = state.storage_manager.save_session(&session) {
            log::error!(
                "Failed to save session after collapsing project {}: {}",
                project_id,
                e
            );
        }
    }
}

/// 设置 Local 项目的 avatar 颜色（None 表示清回 hash 默认）
/// 同时立即持久化到 sessions.json
#[tauri::command]
pub fn set_project_color(
    project_id: String,
    color: Option<String>,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    {
        let mut pm = state.project_manager.lock().map_err(AppError::from)?;
        pm.set_avatar_color(&project_id, color);
    }
    let projects = state
        .project_manager
        .lock()
        .map_err(AppError::from)?
        .list_projects();
    let session = state
        .storage_manager
        .create_session_from_projects(&projects, None, None, None);
    state
        .storage_manager
        .save_session(&session)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn rename_project(
    project_id: String,
    new_name: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let mut pm = state.project_manager.lock().map_err(AppError::from)?;
    pm.rename_project(&project_id, &new_name);
    let projects = pm.list_projects();
    drop(pm);
    let session = state
        .storage_manager
        .create_session_from_projects(&projects, None, None, None);
    state
        .storage_manager
        .save_session(&session)
        .map_err(|e| AppError::Storage(e.to_string()))
}

#[tauri::command]
pub fn change_project_path(
    project_id: String,
    new_path: String,
    state: State<AppStateWrapper>,
    app_handle: tauri::AppHandle,
) -> Result<(), AppError> {
    let mut pm = state.project_manager.lock().map_err(AppError::from)?;
    pm.change_path(&project_id, &new_path);
    pm.refresh_git_info(&project_id).map_err(AppError::from)?;
    let projects = pm.list_projects();
    drop(pm);

    state.watcher_manager.unwatch(&project_id);
    state
        .watcher_manager
        .watch(project_id, PathBuf::from(new_path), app_handle);

    let session = state
        .storage_manager
        .create_session_from_projects(&projects, None, None, None);
    state
        .storage_manager
        .save_session(&session)
        .map_err(|e| AppError::Storage(e.to_string()))
}

#[tauri::command]
pub fn reorder_projects(
    ordered_ids: Vec<String>,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let mut pm = state.project_manager.lock().map_err(AppError::from)?;
    pm.reorder_projects(&ordered_ids);

    // Persist the new order
    let projects = pm.list_projects();
    drop(pm);
    let session = state
        .storage_manager
        .create_session_from_projects(&projects, None, None, None);
    state
        .storage_manager
        .save_session(&session)
        .map_err(|e| AppError::Storage(e.to_string()))
}
