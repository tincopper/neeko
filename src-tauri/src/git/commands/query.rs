use crate::common::git::operations;
use crate::common::git::path_guard::validate_repo_relative_path;
use crate::common::git::status_worker::GitStatusSnapshot;
use crate::common::git::transport::GitTransport;
use crate::common::git::types::DiffResult;
use crate::common::git::WorkspaceSession;
use crate::project::types::{FileDiffStats, GitBranchInfo, GitInfo};
use crate::AppError;
use crate::AppStateWrapper;
use tauri::State;

/// Get repository information（per-project 部分：分支 / 工作树清单 / provider）。
///
/// **未提交变更不在此处** —— 它是「每个工作树」的事实（HEAD / index / workdir 三者独立），
/// 走 [`get_workspace_status`]。把它塞进 per-project 结构正是 worktree 视图串主仓内容的结构成因。
#[tauri::command]
pub async fn get_git_info(
    workspace: WorkspaceSession,
    state: State<'_, AppStateWrapper>,
) -> Result<GitInfo, AppError> {
    let (t, repo) = state.resolve_workspace_target(&workspace).await?;
    operations::get_git_info(&t, repo.root())
        .await
        .map_err(AppError::from)
}

/// Get branch information.
#[tauri::command]
pub async fn get_git_branch_info(
    workspace: WorkspaceSession,
    state: State<'_, AppStateWrapper>,
) -> Result<GitBranchInfo, AppError> {
    let (t, repo) = state.resolve_workspace_target(&workspace).await?;
    operations::get_git_branch_info(&t, repo.root())
        .await
        .map_err(AppError::from)
}

/// 读取某**Workspace**的权威 status（主仓与 worktree 同一条读路径、同一种载荷）。
///
/// 取代旧的 `get_worktree_changed_files` + `ChangedFilesPayload{version: 0}`：那张「无版本
/// 语义」的口子使 version gate 只能恒放行，push 快照与 pull 结果在同一槽里后到者胜
/// —— worktree 视图串主仓内容的直接成因。
#[tauri::command]
pub async fn get_workspace_status(
    workspace: WorkspaceSession,
    state: State<'_, AppStateWrapper>,
) -> Result<GitStatusSnapshot, AppError> {
    let (_t, repo) = state.resolve_workspace_target(&workspace).await?;
    crate::git::services::status::read_workspace_status(&state, &repo).await
}

/// 设置**可见集合**（声明式 reconcile）：让这些Workspace同时拥有 push 生产者，并释放**不在**
/// 集合里的已挂载单元。
///
/// C2 起不再有「同时至多一套挂载」：挂 A 不释放 B，因此「主仓 / linked worktree 互相顶掉」
/// 在结构上不可能（红线 16：资源稀缺只允许影响**调度顺序**，不得影响**可观测集合**）。
/// C4 起它同时是**释放的唯一起点**（离热即释放，补掉 C2 遗留的「挂载集合无界增长」）——
/// 释放保留登记表数据（C1：释放 ≠ 数据作废）。
///
/// 返回**逐单元**结局：`ready`（快照就绪）/ `pending`（挂载已成立、首轮重算在途，由推送与
/// 读路径收敛 —— 冷窗口**不是错误**）/ `failed`（该单元解析不出来、不是 git 库、或 pull 失败）。
/// 一个坏项目只让自己那项 `failed`，不影响同批其它单元（整批失败会拖死全部）。
/// 编排逻辑见 `git::services::status::activate_many`；前端唯一发送端是
/// `app/hooks/useVisibleWorkspaces.ts`。
#[tauri::command]
pub async fn set_visible_workspaces(
    workspaces: Vec<WorkspaceSession>,
    app: tauri::AppHandle,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<crate::git::services::status::WorkspaceActivationEntry>, AppError> {
    // 交付适配器只在此处构造（服务层只认端口，见 `common/file/watcher/sink.rs`）。
    let sink: std::sync::Arc<dyn crate::common::file::watcher::WatcherEventSink> =
        std::sync::Arc::new(crate::common::file::watcher::AppHandleSink::new(app));
    let outcomes = crate::git::services::status::activate_many(&state, sink, &workspaces).await;
    Ok(outcomes
        .into_iter()
        .map(|(key, outcome)| {
            crate::git::services::status::WorkspaceActivationEntry::of(&key, outcome)
        })
        .collect())
}

/// 把调用方持有的 worktree 路径归一成后端使用的 canonical 形态。
///
/// 前端不自己做路径归一（红线 12：路径身份只有一个判定处），而 session 里存的可能是
/// canonical 保证落地之前写下的形态（macOS `/tmp` ↔ `/private/tmp`）。恢复激活态必须先
/// 换成与 `git worktree list` 同一形态，否则「该单元是否还存在」的校验必然认不出来 ——
/// 实测表现为：重启后恢复的 worktree 被立刻判没、回落主仓。
///
/// 返回的是**身份渲染**（平台无关字母表，见 `common/git/checkout_path.rs`）—— 它就是前端
/// 用来拼 `WorkspaceKey` 的那个分量；宿主可执行形态（`exec`）绝不外泄给前端。
#[tauri::command]
pub async fn canonical_worktree_path(
    project_id: String,
    path: String,
    state: State<'_, AppStateWrapper>,
) -> Result<String, AppError> {
    let (target, _) = state.resolve_project(&project_id)?;
    crate::common::git::checkout_path::CheckoutPath::resolve_async(&target, &path)
        .await
        .map(|resolved| resolved.identity().to_string())
        .map_err(AppError::from)
}

/// List untracked files under a directory (expands a collapsed untracked-dir
/// entry shown in the changes list). Returns an error when the path is not a
/// git repository; the UI expand handler catches it.
#[tauri::command]
pub async fn get_untracked_files(
    workspace: WorkspaceSession,
    dir_path: String,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<String>, AppError> {
    let (t, repo) = state.resolve_workspace_target(&workspace).await?;
    validate_repo_relative_path(&t, repo.root(), &dir_path).map_err(AppError::from)?;
    operations::get_untracked_files(&t, repo.root(), &dir_path)
        .await
        .map_err(AppError::from)
}

/// Get diff statistics for changed files.
#[tauri::command]
pub async fn get_changed_files_diff_stats(
    workspace: WorkspaceSession,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<FileDiffStats>, AppError> {
    let (t, repo) = state.resolve_workspace_target(&workspace).await?;
    operations::get_changed_files_diff_stats(&t, repo.root())
        .await
        .map_err(AppError::from)
}

/// Get the diff for a specific file.
#[tauri::command]
pub async fn get_file_diff(
    workspace: WorkspaceSession,
    file_path: String,
    collapse: Option<bool>,
    state: State<'_, AppStateWrapper>,
) -> Result<DiffResult, AppError> {
    let t0 = std::time::Instant::now();
    let (t, repo) = state.resolve_workspace_target(&workspace).await?;
    validate_repo_relative_path(&t, repo.root(), &file_path)?;
    let collapse = collapse.unwrap_or(true);
    let result = operations::get_file_diff(&t, repo.root(), &file_path, collapse)
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
