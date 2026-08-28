#![allow(unused_imports, missing_docs)]

use crate::common::executor::factory::ExecTarget;
use crate::common::git::operations;
use crate::common::git::path_guard::validate_worktree_path;
use crate::AppError;
use crate::AppStateWrapper;
use tauri::State;

/// Create a Git worktree.
#[tauri::command]
pub async fn create_worktree(
    project_id: String,
    worktree_path: String,
    branch_name: String,
    new_branch: bool,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    validate_worktree_path(&t, &worktree_path)?;
    // 父目录预创建仅对 Local 有意义（WSL/Remote 的路径由远端 shell 消费，
    // 本地 create_dir_all 反而会在错误位置创建目录）
    if matches!(t, ExecTarget::Local) {
        if let Some(parent) = std::path::Path::new(&worktree_path).parent() {
            let parent = parent.to_path_buf();
            tokio::task::spawn_blocking(move || std::fs::create_dir_all(&parent))
                .await
                .map_err(|e| AppError::Unknown(e.to_string()))?
                .map_err(AppError::from)?;
        }
    }
    operations::create_worktree(&t, &wd, &worktree_path, &branch_name, new_branch)
        .await
        .map_err(AppError::from)
}

/// Remove a Git worktree.
#[tauri::command]
pub async fn remove_worktree(
    project_id: String,
    worktree_path: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    validate_worktree_path(&t, &worktree_path)?;
    operations::remove_worktree(&t, &wd, &worktree_path)
        .await
        .map_err(AppError::from)
}

/// Rename a Git worktree.
#[tauri::command]
pub async fn rename_worktree(
    project_id: String,
    old_path: String,
    new_path: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    validate_worktree_path(&t, &old_path)?;
    validate_worktree_path(&t, &new_path)?;
    operations::rename_worktree(&t, &wd, &old_path, &new_path)
        .await
        .map_err(AppError::from)
}

/// Check if a worktree has uncommitted changes.
#[tauri::command]
pub async fn is_worktree_dirty(
    project_id: String,
    worktree_path: String,
    state: State<'_, AppStateWrapper>,
) -> Result<bool, AppError> {
    let (t, _wd) = state.resolve_project(&project_id)?;
    validate_worktree_path(&t, &worktree_path)?;
    operations::is_worktree_dirty(&t, &worktree_path)
        .await
        .map_err(AppError::from)
}
