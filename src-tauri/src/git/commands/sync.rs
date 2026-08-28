#![allow(unused_imports, missing_docs)]

use crate::common::git::operations;
use crate::common::git::path_guard::resolve_validated_work_dir;
use crate::common::git::types::PushOutcome;
use crate::AppError;
use crate::AppStateWrapper;
use tauri::State;

/// Fetch from remote.
#[tauri::command]
pub async fn fetch(
    project_id: String,
    worktree_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<PushOutcome, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let repo_path = resolve_validated_work_dir(&t, &worktree_path, &wd)?;
    operations::fetch(&t, repo_path)
        .await
        .map_err(AppError::from)
}

/// Pull from remote.
#[tauri::command]
pub async fn pull(
    project_id: String,
    worktree_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<PushOutcome, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let repo_path = resolve_validated_work_dir(&t, &worktree_path, &wd)?;
    operations::pull(&t, repo_path)
        .await
        .map_err(AppError::from)
}

/// Push to remote.
#[tauri::command]
pub async fn push(
    project_id: String,
    set_upstream: Option<bool>,
    worktree_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<PushOutcome, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let repo_path = resolve_validated_work_dir(&t, &worktree_path, &wd)?;
    operations::push(&t, repo_path, set_upstream.unwrap_or(false))
        .await
        .map_err(AppError::from)
}

/// Fetch from remote with authentication.
#[tauri::command]
pub async fn fetch_with_credentials(
    project_id: String,
    username: String,
    password: String,
    worktree_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<PushOutcome, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let repo_path = resolve_validated_work_dir(&t, &worktree_path, &wd)?;
    operations::fetch_with_credentials(&t, repo_path, &username, &password)
        .await
        .map_err(AppError::from)
}

/// Pull from remote with authentication.
#[tauri::command]
pub async fn pull_with_credentials(
    project_id: String,
    username: String,
    password: String,
    worktree_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<PushOutcome, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let repo_path = resolve_validated_work_dir(&t, &worktree_path, &wd)?;
    operations::pull_with_credentials(&t, repo_path, &username, &password)
        .await
        .map_err(AppError::from)
}

/// Push to remote with authentication.
#[tauri::command]
pub async fn push_with_credentials(
    project_id: String,
    set_upstream: Option<bool>,
    username: String,
    password: String,
    worktree_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<PushOutcome, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let repo_path = resolve_validated_work_dir(&t, &worktree_path, &wd)?;
    operations::push_with_credentials(
        &t,
        repo_path,
        set_upstream.unwrap_or(false),
        &username,
        &password,
    )
    .await
    .map_err(AppError::from)
}
