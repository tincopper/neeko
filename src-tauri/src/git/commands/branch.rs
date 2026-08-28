#![allow(unused_imports, missing_docs)]

use crate::common::git::operations;
use crate::AppError;
use crate::AppStateWrapper;
use tauri::State;

/// Checkout a branch.
#[tauri::command]
pub async fn checkout_branch(
    project_id: String,
    branch_name: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::checkout_branch(&t, &wd, &branch_name)
        .await
        .map_err(AppError::from)
}

/// Create a new branch.
#[tauri::command]
pub async fn create_branch(
    project_id: String,
    branch_name: String,
    start_point: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::create_branch(&t, &wd, &branch_name, start_point.as_deref())
        .await
        .map_err(AppError::from)
}

/// Delete a branch.
#[tauri::command]
pub async fn delete_branch(
    project_id: String,
    branch_name: String,
    force: Option<bool>,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::delete_branch(&t, &wd, &branch_name, force.unwrap_or(false))
        .await
        .map_err(AppError::from)
}

/// Rename a branch.
#[tauri::command]
pub async fn rename_branch(
    project_id: String,
    old_name: String,
    new_name: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::rename_branch(&t, &wd, &old_name, &new_name)
        .await
        .map_err(AppError::from)
}

/// Create and switch to a new branch.
#[tauri::command]
pub async fn create_and_switch_branch(
    project_id: String,
    branch_name: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::create_and_switch_branch(&t, &wd, &branch_name)
        .await
        .map_err(AppError::from)
}

/// Checkout a commit in detached HEAD state.
#[tauri::command]
pub async fn checkout_detached(
    project_id: String,
    commit_hash: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::checkout_detached(&t, &wd, &commit_hash)
        .await
        .map_err(AppError::from)
}
