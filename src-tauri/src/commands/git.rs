use crate::state::*;
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
) -> Result<(), String> {
    let manager = state
        .project_manager
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::create_worktree(
            &project.path,
            &PathBuf::from(&worktree_path),
            &branch_name,
            new_branch,
        )
        .map_err(|e| e.to_string())
    } else {
        Err(format!("Project not found: {}", project_id))
    }
}

#[tauri::command]
pub fn remove_worktree(
    project_id: String,
    worktree_path: String,
    state: State<AppStateWrapper>,
) -> Result<(), String> {
    let manager = state
        .project_manager
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::remove_worktree(&project.path, &PathBuf::from(&worktree_path))
            .map_err(|e| e.to_string())
    } else {
        Err(format!("Project not found: {}", project_id))
    }
}

#[tauri::command]
pub fn is_worktree_dirty(
    project_id: String,
    worktree_path: String,
    state: State<AppStateWrapper>,
) -> Result<bool, String> {
    let manager = state
        .project_manager
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::is_worktree_dirty(&project.path, &PathBuf::from(&worktree_path))
            .map_err(|e| e.to_string())
    } else {
        Err(format!("Project not found: {}", project_id))
    }
}

#[tauri::command]
pub fn delete_branch(
    project_id: String,
    branch_name: String,
    state: State<AppStateWrapper>,
) -> Result<(), String> {
    let manager = state
        .project_manager
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::delete_branch(&project.path, &branch_name, true).map_err(|e| e.to_string())
    } else {
        Err(format!("Project not found: {}", project_id))
    }
}

#[tauri::command]
pub fn checkout_branch(
    project_id: String,
    branch_name: String,
    state: State<AppStateWrapper>,
) -> Result<(), String> {
    let manager = state
        .project_manager
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::checkout_branch(&project.path, &branch_name).map_err(|e| e.to_string())
    } else {
        Err(format!("Project not found: {}", project_id))
    }
}

#[tauri::command]
pub fn create_branch(
    project_id: String,
    branch_name: String,
    state: State<AppStateWrapper>,
) -> Result<(), String> {
    let manager = state
        .project_manager
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::create_branch(&project.path, &branch_name, None).map_err(|e| e.to_string())
    } else {
        Err(format!("Project not found: {}", project_id))
    }
}

#[tauri::command]
pub fn rename_branch(
    project_id: String,
    old_name: String,
    new_name: String,
    state: State<AppStateWrapper>,
) -> Result<(), String> {
    let manager = state
        .project_manager
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::rename_branch(&project.path, &old_name, &new_name).map_err(|e| e.to_string())
    } else {
        Err(format!("Project not found: {}", project_id))
    }
}

#[tauri::command]
pub fn rename_worktree(
    project_id: String,
    worktree_path: String,
    new_name: String,
    state: State<AppStateWrapper>,
) -> Result<String, String> {
    let manager = state
        .project_manager
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::rename_worktree(&project.path, &PathBuf::from(&worktree_path), &new_name)
            .map_err(|e| e.to_string())
    } else {
        Err(format!("Project not found: {}", project_id))
    }
}

#[tauri::command]
pub fn get_file_diff_command(
    project_id: String,
    file_path: String,
    state: State<AppStateWrapper>,
) -> Result<DiffResult, String> {
    let manager = state
        .project_manager
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::get_file_diff(&project.path, &file_path).map_err(|e| e.to_string())
    } else {
        Err(format!("Project not found: {}", project_id))
    }
}

#[tauri::command]
pub fn get_worktree_changed_files(
    project_id: String,
    worktree_path: String,
    state: State<AppStateWrapper>,
) -> Result<Vec<FileChange>, String> {
    let manager = state
        .project_manager
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;
    if manager.get_project(&project_id).is_some() {
        crate::git::get_changed_files_for_path(&PathBuf::from(&worktree_path))
            .map_err(|e| e.to_string())
    } else {
        Err(format!("Project not found: {}", project_id))
    }
}

#[tauri::command]
pub fn get_worktree_file_diff(
    project_id: String,
    worktree_path: String,
    file_path: String,
    state: State<AppStateWrapper>,
) -> Result<DiffResult, String> {
    let manager = state
        .project_manager
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;
    if manager.get_project(&project_id).is_some() {
        crate::git::get_file_diff_for_path(&PathBuf::from(&worktree_path), &file_path)
            .map_err(|e| e.to_string())
    } else {
        Err(format!("Project not found: {}", project_id))
    }
}

#[tauri::command]
pub fn get_commit_log(
    project_id: String,
    offset: usize,
    limit: usize,
    state: State<AppStateWrapper>,
) -> Result<Vec<CommitInfo>, String> {
    let manager = state
        .project_manager
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::get_commit_log(&project.path, offset, limit).map_err(|e| e.to_string())
    } else {
        Err(format!("Project not found: {}", project_id))
    }
}

#[tauri::command]
pub fn get_commit_detail(
    project_id: String,
    commit_hash: String,
    state: State<AppStateWrapper>,
) -> Result<CommitDetail, String> {
    let manager = state
        .project_manager
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::get_commit_detail(&project.path, &commit_hash).map_err(|e| e.to_string())
    } else {
        Err(format!("Project not found: {}", project_id))
    }
}

#[tauri::command]
pub fn get_all_branches(
    project_id: String,
    state: State<AppStateWrapper>,
) -> Result<BranchGroup, String> {
    let manager = state
        .project_manager
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::get_all_branches(&project.path).map_err(|e| e.to_string())
    } else {
        Err(format!("Project not found: {}", project_id))
    }
}

#[tauri::command]
pub fn create_commit(
    project_id: String,
    message: String,
    amend: bool,
    files: Vec<String>,
    state: State<AppStateWrapper>,
) -> Result<String, String> {
    let manager = state
        .project_manager
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::create_commit(&project.path, &message, amend, &files)
            .map_err(|e| e.to_string())
    } else {
        Err(format!("Project not found: {}", project_id))
    }
}

#[tauri::command]
pub fn push_remote(
    project_id: String,
    state: State<AppStateWrapper>,
) -> Result<(), String> {
    let manager = state
        .project_manager
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::push_remote(&project.path).map_err(|e| e.to_string())
    } else {
        Err(format!("Project not found: {}", project_id))
    }
}

#[tauri::command]
pub fn get_unversioned_files(
    project_id: String,
    state: State<AppStateWrapper>,
) -> Result<Vec<FileChange>, String> {
    let manager = state
        .project_manager
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::get_unversioned_files(&project.path).map_err(|e| e.to_string())
    } else {
        Err(format!("Project not found: {}", project_id))
    }
}

#[tauri::command]
pub fn get_commit_file_diff(
    project_id: String,
    commit_hash: String,
    file_path: String,
    state: State<AppStateWrapper>,
) -> Result<DiffResult, String> {
    let manager = state
        .project_manager
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::get_commit_file_diff(&project.path, &commit_hash, &file_path)
            .map_err(|e| e.to_string())
    } else {
        Err(format!("Project not found: {}", project_id))
    }
}
