#![allow(unused_imports, missing_docs)]

use crate::common::git::operations;
use crate::common::git::path_guard::{resolve_validated_work_dir, validate_repo_relative_path};
use crate::common::git::types::DiffResult;
use crate::project::types::{
    AheadBehind, CommitDetail, CommitEntry, CommitFileChange, StashActionResult, StashEntry,
};
use crate::AppError;
use crate::AppStateWrapper;
use tauri::State;

/// Get the commit log.
#[tauri::command]
pub async fn get_commit_log(
    project_id: String,
    count: usize,
    skip: Option<usize>,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<CommitEntry>, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::get_commit_log(&t, &wd, count, skip.unwrap_or(0))
        .await
        .map_err(AppError::from)
}

/// Get details for a specific commit.
#[tauri::command]
pub async fn get_commit_detail(
    project_id: String,
    commit_hash: String,
    state: State<'_, AppStateWrapper>,
) -> Result<CommitDetail, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::get_commit_detail(&t, &wd, &commit_hash)
        .await
        .map_err(AppError::from)
}

/// Get files changed in a commit.
#[tauri::command]
pub async fn get_commit_files(
    project_id: String,
    commit_hash: String,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<CommitFileChange>, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::get_commit_files(&t, &wd, &commit_hash)
        .await
        .map_err(AppError::from)
}

/// List stash entries.
#[tauri::command]
pub async fn get_stash_list(
    project_id: String,
    worktree_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<StashEntry>, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let repo_path = resolve_validated_work_dir(&t, &worktree_path, &wd)?;
    operations::get_stash_list(&t, repo_path)
        .await
        .map_err(AppError::from)
}

/// Get files changed in a stash entry.
#[tauri::command]
pub async fn get_stash_files(
    project_id: String,
    selector: String,
    worktree_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<CommitFileChange>, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let repo_path = resolve_validated_work_dir(&t, &worktree_path, &wd)?;
    operations::get_stash_files(&t, repo_path, &selector)
        .await
        .map_err(AppError::from)
}

/// Get the diff for a single file in a stash entry.
#[tauri::command]
pub async fn get_stash_file_diff(
    project_id: String,
    selector: String,
    file_path: String,
    collapse: Option<bool>,
    worktree_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<DiffResult, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let repo_path = resolve_validated_work_dir(&t, &worktree_path, &wd)?;
    operations::get_stash_file_diff(
        &t,
        repo_path,
        &selector,
        &file_path,
        collapse.unwrap_or(true),
    )
    .await
    .map_err(AppError::from)
}

/// Apply a stash entry to the working tree.
#[tauri::command]
pub async fn stash_apply(
    project_id: String,
    selector: String,
    worktree_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<StashActionResult, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let repo_path = resolve_validated_work_dir(&t, &worktree_path, &wd)?;
    operations::stash_apply(&t, repo_path, &selector)
        .await
        .map_err(AppError::from)
}

/// Pop (apply + drop) a stash entry.
#[tauri::command]
pub async fn stash_pop(
    project_id: String,
    selector: String,
    worktree_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<StashActionResult, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let repo_path = resolve_validated_work_dir(&t, &worktree_path, &wd)?;
    operations::stash_pop(&t, repo_path, &selector)
        .await
        .map_err(AppError::from)
}

/// Get the diff for a file in a commit.
#[tauri::command]
pub async fn get_commit_file_diff(
    project_id: String,
    commit_hash: String,
    file_path: String,
    collapse: Option<bool>,
    state: State<'_, AppStateWrapper>,
) -> Result<DiffResult, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    validate_repo_relative_path(&t, &wd, &file_path)?;
    operations::get_commit_file_diff(&t, &wd, &commit_hash, &file_path, collapse.unwrap_or(true))
        .await
        .map_err(AppError::from)
}

/// Get ahead/behind counts for the current branch.
#[tauri::command]
pub async fn get_ahead_behind(
    project_id: String,
    worktree_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<AheadBehind, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let repo_path = resolve_validated_work_dir(&t, &worktree_path, &wd)?;
    operations::get_ahead_behind(&t, repo_path)
        .await
        .map_err(AppError::from)
}

/// Get the default branch name.
#[tauri::command]
pub async fn default_branch(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<String, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::default_branch(&t, &wd)
        .await
        .map_err(AppError::from)
}
