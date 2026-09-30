use crate::common::git::operations;
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
    let (t, repo) = state.resolve_repo(&project_id, worktree_path.as_deref())?;
    let repo_path = repo.work_dir();
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
    let (t, repo) = state.resolve_repo(&project_id, worktree_path.as_deref())?;
    let repo_path = repo.work_dir();
    let outcome = operations::pull(&t, repo_path)
        .await
        .map_err(AppError::from)?;
    // pull 会改写工作树/HEAD ⇒ 被拉取的那个单元必须同步收口。
    crate::git::services::status::wait_status_fresh(&state, &repo).await;
    Ok(outcome)
}

/// Push to remote.
#[tauri::command]
pub async fn push(
    project_id: String,
    set_upstream: Option<bool>,
    worktree_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<PushOutcome, AppError> {
    let (t, repo) = state.resolve_repo(&project_id, worktree_path.as_deref())?;
    let repo_path = repo.work_dir();
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
    let (t, repo) = state.resolve_repo(&project_id, worktree_path.as_deref())?;
    let repo_path = repo.work_dir();
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
    let (t, repo) = state.resolve_repo(&project_id, worktree_path.as_deref())?;
    let repo_path = repo.work_dir();
    let outcome = operations::pull_with_credentials(&t, repo_path, &username, &password)
        .await
        .map_err(AppError::from)?;
    // pull 会改写工作树/HEAD ⇒ 被拉取的那个单元必须同步收口。
    crate::git::services::status::wait_status_fresh(&state, &repo).await;
    Ok(outcome)
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
    let (t, repo) = state.resolve_repo(&project_id, worktree_path.as_deref())?;
    let repo_path = repo.work_dir();
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
