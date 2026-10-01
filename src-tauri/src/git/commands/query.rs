use crate::common::git::operations;
use crate::common::git::path_guard::validate_repo_relative_path;
use crate::common::git::status_worker::GitStatusSnapshot;
use crate::common::git::transport::GitTransport;
use crate::common::git::types::DiffResult;
use crate::project::types::{FileDiffStats, GitBranchInfo, GitInfo};
use crate::AppError;
use crate::AppStateWrapper;
use tauri::State;

/// Get repository information（per-project 部分：分支 / 工作树清单 / provider）。
///
/// **未提交变更不在此处** —— 它是「每个工作树」的事实（HEAD / index / workdir 三者独立），
/// 走 [`get_repo_status`]。把它塞进 per-project 结构正是 worktree 视图串主仓内容的结构成因。
#[tauri::command]
pub async fn get_git_info(
    project_id: String,
    worktree_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<GitInfo, AppError> {
    let (t, repo) = state.resolve_repo(&project_id, worktree_path.as_deref())?;
    operations::get_git_info(&t, repo.work_dir())
        .await
        .map_err(AppError::from)
}

/// Get branch information.
#[tauri::command]
pub async fn get_git_branch_info(
    project_id: String,
    worktree_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<GitBranchInfo, AppError> {
    let (t, repo) = state.resolve_repo(&project_id, worktree_path.as_deref())?;
    operations::get_git_branch_info(&t, repo.work_dir())
        .await
        .map_err(AppError::from)
}

/// 读取某**仓库单元**的权威 status（主仓与 worktree 同一条读路径、同一种载荷）。
///
/// 取代旧的 `get_worktree_changed_files` + `ChangedFilesPayload{version: 0}`：那张「无版本
/// 语义」的口子使 version gate 只能恒放行，push 快照与 pull 结果在同一槽里后到者胜
/// —— worktree 视图串主仓内容的直接成因。
#[tauri::command]
pub async fn get_repo_status(
    project_id: String,
    worktree_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<GitStatusSnapshot, AppError> {
    let (_t, repo) = state.resolve_repo(&project_id, worktree_path.as_deref())?;
    crate::git::services::status::read_unit_status(&state, &repo).await
}

/// 激活一个仓库单元（决策 D-B：只挂当前视图所在的那个单元）。
///
/// 释放该项目下其它单元 → 挂载本单元 → 有界等待首个快照。「当前视图」在前端只有一个
/// 派生函数，它是本命令的唯一调用方；编排逻辑见 `git::services::status::activate`。
#[tauri::command]
pub async fn set_active_repo_unit(
    project_id: String,
    worktree_path: Option<String>,
    app: tauri::AppHandle,
    state: State<'_, AppStateWrapper>,
) -> Result<GitStatusSnapshot, AppError> {
    let (_t, repo) = state.resolve_repo(&project_id, worktree_path.as_deref())?;
    crate::git::services::status::activate(&state, &app, &repo).await
}

/// 把调用方持有的 worktree 路径归一成后端使用的 canonical 形态。
///
/// 前端不自己做路径归一（红线 12：路径身份只有一个判定处），而 session 里存的可能是
/// canonical 保证落地之前写下的形态（macOS `/tmp` ↔ `/private/tmp`）。恢复激活态必须先
/// 换成与 `git worktree list` 同一形态，否则「该单元是否还存在」的校验必然认不出来 ——
/// 实测表现为：重启后恢复的 worktree 被立刻判没、回落主仓。
///
/// 返回的是**身份渲染**（平台无关字母表，见 `common/git/unit_path.rs`）—— 它就是前端
/// 用来拼 `RepoKey` 的那个分量；宿主可执行形态（`exec`）绝不外泄给前端。
#[tauri::command]
pub async fn canonical_worktree_path(
    project_id: String,
    path: String,
    state: State<'_, AppStateWrapper>,
) -> Result<String, AppError> {
    let (target, _) = state.resolve_project(&project_id)?;
    crate::common::git::unit_path::UnitPath::resolve(&target, &path)
        .map(|resolved| resolved.identity().to_string())
        .map_err(AppError::from)
}

/// List untracked files under a directory (expands a collapsed untracked-dir
/// entry shown in the changes list). Returns an error when the path is not a
/// git repository; the UI expand handler catches it.
#[tauri::command]
pub async fn get_untracked_files(
    project_id: String,
    worktree_path: Option<String>,
    dir_path: String,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<String>, AppError> {
    let (t, repo) = state.resolve_repo(&project_id, worktree_path.as_deref())?;
    validate_repo_relative_path(&t, repo.work_dir(), &dir_path).map_err(AppError::from)?;
    operations::get_untracked_files(&t, repo.work_dir(), &dir_path)
        .await
        .map_err(AppError::from)
}

/// Get diff statistics for changed files.
#[tauri::command]
pub async fn get_changed_files_diff_stats(
    project_id: String,
    worktree_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<FileDiffStats>, AppError> {
    let (t, repo) = state.resolve_repo(&project_id, worktree_path.as_deref())?;
    operations::get_changed_files_diff_stats(&t, repo.work_dir())
        .await
        .map_err(AppError::from)
}

/// Get the diff for a specific file.
#[tauri::command]
pub async fn get_file_diff(
    project_id: String,
    file_path: String,
    worktree_path: Option<String>,
    collapse: Option<bool>,
    state: State<'_, AppStateWrapper>,
) -> Result<DiffResult, AppError> {
    let t0 = std::time::Instant::now();
    let (t, repo) = state.resolve_repo(&project_id, worktree_path.as_deref())?;
    validate_repo_relative_path(&t, repo.work_dir(), &file_path)?;
    let collapse = collapse.unwrap_or(true);
    let result = operations::get_file_diff(&t, repo.work_dir(), &file_path, collapse)
        .await
        .map_err(AppError::from);
    let elapsed_ms = t0.elapsed().as_millis();
    log::debug!("[perf] Rust get_file_diff: {} {}ms", file_path, elapsed_ms);
    result
}

/// Check if the project is a Git repository.
#[tauri::command]
pub async fn is_git_repo(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<bool, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    Ok(t.is_git_repo(&wd).await)
}
