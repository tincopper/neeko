#![allow(unused_imports, missing_docs)]

use crate::common::git::operations;
use crate::common::git::path_guard::{resolve_validated_work_dir, validate_repo_relative_paths};
use crate::project::types::CommitResult;
use crate::AppError;
use crate::AppStateWrapper;
use tauri::State;

/// Commit specific files with a message.
#[tauri::command]
pub async fn commit_files(
    project_id: String,
    file_paths: Vec<String>,
    message: String,
    worktree_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<CommitResult, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let repo_path = resolve_validated_work_dir(&t, &worktree_path, &wd)?;
    validate_repo_relative_paths(&t, repo_path, &file_paths)?;
    operations::commit_files(&t, repo_path, &file_paths, &message)
        .await
        .map_err(AppError::from)
}

/// Cherry-pick a commit.
#[tauri::command]
pub async fn cherry_pick(
    project_id: String,
    commit_hash: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::cherry_pick(&t, &wd, &commit_hash)
        .await
        .map_err(AppError::from)
}

/// Revert a commit.
#[tauri::command]
pub async fn revert(
    project_id: String,
    commit_hash: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::revert(&t, &wd, &commit_hash)
        .await
        .map_err(AppError::from)
}

/// Create a Git tag.
#[tauri::command]
pub async fn create_tag(
    project_id: String,
    name: String,
    message: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::create_tag(&t, &wd, &name, &message)
        .await
        .map_err(AppError::from)
}
