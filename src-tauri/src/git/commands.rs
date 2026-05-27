use crate::project::types::{PRInfo, PRListItem, PRMergeResult};
use crate::AppError;
use crate::AppStateWrapper;
use tauri::State;

// ─── PR Commands ────────────────────────────────────────────────────────

#[tauri::command]
pub fn is_gh_installed_command() -> bool {
    crate::git::is_gh_installed()
}

#[tauri::command]
pub fn list_prs_command(
    project_id: String,
    state: String,
    limit: usize,
    state_w: State<AppStateWrapper>,
) -> Result<Vec<PRListItem>, AppError> {
    let manager = state_w.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::list_prs(&project.path, &state, limit).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn view_pr_command(
    project_id: String,
    pr_number: u64,
    state: State<AppStateWrapper>,
) -> Result<PRInfo, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::view_pr(&project.path, pr_number).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn create_pr_command(
    project_id: String,
    title: String,
    body: String,
    base: Option<String>,
    draft: bool,
    state: State<AppStateWrapper>,
) -> Result<u64, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::create_pr(&project.path, &title, &body, base.as_deref(), draft)
            .map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn merge_pr_command(
    project_id: String,
    pr_number: u64,
    method: String,
    state: State<AppStateWrapper>,
) -> Result<PRMergeResult, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::merge_pr(&project.path, pr_number, &method).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn close_pr_command(
    project_id: String,
    pr_number: u64,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::close_pr(&project.path, pr_number).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn checkout_pr_command(
    project_id: String,
    pr_number: u64,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::checkout_pr(&project.path, pr_number).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn remote_web_url_command(
    project_id: String,
    state: State<AppStateWrapper>,
) -> Result<String, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::remote_web_url(&project.path).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}
