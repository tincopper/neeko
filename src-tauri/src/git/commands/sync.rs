use crate::common::git::operations;
use crate::common::git::transport::{GitRunHooks, GitSyncGuard};
use crate::common::git::types::PushOutcome;
use crate::common::git::RepoRef;
use crate::git::events;
use crate::AppError;
use crate::AppStateWrapper;
use tauri::{AppHandle, State};

/// 占用**仓库单元**（`RepoRef::key()`）的单飞槽并装配本次运行的 hooks。
///
/// 这是**唯一**装配点（此前 7 处命令各写一段同样的 `begin + GitRunHooks`）。
/// 互斥粒度 = 仓库单元：同一单元（同 HEAD/index/workdir）串行，主仓与各 linked
/// worktree 可并行 —— 与 `git-domain.md §12` 的身份模型一致（`git status` 的写入单位是
/// 仓库单元，不是 project，也不是全局进程）。同一单元已有操作在跑 ⇒
/// [`crate::common::git::transport::GitSyncSlots::begin`] 显式拒绝。
///
/// 返回的 [`GitSyncGuard`] 是 RAII 释放器：任何返回路径都会放开该单元。
pub(super) fn begin_git_run<'a>(
    state: &'a AppStateWrapper,
    repo: &RepoRef,
    app_handle: &AppHandle,
    console_run_id: Option<&str>,
) -> Result<(GitRunHooks, GitSyncGuard<'a>), AppError> {
    let (handle, guard) = state
        .git_sync
        .begin(repo.key(), console_run_id.map(str::to_string))?;
    let hooks = GitRunHooks {
        on_output: events::output_sink(app_handle, console_run_id),
        cancel: Some(handle),
    };
    Ok((hooks, guard))
}

/// Cancel the in-flight git sync operation(s) (push / fetch / pull / commit).
///
/// `console_run_id` 限定取消目标：只取消 `run_id` 匹配的运行（前端 tab 是仓库级的，
/// 槽是仓库单元级的；匹配把两个身份面钉在一起）；`None` = 取消全部（程序化调用/无
/// Console 上下文）。幂等：没有在跑的操作时 no-op。
#[tauri::command]
pub async fn cancel_git_sync(
    console_run_id: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    state.git_sync.cancel_matching(console_run_id.as_deref())?;
    Ok(())
}

/// Fetch from remote.
#[tauri::command]
pub async fn fetch(
    project_id: String,
    worktree_path: Option<String>,
    console_run_id: Option<String>,
    state: State<'_, AppStateWrapper>,
    app_handle: AppHandle,
) -> Result<PushOutcome, AppError> {
    let (t, repo) = state
        .resolve_repo(&project_id, worktree_path.as_deref())
        .await?;
    let repo_path = repo.work_dir();
    let (hooks, _slot) = begin_git_run(&state, &repo, &app_handle, console_run_id.as_deref())?;
    operations::fetch(&t, repo_path, hooks)
        .await
        .map_err(AppError::from)
}

/// Pull from remote.
#[tauri::command]
pub async fn pull(
    project_id: String,
    worktree_path: Option<String>,
    console_run_id: Option<String>,
    state: State<'_, AppStateWrapper>,
    app_handle: AppHandle,
) -> Result<PushOutcome, AppError> {
    let (t, repo) = state
        .resolve_repo(&project_id, worktree_path.as_deref())
        .await?;
    let repo_path = repo.work_dir();
    let (hooks, _slot) = begin_git_run(&state, &repo, &app_handle, console_run_id.as_deref())?;
    let outcome = operations::pull(&t, repo_path, hooks)
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
    console_run_id: Option<String>,
    state: State<'_, AppStateWrapper>,
    app_handle: AppHandle,
) -> Result<PushOutcome, AppError> {
    let (t, repo) = state
        .resolve_repo(&project_id, worktree_path.as_deref())
        .await?;
    let repo_path = repo.work_dir();
    let (hooks, _slot) = begin_git_run(&state, &repo, &app_handle, console_run_id.as_deref())?;
    operations::push(&t, repo_path, set_upstream.unwrap_or(false), hooks)
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
    console_run_id: Option<String>,
    state: State<'_, AppStateWrapper>,
    app_handle: AppHandle,
) -> Result<PushOutcome, AppError> {
    let (t, repo) = state
        .resolve_repo(&project_id, worktree_path.as_deref())
        .await?;
    let repo_path = repo.work_dir();
    let (hooks, _slot) = begin_git_run(&state, &repo, &app_handle, console_run_id.as_deref())?;
    operations::fetch_with_credentials(&t, repo_path, &username, &password, hooks)
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
    console_run_id: Option<String>,
    state: State<'_, AppStateWrapper>,
    app_handle: AppHandle,
) -> Result<PushOutcome, AppError> {
    let (t, repo) = state
        .resolve_repo(&project_id, worktree_path.as_deref())
        .await?;
    let repo_path = repo.work_dir();
    let (hooks, _slot) = begin_git_run(&state, &repo, &app_handle, console_run_id.as_deref())?;
    let outcome = operations::pull_with_credentials(&t, repo_path, &username, &password, hooks)
        .await
        .map_err(AppError::from)?;
    // pull 会改写工作树/HEAD ⇒ 被拉取的那个单元必须同步收口。
    crate::git::services::status::wait_status_fresh(&state, &repo).await;
    Ok(outcome)
}

/// Push to remote with authentication.
#[tauri::command]
#[allow(clippy::too_many_arguments)] // 参数构成 invoke 契约（分组会改变前端 payload 形状）
pub async fn push_with_credentials(
    project_id: String,
    set_upstream: Option<bool>,
    username: String,
    password: String,
    worktree_path: Option<String>,
    console_run_id: Option<String>,
    state: State<'_, AppStateWrapper>,
    app_handle: AppHandle,
) -> Result<PushOutcome, AppError> {
    let (t, repo) = state
        .resolve_repo(&project_id, worktree_path.as_deref())
        .await?;
    let repo_path = repo.work_dir();
    let (hooks, _slot) = begin_git_run(&state, &repo, &app_handle, console_run_id.as_deref())?;
    operations::push_with_credentials(
        &t,
        repo_path,
        set_upstream.unwrap_or(false),
        &username,
        &password,
        hooks,
    )
    .await
    .map_err(AppError::from)
}
