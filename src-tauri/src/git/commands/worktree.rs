use crate::common::executor::factory::ExecTarget;
use crate::common::git::operations;
use crate::common::git::path_guard::canonicalize_worktree_path;
use crate::AppError;
use crate::AppStateWrapper;
use tauri::State;

/// Create a Git worktree.
#[tauri::command]
pub async fn create_worktree(
    project_id: String,
    worktree_path: String,
    branch_name: String,
    new_branch: bool,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let worktree_path = canonicalize_worktree_path(&t, &worktree_path)?;
    // 父目录预创建仅对 Local 有意义（WSL/Remote 的路径由远端 shell 消费，
    // 本地 create_dir_all 反而会在错误位置创建目录）
    if matches!(t, ExecTarget::Local) {
        if let Some(parent) = std::path::Path::new(&worktree_path).parent() {
            let parent = parent.to_path_buf();
            tokio::task::spawn_blocking(move || std::fs::create_dir_all(&parent))
                .await
                .map_err(|e| AppError::Unknown(e.to_string()))?
                .map_err(AppError::from)?;
        }
    }
    operations::create_worktree(&t, &wd, &worktree_path, &branch_name, new_branch)
        .await
        .map_err(AppError::from)?;
    // 新工作树**若位于主仓工作树内**（常见约定 `.worktrees/<name>`），主仓的未跟踪条目会
    // 因此变化 ⇒ 必须戳主仓单元（R2.4：戳被写入的那个单元，不是"当前视图那个"）。
    crate::git::services::status::wait_main_status_fresh(&state, &project_id).await;
    Ok(())
}

/// Remove a Git worktree.
#[tauri::command]
pub async fn remove_worktree(
    project_id: String,
    worktree_path: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let worktree_path = canonicalize_worktree_path(&t, &worktree_path)?;
    // 单元身份必须在**删除之前**解析：目录一旦消失，`canonicalize_worktree_path` 只能退回
    // 词法归一，在符号链接根上（macOS `/var` ↔ `/private/var`）会算出与挂载时不同的 key，
    // 于是释放请求打在不存在的挂载上、真正的挂载继续泄漏。
    let unit = state.resolve_repo(&project_id, Some(&worktree_path))?.1;
    operations::remove_worktree(&t, &wd, &worktree_path)
        .await
        .map_err(AppError::from)?;
    crate::git::services::status::release_unit(&state, &unit).await;
    crate::git::services::status::wait_main_status_fresh(&state, &project_id).await;
    Ok(())
}

/// Rename a Git worktree.
#[tauri::command]
pub async fn rename_worktree(
    project_id: String,
    old_path: String,
    new_path: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let old_path = canonicalize_worktree_path(&t, &old_path)?;
    let new_path = canonicalize_worktree_path(&t, &new_path)?;
    // 同 remove：旧路径的身份要在改名前解析。改名后旧 key 指向的目录已不存在，
    // 继续持有 = 一份永不更新却仍可被渲染的快照。
    let old_unit = state.resolve_repo(&project_id, Some(&old_path))?.1;
    operations::rename_worktree(&t, &wd, &old_path, &new_path)
        .await
        .map_err(AppError::from)?;
    crate::git::services::status::release_unit(&state, &old_unit).await;
    crate::git::services::status::wait_main_status_fresh(&state, &project_id).await;
    Ok(())
}

/// Check if a worktree has uncommitted changes.
#[tauri::command]
pub async fn is_worktree_dirty(
    project_id: String,
    worktree_path: String,
    state: State<'_, AppStateWrapper>,
) -> Result<bool, AppError> {
    let (t, _wd) = state.resolve_project(&project_id)?;
    let worktree_path = canonicalize_worktree_path(&t, &worktree_path)?;
    operations::is_worktree_dirty(&t, &worktree_path)
        .await
        .map_err(AppError::from)
}
