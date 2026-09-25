use crate::common::git::operations;
use crate::common::git::path_guard::{resolve_validated_work_dir, validate_repo_relative_paths};
use crate::common::git::status_worker::RECALC_WAIT_TIMEOUT;
use crate::common::runtime::run_blocking;
use crate::AppError;
use crate::AppStateWrapper;
use tauri::State;

/// 写操作成功后请求 status 重算并**等待落地**（有界），让随后的读接口拿到写后快照。
///
/// 不等待的后果：读接口（G2 D2，走 `snapshot()`）把写前快照当权威数据返回，覆盖
/// 真实结果 —— 即「操作成功但列表要手动刷新才更新」。等待是 Condvar 阻塞原语，
/// 经 `run_blocking` 隔离到阻塞线程池（红线 3）；超时 / 非 git 项目时放弃等待，
/// 由 `git-status-snapshot` 事件推送最终收敛。
async fn wait_status_fresh(state: &AppStateWrapper, project_id: &str) {
    let manager = state.watcher_manager.clone();
    let pid = project_id.to_string();
    // join 失败仅发生于运行时关停，等待结果超时与否都不影响命令成败：
    // 失败/超时场景由 git-status-snapshot 事件推送最终收敛。
    let _ =
        run_blocking(move || manager.poke_status_worker_and_wait(&pid, RECALC_WAIT_TIMEOUT)).await;
}

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
        .map_err(AppError::from)?;
    wait_status_fresh(&state, &project_id).await;
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
    let (t, wd) = state.resolve_project(&project_id)?;
    let repo_path = resolve_validated_work_dir(&t, &worktree_path, &wd)?;
    validate_repo_relative_paths(&t, repo_path, &file_paths)?;
    operations::unstage_files(&t, repo_path, &file_paths)
        .await
        .map_err(AppError::from)?;
    wait_status_fresh(&state, &project_id).await;
    Ok(())
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
        .map_err(AppError::from)?;
    wait_status_fresh(&state, &project_id).await;
    Ok(())
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
        .map_err(AppError::from)?;
    wait_status_fresh(&state, &project_id).await;
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
    let (t, wd) = state.resolve_project(&project_id)?;
    let repo_path = resolve_validated_work_dir(&t, &worktree_path, &wd)?;
    validate_repo_relative_paths(&t, repo_path, &file_paths)?;
    operations::discard_paths(&t, repo_path, &file_paths)
        .await
        .map_err(AppError::from)?;
    wait_status_fresh(&state, &project_id).await;
    Ok(())
}
