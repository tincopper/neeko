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
        .map_err(AppError::from)?;
    crate::git::services::status::wait_main_status_fresh(&state, &project_id).await;
    Ok(())
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
        .map_err(AppError::from)?;
    // 改的正是当前检出分支时，`.git/HEAD` 的目标 ref 变了 ⇒ 快照的 branch 字段跟着变。
    crate::git::services::status::wait_main_status_fresh(&state, &project_id).await;
    Ok(())
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
        .map_err(AppError::from)?;
    // 建并切 = HEAD 与工作树都变了，与 checkout_branch 同一收口契约（§10）。
    crate::git::services::status::wait_main_status_fresh(&state, &project_id).await;
    Ok(())
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
        .map_err(AppError::from)?;
    crate::git::services::status::wait_main_status_fresh(&state, &project_id).await;
    Ok(())
}
