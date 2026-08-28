#![allow(unused_imports, missing_docs)]

use crate::common::git::operations;
use crate::common::git::path_guard::{
    resolve_validated_work_dir, validate_repo_relative_path, validate_repo_relative_paths,
};
use crate::AppError;
use crate::AppStateWrapper;
use tauri::State;

/// Stage specific files in the repository.
#[tauri::command]
pub async fn stage_files(
    project_id: String,
    file_paths: Vec<String>,
    worktree_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let repo_path = resolve_validated_work_dir(&t, &worktree_path, &wd)?;
    validate_repo_relative_paths(&t, repo_path, &file_paths)?;
    operations::stage_files(&t, repo_path, &file_paths)
        .await
        .map_err(AppError::from)
}

/// Unstage specific files in the repository.
#[tauri::command]
pub async fn unstage_files(
    project_id: String,
    file_paths: Vec<String>,
    worktree_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let repo_path = resolve_validated_work_dir(&t, &worktree_path, &wd)?;
    validate_repo_relative_paths(&t, repo_path, &file_paths)?;
    operations::unstage_files(&t, repo_path, &file_paths)
        .await
        .map_err(AppError::from)
}

/// Stage all changes in the repository.
#[tauri::command]
pub async fn stage_all(
    project_id: String,
    worktree_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let repo_path = resolve_validated_work_dir(&t, &worktree_path, &wd)?;
    operations::stage_all(&t, repo_path)
        .await
        .map_err(AppError::from)
}

/// Unstage all changes in the repository.
#[tauri::command]
pub async fn unstage_all(
    project_id: String,
    worktree_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let repo_path = resolve_validated_work_dir(&t, &worktree_path, &wd)?;
    operations::unstage_all(&t, repo_path)
        .await
        .map_err(AppError::from)
}

/// Discard changes in a specific file.
#[tauri::command]
pub async fn discard_file(
    project_id: String,
    file_path: String,
    worktree_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let repo_path = resolve_validated_work_dir(&t, &worktree_path, &wd)?;
    validate_repo_relative_path(&t, repo_path, &file_path)?;
    operations::discard_file(&t, repo_path, &file_path)
        .await
        .map_err(AppError::from)
}

/// Discard all local changes.
#[tauri::command]
pub async fn discard_all(
    project_id: String,
    worktree_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let repo_path = resolve_validated_work_dir(&t, &worktree_path, &wd)?;
    operations::discard_all(&t, repo_path)
        .await
        .map_err(AppError::from)
}
