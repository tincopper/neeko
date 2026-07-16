use crate::common::connection::types::AuthMethod;
use crate::common::executor::factory::ExecTarget;
use crate::common::git::operations;
use crate::common::git::transport::GitTransport;
use crate::common::git::types::{DiffResult, PushOutcome};
use crate::project::types::{
    AheadBehind, CommitDetail, CommitEntry, CommitFileChange, CommitResult, FileChange,
    FileContent, FileDiffStats, FileNode, GitBranchInfo, GitInfo, GitProvider, PRComment, PRCommit,
    PRFileChange, PRInfo, PRListItem, PRMergeResult, PRReviewComment, PrLabel,
};
use crate::AppError;
use crate::AppStateWrapper;
use tauri::State;

// ─── Staging ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn stage_files(
    project_id: String,
    file_paths: Vec<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::stage_files(&t, &wd, &file_paths)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unstage_files(
    project_id: String,
    file_paths: Vec<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::unstage_files(&t, &wd, &file_paths)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn stage_all(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::stage_all(&t, &wd).await.map_err(AppError::from)
}

#[tauri::command]
pub async fn unstage_all(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::unstage_all(&t, &wd)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn discard_file(
    project_id: String,
    file_path: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::discard_file(&t, &wd, &file_path)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn discard_all(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::discard_all(&t, &wd)
        .await
        .map_err(AppError::from)
}

// ─── Remote operations ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn fetch(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<PushOutcome, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::fetch(&t, &wd).await.map_err(AppError::from)
}

#[tauri::command]
pub async fn pull(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<PushOutcome, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::pull(&t, &wd).await.map_err(AppError::from)
}

#[tauri::command]
pub async fn push(
    project_id: String,
    set_upstream: Option<bool>,
    state: State<'_, AppStateWrapper>,
) -> Result<PushOutcome, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::push(&t, &wd, set_upstream.unwrap_or(false))
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn fetch_with_credentials(
    project_id: String,
    username: String,
    password: String,
    state: State<'_, AppStateWrapper>,
) -> Result<PushOutcome, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::fetch_with_credentials(&t, &wd, &username, &password)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn pull_with_credentials(
    project_id: String,
    username: String,
    password: String,
    state: State<'_, AppStateWrapper>,
) -> Result<PushOutcome, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::pull_with_credentials(&t, &wd, &username, &password)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn push_with_credentials(
    project_id: String,
    set_upstream: Option<bool>,
    username: String,
    password: String,
    state: State<'_, AppStateWrapper>,
) -> Result<PushOutcome, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::push_with_credentials(&t, &wd, set_upstream.unwrap_or(false), &username, &password)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn commit_files(
    project_id: String,
    file_paths: Vec<String>,
    message: String,
    state: State<'_, AppStateWrapper>,
) -> Result<CommitResult, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::commit_files(&t, &wd, &file_paths, &message)
        .await
        .map_err(AppError::from)
}

// ─── Cherry-pick / Revert / Tag ──────────────────────────────────────────────

#[tauri::command]
pub async fn cherry_pick(
    project_id: String,
    commit_hash: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::cherry_pick(&t, &wd, &commit_hash)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn revert(
    project_id: String,
    commit_hash: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::revert(&t, &wd, &commit_hash)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn create_tag(
    project_id: String,
    name: String,
    message: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::create_tag(&t, &wd, &name, &message)
        .await
        .map_err(AppError::from)
}

// ─── Branching ───────────────────────────────────────────────────────────────

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

// ─── Worktree ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn create_worktree(
    project_id: String,
    worktree_path: String,
    branch_name: String,
    new_branch: bool,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    // Ensure parent directory exists (no-op for WSL/Remote)
    if let Some(parent) = std::path::Path::new(&worktree_path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    operations::create_worktree(&t, &wd, &worktree_path, &branch_name, new_branch)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn remove_worktree(
    project_id: String,
    worktree_path: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::remove_worktree(&t, &wd, &worktree_path)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn rename_worktree(
    project_id: String,
    old_path: String,
    new_path: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::rename_worktree(&t, &wd, &old_path, &new_path)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn is_worktree_dirty(
    project_id: String,
    worktree_path: String,
    state: State<'_, AppStateWrapper>,
) -> Result<bool, AppError> {
    let (t, _wd) = state.resolve_project(&project_id)?;
    operations::is_worktree_dirty(&t, &worktree_path)
        .await
        .map_err(AppError::from)
}

// ─── Info / Read operations ──────────────────────────────────────────────────

#[tauri::command]
pub async fn get_git_info(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<GitInfo, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    if t.supports_git2() {
        let repo = t
            .open_repo(&wd)
            .ok_or_else(|| AppError::from(anyhow::anyhow!("Failed to open git repository")))?;
        let branch_info = crate::common::git::local::get_git_branch_info_from_repo(&repo)
            .map_err(AppError::from)?;
        let changed_files = crate::common::git::local::get_changed_files_from_repo(&repo)
            .map_err(AppError::from)?;
        let is_clean = changed_files.is_empty();

        let git_provider = repo
            .find_remote("origin")
            .ok()
            .and_then(|r| r.url().map(|u| u.to_string()))
            .map(|u| crate::common::git::provider::detect_provider(&u))
            .unwrap_or(GitProvider::Unknown);

        Ok(GitInfo {
            current_branch: branch_info.current_branch,
            branches: branch_info.branches,
            worktrees: branch_info.worktrees,
            changed_files,
            is_clean,
            git_provider,
        })
    } else {
        operations::get_git_info_shell(&t, &wd)
            .await
            .map_err(AppError::from)
    }
}

#[tauri::command]
pub async fn get_git_branch_info(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<GitBranchInfo, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    if t.supports_git2() {
        let repo = t
            .open_repo(&wd)
            .ok_or_else(|| AppError::from(anyhow::anyhow!("Failed to open git repository")))?;
        crate::common::git::local::get_git_branch_info_from_repo(&repo).map_err(AppError::from)
    } else {
        operations::get_git_branch_info_shell(&t, &wd)
            .await
            .map_err(AppError::from)
    }
}

#[tauri::command]
pub async fn get_worktree_changed_files(
    project_id: String,
    worktree_path: String,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<FileChange>, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    // When worktree_path is empty, use the main project path
    let repo_path = if worktree_path.is_empty() {
        &wd
    } else {
        &worktree_path
    };
    if t.supports_git2() {
        let repo = t
            .open_repo(repo_path)
            .ok_or_else(|| AppError::from(anyhow::anyhow!("Failed to open git repository")))?;
        crate::common::git::local::get_changed_files_from_repo(&repo).map_err(AppError::from)
    } else {
        operations::get_worktree_changed_files(&t, repo_path)
            .await
            .map_err(AppError::from)
    }
}

#[tauri::command]
pub async fn get_changed_files_diff_stats(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<FileDiffStats>, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    if t.supports_git2() {
        let repo_path = std::path::Path::new(&wd);
        crate::common::git::local::get_changed_files_diff_stats(repo_path).map_err(AppError::from)
    } else {
        operations::get_changed_files_diff_stats_local(&wd)
            .await
            .map_err(AppError::from)
    }
}

#[tauri::command]
pub async fn get_file_diff(
    project_id: String,
    file_path: String,
    state: State<'_, AppStateWrapper>,
) -> Result<DiffResult, AppError> {
    let t0 = std::time::Instant::now();
    let (t, wd) = state.resolve_project(&project_id)?;
    let result = if t.supports_git2() {
        crate::common::git::local::get_file_diff(std::path::Path::new(&wd), &file_path)
            .map_err(AppError::from)
    } else {
        operations::get_file_diff(&t, &wd, &file_path)
            .await
            .map_err(AppError::from)
    };
    let elapsed_ms = t0.elapsed().as_millis();
    log::debug!("[perf] Rust get_file_diff: {} {}ms", file_path, elapsed_ms);
    result
}

#[tauri::command]
pub async fn is_git_repo(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<bool, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    Ok(t.is_git_repo(&wd).await)
}

// ─── Commit log / history ────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_commit_log(
    project_id: String,
    count: usize,
    skip: Option<usize>,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<CommitEntry>, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::get_commit_log(&t, &wd, count, skip.unwrap_or(0))
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn get_commit_detail(
    project_id: String,
    commit_hash: String,
    state: State<'_, AppStateWrapper>,
) -> Result<CommitDetail, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::get_commit_detail(&t, &wd, &commit_hash)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn get_commit_files(
    project_id: String,
    commit_hash: String,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<CommitFileChange>, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::get_commit_files(&t, &wd, &commit_hash)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn get_commit_file_diff(
    project_id: String,
    commit_hash: String,
    file_path: String,
    state: State<'_, AppStateWrapper>,
) -> Result<DiffResult, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::get_commit_file_diff(&t, &wd, &commit_hash, &file_path)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn get_ahead_behind(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<AheadBehind, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::get_ahead_behind(&t, &wd)
        .await
        .map_err(AppError::from)
}

// ─── Default branch ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn default_branch(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<String, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::default_branch(&t, &wd)
        .await
        .map_err(AppError::from)
}

// ─── File operations (unified via file service) ────────────────────────────

/// 文件树默认递归深度
const DEFAULT_TREE_DEPTH: u32 = 4;

#[tauri::command]
pub async fn read_dir_tree(
    project_id: String,
    root_path: Option<String>,
    sub_path: Option<String>,
    max_depth: Option<u32>,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<FileNode>, AppError> {
    let depth = max_depth.unwrap_or(DEFAULT_TREE_DEPTH);
    let (t, wd) = state.resolve_project(&project_id)?;
    let target = exec_target_from_git_transport(&t);
    let base = root_path.unwrap_or(wd);
    crate::common::file::services::read_dir_tree(&target, &base, sub_path.as_deref(), depth).await
}

/// Shared implementation for reading file content via shell (stat -> binary-detect -> cat).
/// Works for both Remote (SSH) and WSL transports.
#[tauri::command]
pub async fn read_file_content(
    project_id: String,
    file_path: String,
    root_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<FileContent, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let target = exec_target_from_git_transport(&t);
    let base = root_path.unwrap_or(wd);
    crate::common::file::services::read_file_content(&target, &base, &file_path).await
}

#[tauri::command]
pub async fn write_file_content(
    project_id: String,
    file_path: String,
    content: String,
    root_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let target = exec_target_from_git_transport(&t);
    let base = root_path.unwrap_or(wd);
    crate::common::file::services::write_file_content(&target, &base, &file_path, &content).await
}

// ─── Agent Config Resolution (private helpers) ──────────────────────────────

/// 解析 agent 配置：从 agent_manager 获取 agent → 提取 prompt_args / post_prompt_args。
fn resolve_agent_config(
    state: &AppStateWrapper,
    agent_id: &str,
    command_override: Option<&str>,
) -> Result<crate::common::agent::services::commit::AgentInvokeConfig, AppError> {
    use crate::common::agent::services::commit as ai_svc;

    let agent_manager = state.agent_manager.lock().map_err(AppError::from)?;
    let agent = agent_manager
        .get_agent(agent_id)
        .ok_or_else(|| AppError::NotFound(format!("Agent not found: {}", agent_id)))?;

    let prompt_args = agent.resolve_prompt_args().ok_or_else(|| {
        AppError::InvalidInput(format!(
            "Agent '{}' does not support prompt mode.",
            agent.name
        ))
    })?;

    let command = command_override
        .filter(|s| !s.is_empty())
        .unwrap_or(&agent.command)
        .to_string();

    let post_prompt_args = agent.resolve_post_prompt_args();

    log::info!(
        "[AI commit] agent_id={} command={} prompt_args={:?} post_prompt_args={:?}",
        agent_id,
        command,
        prompt_args,
        post_prompt_args
    );

    Ok(ai_svc::AgentInvokeConfig {
        command,
        prompt_args,
        post_prompt_args,
    })
}

/// WSL/SSH 场景解析 agent 配置。
///
/// `selected_agent` 可能是 agent ID 或 WSL/SSH 内的完整命令路径。
/// 返回 `(command, prompt_args, post_prompt_args)`。
fn resolve_agent_for_remote(
    state: &AppStateWrapper,
    selected_agent: &str,
) -> (String, Vec<String>, Vec<String>) {
    log::info!(
        "[AI commit remote] resolve_agent_for_remote: selected_agent='{}'",
        selected_agent
    );

    // 1. 按 ID 直接查找
    if let Ok(config) = resolve_agent_config(state, selected_agent, None) {
        log::info!(
            "[AI commit remote] resolved by id: command='{}' prompt_args={:?} post_prompt_args={:?}",
            selected_agent, config.prompt_args, config.post_prompt_args
        );
        return (
            selected_agent.to_string(),
            config.prompt_args,
            config.post_prompt_args,
        );
    }

    // 2. 按 ID 找不到 → 可能是完整路径，从路径提取命令名再尝试匹配
    let cmd_name = selected_agent
        .rsplit('/')
        .next()
        .unwrap_or(selected_agent)
        .trim_end_matches(".exe")
        .trim_end_matches(".cmd");

    log::info!(
        "[AI commit remote] id lookup failed, trying filename='{}'",
        cmd_name
    );

    if let Ok(config) = resolve_agent_config(state, cmd_name, None) {
        log::info!(
            "[AI commit remote] resolved by filename: command='{}' prompt_args={:?} post_prompt_args={:?}",
            selected_agent, config.prompt_args, config.post_prompt_args
        );
        return (
            selected_agent.to_string(),
            config.prompt_args,
            config.post_prompt_args,
        );
    }

    // 3. 完全未知 agent，用传入值作为命令，无 prompt_args（普通 inline 模式）
    log::info!(
        "[AI commit remote] unknown agent, using as-is: command='{}' prompt_args=[]",
        selected_agent
    );
    (selected_agent.to_string(), vec![], vec![])
}

// ─── Commit message generation (unified Remote + WSL) ───────────────────────

/// 通过 agent CLI 生成 commit message（Remote/WSL 统一入口）。
/// Agent 在远程/WSL 服务器上执行，自行分析变更，不传入 diff 内容。
#[tauri::command]
pub async fn generate_commit_message(
    project_id: String,
    agent_id: String,
    agent_command_override: Option<String>,
    file_paths: Vec<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<String, AppError> {
    use crate::common::agent::services::commit as ai_svc;
    let _ = agent_command_override; // Remote/WSL 不使用宿主机 override

    // 1. 解析 agent 配置（selected_agent 可能是 ID 或完整路径）
    let (agent_cmd, prompt_args, post_prompt_args) = resolve_agent_for_remote(&state, &agent_id);

    // 2. 构建 prompt
    let prompt = ai_svc::build_simple_commit_prompt(&file_paths);

    // 3. 构建命令字符串（共享函数）— 差异在 transport 分支中处理
    let (t, wd) = state.resolve_project(&project_id)?;
    let output = match &t {
        GitTransport::Local => {
            let sp = std::path::PathBuf::from(&wd);
            let config =
                resolve_agent_config(&state, &agent_id, agent_command_override.as_deref())?;
            ai_svc::generate_commit_message(&sp, &config, &file_paths).map_err(AppError::from)?
        }
        GitTransport::Remote {
            host,
            port,
            username,
            auth,
        } => {
            let sp = crate::common::utils::command::local::safe_path(&wd);
            let actual_cmd = ai_svc::build_agent_commit_cmd(
                &sp,
                &agent_cmd,
                &prompt_args,
                &post_prompt_args,
                &prompt,
            );

            log::info!(
                "[AI commit Remote] agent_cmd='{}' prompt_args={:?} post_prompt_args={:?}",
                agent_cmd,
                prompt_args,
                post_prompt_args
            );
            log::info!(
                "[AI commit Remote] actual_cmd (first 500 chars): {}",
                &actual_cmd[..actual_cmd.len().min(500)]
            );

            // 注入环境加载前缀，bash -ic 交互模式绕过 .bashrc 的 non-interactive guard
            let env_prefix = r#"source ~/.profile 2>/dev/null"#;
            let full_cmd = format!(
                "bash -ic <<'NEEKO_BASH'\n{}; {}\nNEEKO_BASH",
                env_prefix, actual_cmd
            );

            log::info!(
                "[AI commit Remote] host={}:{} full_cmd_len={}",
                host,
                port,
                full_cmd.len()
            );

            // 通过 SSH 执行
            let target = crate::common::executor::factory::ExecTarget::Remote {
                host: host.clone(),
                port: *port,
                username: username.clone(),
                auth: auth.clone(),
            };
            match crate::common::executor::sync::exec_on(&target, "sh", &["-c", &full_cmd]).await {
                Ok(o) => {
                    log::info!("[AI commit Remote] success, stdout_len={}", o.len());
                    if !o.is_empty() {
                        log::info!(
                            "[AI commit Remote] stdout (first 500 chars): {}",
                            &o[..o.len().min(500)]
                        );
                    }
                    o
                }
                Err(e) => {
                    log::error!("[AI commit Remote] exec failed: {}", e);
                    return Err(AppError::InvalidInput(format!(
                        "Failed to run agent on remote: {}",
                        e
                    )));
                }
            }
        }
        #[cfg(target_os = "windows")]
        GitTransport::Wsl { distro } => {
            let sp = crate::common::utils::command::local::safe_path(&wd);
            let actual_cmd = ai_svc::build_agent_commit_cmd(
                &sp,
                &agent_cmd,
                &prompt_args,
                &post_prompt_args,
                &prompt,
            );

            // 注入环境加载前缀，source ~/.profile 加载用户路径（.cargo/bin 等）
            let actual_cmd = format!(r#"source ~/.profile 2>/dev/null; {}"#, actual_cmd);

            // 通过 ExecTarget::Wsl + exec_on 获取 WSL 默认用户名
            let target = crate::common::executor::factory::ExecTarget::Wsl {
                distro: distro.clone(),
            };
            let wsl_user = match crate::common::executor::sync::exec_on(&target, "whoami", &[])
                .await
            {
                Ok(s) => s.trim().to_string(),
                Err(e) => {
                    log::warn!(
                        "[AI commit WSL] Failed to get WSL user via executor: {}, falling back to root",
                        e
                    );
                    "root".to_string()
                }
            };
            log::info!("[AI commit WSL] wsl_user={}", wsl_user);

            // 使用 bash -ic 交互模式执行（绕过 .bashrc 的 non-interactive guard，确保 nvm 加载）
            //    -u <user>: 确保 HOME=/home/<user>，profile 路径正确
            //    env_remove("PATH"): 清除 Windows 污染 PATH，从干净基础开始
            let wsl_output = crate::common::executor::wsl::exec_wsl(
                distro,
                Some(&wsl_user),
                &["PATH"],
                "bash",
                &["-ic", &actual_cmd],
            )
            .await
            .map_err(|e| AppError::InvalidInput(format!("Failed to execute wsl.exe: {}", e)))?;

            let exit_code = wsl_output.exit_code;
            let stderr = String::from_utf8_lossy(&wsl_output.stderr)
                .trim()
                .to_string();
            let stdout = String::from_utf8_lossy(&wsl_output.stdout)
                .trim()
                .to_string();

            log::info!(
                "[AI commit WSL] exit_code={} stdout_len={} stderr_len={}",
                exit_code,
                stdout.len(),
                stderr.len()
            );
            if !stdout.is_empty() {
                log::info!(
                    "[AI commit WSL] stdout (first 500 chars): {}",
                    &stdout[..stdout.len().min(500)]
                );
            }
            if !stderr.is_empty() {
                log::warn!(
                    "[AI commit WSL] stderr (first 500 chars): {}",
                    &stderr[..stderr.len().min(500)]
                );
            }

            if exit_code != 0 {
                let msg = if !stderr.is_empty() { stderr } else { stdout };
                return Err(AppError::InvalidInput(format!(
                    "Failed to run agent in WSL: {}",
                    msg
                )));
            }
            String::from_utf8_lossy(&wsl_output.stdout).to_string()
        }
    };

    // 清理输出
    let message = ai_svc::clean_ai_output(&output);
    if message.is_empty() {
        return Err(AppError::InvalidInput(
            "Agent returned an empty response.".to_string(),
        ));
    }
    Ok(message)
}

// ─── Remote/SSH utilities ───────────────────────────────────────────────────

#[tauri::command]
pub async fn get_remote_home_dir(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
) -> Result<String, AppError> {
    let target = crate::common::executor::factory::ExecTarget::Remote {
        host: host.clone(),
        port,
        username: username.clone(),
        auth: auth.clone(),
    };
    crate::common::executor::sync::exec_on(&target, "sh", &["-c", "echo $HOME"])
        .await
        .map(|s| s.trim().to_string())
        .map_err(|e| AppError::from(anyhow::anyhow!("{}", e)))
}

// ─── PR Commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn is_gh_installed_command() -> bool {
    crate::git::is_gh_installed().await
}

#[tauri::command]
pub async fn is_gh_authenticated_command() -> bool {
    crate::git::is_gh_authenticated().await
}

#[tauri::command]
pub async fn list_prs_command(
    project_id: String,
    state: String,
    limit: usize,
    state_w: State<'_, AppStateWrapper>,
) -> Result<Vec<PRListItem>, AppError> {
    let (t, wd) = state_w.resolve_project(&project_id)?;
    let wd_path = std::path::Path::new(&wd);
    let target = exec_target_from_git_transport(&t);
    crate::git::list_prs(wd_path, &target, &state, limit)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn list_repo_labels_command(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<PrLabel>, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let wd_path = std::path::Path::new(&wd);
    let target = exec_target_from_git_transport(&t);
    crate::git::list_repo_labels(wd_path, &target)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn list_repo_authors_command(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<String>, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let wd_path = std::path::Path::new(&wd);
    let target = exec_target_from_git_transport(&t);
    crate::git::list_repo_authors(wd_path, &target)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn view_pr_command(
    project_id: String,
    pr_number: u64,
    state: State<'_, AppStateWrapper>,
) -> Result<PRInfo, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let wd_path = std::path::Path::new(&wd);
    let target = exec_target_from_git_transport(&t);
    crate::git::view_pr(wd_path, &target, pr_number)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn create_pr_command(
    project_id: String,
    title: String,
    body: String,
    base: Option<String>,
    draft: bool,
    state: State<'_, AppStateWrapper>,
) -> Result<u64, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let wd_path = std::path::Path::new(&wd);
    let target = exec_target_from_git_transport(&t);
    crate::git::create_pr(wd_path, &target, &title, &body, base.as_deref(), draft)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn merge_pr_command(
    project_id: String,
    pr_number: u64,
    method: String,
    state: State<'_, AppStateWrapper>,
) -> Result<PRMergeResult, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let wd_path = std::path::Path::new(&wd);
    let target = exec_target_from_git_transport(&t);
    crate::git::merge_pr(wd_path, &target, pr_number, &method)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn close_pr_command(
    project_id: String,
    pr_number: u64,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let wd_path = std::path::Path::new(&wd);
    let target = exec_target_from_git_transport(&t);
    crate::git::close_pr(wd_path, &target, pr_number)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn list_pr_files_command(
    project_id: String,
    pr_number: u64,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<PRFileChange>, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let wd_path = std::path::Path::new(&wd);
    let target = exec_target_from_git_transport(&t);
    crate::git::list_pr_files(wd_path, &target, pr_number)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn list_pr_commits_command(
    project_id: String,
    pr_number: u64,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<PRCommit>, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let wd_path = std::path::Path::new(&wd);
    let target = exec_target_from_git_transport(&t);
    crate::git::list_pr_commits(wd_path, &target, pr_number)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn add_pr_review_comment_command(
    project_id: String,
    pr_number: u64,
    body: String,
    file_path: String,
    line: u64,
    side: String,
    state: State<'_, AppStateWrapper>,
) -> Result<PRReviewComment, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let wd_path = std::path::Path::new(&wd);
    let target = exec_target_from_git_transport(&t);
    crate::git::add_pr_review_comment(wd_path, &target, pr_number, &body, &file_path, line, &side)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn list_pr_review_comments_command(
    project_id: String,
    pr_number: u64,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<PRReviewComment>, AppError> {
    let t0 = std::time::Instant::now();
    let (t, wd) = state.resolve_project(&project_id)?;
    let wd_path = std::path::Path::new(&wd);
    let target = exec_target_from_git_transport(&t);
    let result = crate::git::list_pr_review_comments(wd_path, &target, pr_number)
        .await
        .map_err(AppError::from)?;
    log::debug!(
        "[perf] Rust list_pr_review_comments: PR #{} {}ms",
        pr_number,
        t0.elapsed().as_millis()
    );
    Ok(result)
}

// ─── PR Comment Commands ────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_pr_comments_command(
    project_id: String,
    pr_number: u64,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<PRComment>, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let wd_path = std::path::Path::new(&wd);
    let target = exec_target_from_git_transport(&t);
    crate::git::list_pr_comments(wd_path, &target, pr_number)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn add_pr_comment_command(
    project_id: String,
    pr_number: u64,
    body: String,
    state: State<'_, AppStateWrapper>,
) -> Result<PRComment, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let wd_path = std::path::Path::new(&wd);
    let target = exec_target_from_git_transport(&t);
    crate::git::add_pr_comment(wd_path, &target, pr_number, &body)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn edit_pr_comment_command(
    project_id: String,
    pr_number: u64,
    comment_id: String,
    body: String,
    state: State<'_, AppStateWrapper>,
) -> Result<PRComment, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let wd_path = std::path::Path::new(&wd);
    let target = exec_target_from_git_transport(&t);
    crate::git::edit_pr_comment(wd_path, &target, pr_number, &comment_id, &body)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn delete_pr_comment_command(
    project_id: String,
    pr_number: u64,
    comment_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let wd_path = std::path::Path::new(&wd);
    let target = exec_target_from_git_transport(&t);
    crate::git::delete_pr_comment(wd_path, &target, pr_number, &comment_id)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn add_comment_reaction_command(
    project_id: String,
    pr_number: u64,
    comment_id: String,
    emoji: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let wd_path = std::path::Path::new(&wd);
    let target = exec_target_from_git_transport(&t);
    crate::git::add_comment_reaction(wd_path, &target, pr_number, &comment_id, &emoji)
        .await
        .map_err(AppError::from)
}

/// Helper: convert GitTransport to ExecTarget for PR operations.
fn exec_target_from_git_transport(t: &GitTransport) -> ExecTarget {
    match t {
        GitTransport::Local => ExecTarget::Local,
        #[cfg(target_os = "windows")]
        GitTransport::Wsl { distro } => ExecTarget::Wsl {
            distro: distro.clone(),
        },
        GitTransport::Remote {
            host,
            port,
            username,
            auth,
        } => ExecTarget::Remote {
            host: host.clone(),
            port: *port,
            username: username.clone(),
            auth: auth.clone(),
        },
    }
}
