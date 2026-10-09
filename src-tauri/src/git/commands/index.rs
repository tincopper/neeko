use crate::common::git::operations;
use crate::common::git::path_guard::validate_repo_relative_paths;
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
    let (t, repo) = state
        .resolve_workspace(&project_id, worktree_path.as_deref())
        .await?;
    let repo_path = repo.root();
    validate_repo_relative_paths(&t, repo_path, &file_paths)?;
    operations::stage_files(&t, repo_path, &file_paths)
        .await
        .map_err(AppError::from)?;
    crate::git::services::status::wait_status_fresh(&state, &repo).await;
    Ok(())
}

/// Unstage specific files in the repository.
#[tauri::command]
pub async fn unstage_files(
    project_id: String,
    file_paths: Vec<String>,
    worktree_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, repo) = state
        .resolve_workspace(&project_id, worktree_path.as_deref())
        .await?;
    let repo_path = repo.root();
    validate_repo_relative_paths(&t, repo_path, &file_paths)?;
    operations::unstage_files(&t, repo_path, &file_paths)
        .await
        .map_err(AppError::from)?;
    crate::git::services::status::wait_status_fresh(&state, &repo).await;
    Ok(())
}

/// Stage all changes in the repository.
#[tauri::command]
pub async fn stage_all(
    project_id: String,
    worktree_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, repo) = state
        .resolve_workspace(&project_id, worktree_path.as_deref())
        .await?;
    let repo_path = repo.root();
    operations::stage_all(&t, repo_path)
        .await
        .map_err(AppError::from)?;
    crate::git::services::status::wait_status_fresh(&state, &repo).await;
    Ok(())
}

/// Unstage all changes in the repository.
#[tauri::command]
pub async fn unstage_all(
    project_id: String,
    worktree_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, repo) = state
        .resolve_workspace(&project_id, worktree_path.as_deref())
        .await?;
    let repo_path = repo.root();
    operations::unstage_all(&t, repo_path)
        .await
        .map_err(AppError::from)?;
    crate::git::services::status::wait_status_fresh(&state, &repo).await;
    Ok(())
}

/// Discard changes in the given files.
///
/// discard 的唯一 IPC 入口：路径集合由调用方决定（单行 / 选中 / 整组），
/// 每条路径用 clean（未跟踪）还是 reset+checkout（已跟踪）由仓库状态决定。
#[tauri::command]
pub async fn discard_files(
    project_id: String,
    file_paths: Vec<String>,
    worktree_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, repo) = state
        .resolve_workspace(&project_id, worktree_path.as_deref())
        .await?;
    let repo_path = repo.root();
    validate_repo_relative_paths(&t, repo_path, &file_paths)?;
    operations::discard_paths(&t, repo_path, &file_paths)
        .await
        .map_err(AppError::from)?;
    crate::git::services::status::wait_status_fresh(&state, &repo).await;
    Ok(())
}
