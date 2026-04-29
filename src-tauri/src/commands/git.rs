use crate::models::*;
use crate::AppError;
use crate::AppStateWrapper;
use std::path::PathBuf;
use tauri::State;

#[tauri::command]
pub fn create_worktree(
    project_id: String,
    worktree_path: String,
    branch_name: String,
    new_branch: bool,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        let wt = PathBuf::from(&worktree_path);
        if let Some(parent) = wt.parent() {
            std::fs::create_dir_all(parent).map_err(AppError::from)?;
        }
        crate::git::create_worktree(&project.path, &wt, &branch_name, new_branch)
            .map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn remove_worktree(
    project_id: String,
    worktree_path: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::remove_worktree(&project.path, &PathBuf::from(&worktree_path))
            .map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn is_worktree_dirty(
    project_id: String,
    worktree_path: String,
    state: State<AppStateWrapper>,
) -> Result<bool, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::is_worktree_dirty(&project.path, &PathBuf::from(&worktree_path))
            .map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn delete_branch(
    project_id: String,
    branch_name: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::delete_branch(&project.path, &branch_name, true).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn checkout_branch(
    project_id: String,
    branch_name: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::checkout_branch(&project.path, &branch_name).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn create_branch(
    project_id: String,
    branch_name: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::create_branch(&project.path, &branch_name, None).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn rename_branch(
    project_id: String,
    old_name: String,
    new_name: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::rename_branch(&project.path, &old_name, &new_name).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn rename_worktree(
    project_id: String,
    worktree_path: String,
    new_name: String,
    state: State<AppStateWrapper>,
) -> Result<String, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::rename_worktree(&project.path, &PathBuf::from(&worktree_path), &new_name)
            .map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn get_file_diff_command(
    project_id: String,
    file_path: String,
    state: State<AppStateWrapper>,
) -> Result<DiffResult, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::get_file_diff(&project.path, &file_path).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn get_worktree_changed_files(
    project_id: String,
    worktree_path: String,
    state: State<AppStateWrapper>,
) -> Result<Vec<FileChange>, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if manager.get_project(&project_id).is_some() {
        crate::git::get_changed_files_for_path(&PathBuf::from(&worktree_path))
            .map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn get_worktree_file_diff(
    project_id: String,
    worktree_path: String,
    file_path: String,
    state: State<AppStateWrapper>,
) -> Result<DiffResult, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if manager.get_project(&project_id).is_some() {
        crate::git::get_file_diff_for_path(&PathBuf::from(&worktree_path), &file_path)
            .map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}
