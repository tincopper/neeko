use crate::state::*;
use crate::AppStateWrapper;
use std::path::PathBuf;
use tauri::State;

#[tauri::command]
pub fn add_project(
    path: String,
    agent_id: Option<String>,
    ide: Option<String>,
    state: State<AppStateWrapper>,
    app_handle: tauri::AppHandle,
) -> Result<Project, String> {
    let project = state
        .project_manager
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?
        .add_project(PathBuf::from(path), agent_id, ide)
        .map_err(|e| e.to_string())?;

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
            .create_session_from_projects(&projects, None, None, None, None);
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
pub fn get_project(project_id: String, state: State<AppStateWrapper>) -> Result<Project, String> {
    state
        .project_manager
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?
        .get_project(&project_id)
        .cloned()
        .ok_or_else(|| format!("Project not found: {}", project_id))
}

#[tauri::command]
pub fn refresh_git_info(project_id: String, state: State<AppStateWrapper>) -> Result<(), String> {
    state
        .project_manager
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?
        .refresh_git_info(&project_id)
        .map_err(|e| e.to_string())
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
            .create_session_from_projects(&projects, None, None, None, None);
        if let Err(e) = state.storage_manager.save_session(&session) {
            log::error!(
                "Failed to save session after collapsing project {}: {}",
                project_id,
                e
            );
        }
    }
}

#[tauri::command]
pub fn reorder_projects(ordered_ids: Vec<String>, state: State<AppStateWrapper>) -> Result<(), String> {
    let mut pm = state
        .project_manager
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;
    pm.reorder_projects(&ordered_ids);

    // Persist the new order
    let projects = pm.list_projects();
    drop(pm);
    let session = state
        .storage_manager
        .create_session_from_projects(&projects, None, None, None, None);
    state
        .storage_manager
        .save_session(&session)
        .map_err(|e| format!("Failed to save session: {}", e))
}
