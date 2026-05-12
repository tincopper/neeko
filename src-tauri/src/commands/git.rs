use crate::models::*;
use crate::AppError;
use crate::AppStateWrapper;
use std::path::PathBuf;
use tauri::State;

#[tauri::command]
pub fn create_worktree(
    project_id: String,
    worktree_path: String,
    branch_name: String,
    new_branch: bool,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        let wt = PathBuf::from(&worktree_path);
        if let Some(parent) = wt.parent() {
            std::fs::create_dir_all(parent).map_err(AppError::from)?;
        }
        crate::git::create_worktree(&project.path, &wt, &branch_name, new_branch)
            .map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn remove_worktree(
    project_id: String,
    worktree_path: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::remove_worktree(&project.path, &PathBuf::from(&worktree_path))
            .map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn is_worktree_dirty(
    project_id: String,
    worktree_path: String,
    state: State<AppStateWrapper>,
) -> Result<bool, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::is_worktree_dirty(&project.path, &PathBuf::from(&worktree_path))
            .map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn delete_branch(
    project_id: String,
    branch_name: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::delete_branch(&project.path, &branch_name, true).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn checkout_branch(
    project_id: String,
    branch_name: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::checkout_branch(&project.path, &branch_name).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn create_branch(
    project_id: String,
    branch_name: String,
    start_point: Option<String>,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::create_branch(&project.path, &branch_name, start_point.as_deref())
            .map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn rename_branch(
    project_id: String,
    old_name: String,
    new_name: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::rename_branch(&project.path, &old_name, &new_name).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn rename_worktree(
    project_id: String,
    worktree_path: String,
    new_name: String,
    state: State<AppStateWrapper>,
) -> Result<String, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::rename_worktree(&project.path, &PathBuf::from(&worktree_path), &new_name)
            .map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn get_file_diff_command(
    project_id: String,
    file_path: String,
    line_limit: Option<usize>,
    state: State<AppStateWrapper>,
) -> Result<DiffResult, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::get_file_diff_cli(&project.path, &file_path, line_limit).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn get_worktree_changed_files(
    project_id: String,
    worktree_path: String,
    state: State<AppStateWrapper>,
) -> Result<Vec<FileChange>, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        let repo_path = if worktree_path.is_empty() {
            project.path.clone()
        } else {
            PathBuf::from(&worktree_path)
        };
        crate::git::get_changed_files_for_path(&repo_path).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn get_worktree_file_diff(
    project_id: String,
    worktree_path: String,
    file_path: String,
    line_limit: Option<usize>,
    state: State<AppStateWrapper>,
) -> Result<DiffResult, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if manager.get_project(&project_id).is_some() {
        crate::git::get_file_diff_cli(&PathBuf::from(&worktree_path), &file_path, line_limit)
            .map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn stage_files_command(
    project_id: String,
    file_paths: Vec<String>,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::stage_files(&project.path, &file_paths).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn unstage_files_command(
    project_id: String,
    file_paths: Vec<String>,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::unstage_files(&project.path, &file_paths).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn stage_all_command(
    project_id: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::stage_all(&project.path).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn unstage_all_command(
    project_id: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::unstage_all(&project.path).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn discard_file_command(
    project_id: String,
    file_path: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::discard_file(&project.path, &file_path).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn discard_all_command(
    project_id: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::discard_all(&project.path).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn commit_command(
    project_id: String,
    message: String,
    state: State<AppStateWrapper>,
) -> Result<CommitResult, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::commit(&project.path, &message).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn commit_and_push_command(
    project_id: String,
    message: String,
    state: State<AppStateWrapper>,
) -> Result<CommitResult, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::commit_and_push(&project.path, &message).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn commit_files_command(
    project_id: String,
    file_paths: Vec<String>,
    message: String,
    state: State<AppStateWrapper>,
) -> Result<CommitResult, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::commit_files(&project.path, &file_paths, &message).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn fetch_command(project_id: String, state: State<AppStateWrapper>) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::fetch(&project.path).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn pull_command(project_id: String, state: State<AppStateWrapper>) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::pull(&project.path).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn push_command(
    project_id: String,
    set_upstream: bool,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::push(&project.path, set_upstream).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn get_commit_log_command(
    project_id: String,
    count: usize,
    skip: Option<usize>,
    state: State<AppStateWrapper>,
) -> Result<Vec<CommitEntry>, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::get_commit_log(&project.path, count, skip.unwrap_or(0)).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn get_ahead_behind_command(
    project_id: String,
    state: State<AppStateWrapper>,
) -> Result<AheadBehind, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::get_ahead_behind(&project.path).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn get_commit_detail_command(
    project_id: String,
    commit_hash: String,
    state: State<AppStateWrapper>,
) -> Result<CommitDetail, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::get_commit_detail(&project.path, &commit_hash).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn get_commit_files_command(
    project_id: String,
    commit_hash: String,
    state: State<AppStateWrapper>,
) -> Result<Vec<CommitFileChange>, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::get_commit_files(&project.path, &commit_hash).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn get_commit_file_diff_command(
    project_id: String,
    commit_hash: String,
    file_path: String,
    state: State<AppStateWrapper>,
) -> Result<DiffResult, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::get_commit_file_diff(&project.path, &commit_hash, &file_path)
            .map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

// ─── PR Commands ────────────────────────────────────────────────────────

#[tauri::command]
pub fn is_gh_installed_command() -> bool {
    crate::git::is_gh_installed()
}

#[tauri::command]
pub fn list_prs_command(
    project_id: String,
    state: String,
    limit: usize,
    state_w: State<AppStateWrapper>,
) -> Result<Vec<PRListItem>, AppError> {
    let manager = state_w.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::list_prs(&project.path, &state, limit).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn view_pr_command(
    project_id: String,
    pr_number: u64,
    state: State<AppStateWrapper>,
) -> Result<PRInfo, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::view_pr(&project.path, pr_number).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn create_pr_command(
    project_id: String,
    title: String,
    body: String,
    base: Option<String>,
    draft: bool,
    state: State<AppStateWrapper>,
) -> Result<u64, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::create_pr(&project.path, &title, &body, base.as_deref(), draft)
            .map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn merge_pr_command(
    project_id: String,
    pr_number: u64,
    method: String,
    state: State<AppStateWrapper>,
) -> Result<PRMergeResult, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::merge_pr(&project.path, pr_number, &method).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn close_pr_command(
    project_id: String,
    pr_number: u64,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::close_pr(&project.path, pr_number).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn checkout_pr_command(
    project_id: String,
    pr_number: u64,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::checkout_pr(&project.path, pr_number).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn cherry_pick_command(
    project_id: String,
    commit_hash: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::cherry_pick(&project.path, &commit_hash).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn revert_command(
    project_id: String,
    commit_hash: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::revert(&project.path, &commit_hash).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn create_tag_command(
    project_id: String,
    tag_name: String,
    message: Option<String>,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::create_tag(&project.path, &tag_name, message.as_deref()).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn checkout_detached_command(
    project_id: String,
    commit_hash: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::checkout_detached(&project.path, &commit_hash).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn create_and_switch_branch_command(
    project_id: String,
    branch_name: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::create_and_switch_branch(&project.path, &branch_name).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn default_branch_command(
    project_id: String,
    state: State<AppStateWrapper>,
) -> Result<String, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::default_branch(&project.path).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn remote_web_url_command(
    project_id: String,
    state: State<AppStateWrapper>,
) -> Result<String, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::remote_web_url(&project.path).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

/// 通过当前项目选择的 Agent CLI，根据 staged diff 和近期 commit 历史，
/// 自动生成 commit message。
///
/// 执行方式：`<agent_command> [prompt_args...] "<prompt>"`
/// 例如 claude-code：`claude -p "<prompt>"`
#[tauri::command]
pub async fn generate_commit_message_command(
    project_id: String,
    agent_id: String,
    // 前端传入的 agent 命令路径 override（与 agentCommandOverrides[agent.id] 对应）
    agent_command_override: Option<String>,
    // 前端 UI 中已勾选的文件列表（不要求已 stage，直接对这些文件取 diff）
    file_paths: Vec<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<String, AppError> {
    // 1. 获取项目路径
    let project_path = {
        let manager = state.project_manager.lock().map_err(AppError::from)?;
        manager
            .get_project(&project_id)
            .map(|p| p.path.clone())
            .ok_or_else(|| AppError::NotFound(format!("Project not found: {}", project_id)))?
    };

    // 2. 获取 agent 配置并解析 prompt_args
    let (agent_command, prompt_args, post_prompt_args) = {
        let agent_manager = state.agent_manager.lock().map_err(AppError::from)?;
        let agent = agent_manager
            .get_agent(&agent_id)
            .ok_or_else(|| AppError::NotFound(format!("Agent not found: {}", agent_id)))?;

        let pargs = crate::agent::AgentManager::resolve_prompt_args(agent).ok_or_else(|| {
            AppError::InvalidInput(format!(
                "Agent '{}' does not support prompt mode.",
                agent.name
            ))
        })?;

        // 优先使用前端传入的 override 路径，回退到 AgentConfig.command
        let cmd = agent_command_override
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or(&agent.command)
            .to_string();

        let post_pargs = crate::agent::AgentManager::resolve_post_prompt_args(agent);
        log::info!(
            "[AI commit] agent_id={} command={} prompt_args={:?} post_prompt_args={:?}",
            agent_id,
            cmd,
            pargs,
            post_pargs
        );
        (cmd, pargs, post_pargs)
    };

    log::info!("[AI commit] project_path={}", project_path.display());

    // 3. 获取选中文件的 diff（相对于 HEAD，无需提前 stage）
    if file_paths.is_empty() {
        return Err(AppError::InvalidInput(
            "No files selected. Please select files to commit first.".to_string(),
        ));
    }

    let diff =
        crate::git::get_diff_for_files(&project_path, &file_paths, 500).map_err(AppError::from)?;

    if diff.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "No changes found in selected files.".to_string(),
        ));
    }

    log::info!("[AI commit] files={:?} diff_len={}", file_paths, diff.len());

    // 4. 获取最近 5 条 commit messages 用于风格参考
    let recent_messages =
        crate::git::get_recent_commit_messages(&project_path, 5).unwrap_or_default();

    let recent_section = if recent_messages.is_empty() {
        "(no previous commits found)".to_string()
    } else {
        recent_messages
            .iter()
            .map(|m| format!("- {}", m))
            .collect::<Vec<_>>()
            .join("\n")
    };

    // 5. 构建 prompt 文本
    let uses_file_mode = prompt_args.last().map(|a| a == "-f").unwrap_or(false);

    let prompt_file_content = format!(
        r#"You are a git commit message generator. Your only job is to output a single commit message line.

CRITICAL: Your entire response must be ONLY the commit message itself.
- Do NOT include any explanation, reasoning, or commentary
- Do NOT include phrases like "Here is...", "I suggest...", "This commit..."
- Do NOT wrap in quotes or code blocks
- Do NOT output multiple lines unless it is a subject + blank line + body format
- Just the raw commit message text, nothing else

Recent commits for style/language reference:
{recent_section}

Style rules:
- Match the language of the recent commits (Chinese → output Chinese, English → output English)
- Follow the same prefix convention (feat:, fix:, chore:, docs:, refactor:, etc.) if used

Changes to commit:
{diff}"#,
        recent_section = recent_section,
        diff = diff,
    );
    // 文件模式下 message 为简短强制指令，非文件模式下直接用完整 prompt
    let prompt = if uses_file_mode {
        "Output ONLY the raw commit message for the attached changes. No explanation. No quotes. No markdown. Just the commit message text.".to_string()
    } else {
        prompt_file_content.clone()
    };

    log::info!(
        "[AI commit] diff_len={} recent_commits={}",
        diff.len(),
        recent_messages.len()
    );

    // 6. 执行 agent CLI
    let full_path = resolve_full_path();
    let resolved_command = resolve_command_path(&agent_command, &full_path);

    // 判断是否文件模式：prompt_args 最后一个 arg 为 "-f" 时，
    // 把 prompt 写入临时文件，将文件路径作为最后一个参数传入。
    let uses_file_mode = prompt_args.last().map(|a| a == "-f").unwrap_or(false);

    // 若是文件模式，把 prompt_file_content 写入临时文件 .neeko/commit.prompt
    let prompt_file = if uses_file_mode {
        let neeko_dir = project_path.join(".neeko");
        std::fs::create_dir_all(&neeko_dir)
            .map_err(|e| AppError::InvalidInput(format!("Failed to create .neeko dir: {}", e)))?;
        let tmp_path = neeko_dir.join("commit.prompt");
        std::fs::write(&tmp_path, prompt_file_content.as_bytes())
            .map_err(|e| AppError::InvalidInput(format!("Failed to write prompt file: {}", e)))?;
        log::info!("[AI commit] prompt file written to: {}", tmp_path.display());
        Some(tmp_path)
    } else {
        None
    };

    log::info!(
        "[AI commit] exec: {} {:?} <prompt({} chars)>",
        resolved_command,
        prompt_args,
        prompt.len()
    );
    log::info!("[AI commit] PATH={}", full_path);

    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = crate::utils::command::local::exec("cmd.exe");
        c.env("PATH", &full_path);
        c.env("NO_COLOR", "1");
        c.arg("/C");
        c.arg(&resolved_command);
        c
    };
    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut c = crate::utils::command::local::exec(&resolved_command);
        c.env("PATH", &full_path);
        c.env("NO_COLOR", "1");
        c
    };

    if uses_file_mode {
        // 文件模式：run [flags] "message" -f <file> [post_prompt_args]
        for arg in prompt_args.iter().take(prompt_args.len() - 1) {
            cmd.arg(arg);
        }
        cmd.arg(&prompt);
        cmd.arg("-f");
        cmd.arg(prompt_file.as_ref().unwrap());
    } else {
        // 普通模式：command [prompt_args] "prompt" [post_prompt_args]
        for arg in &prompt_args {
            cmd.arg(arg);
        }
        cmd.arg(&prompt);
    }
    // 追加后置参数（如 claude 的 --dangerously-skip-permissions）
    for arg in &post_prompt_args {
        cmd.arg(arg);
    }
    cmd.current_dir(&project_path);

    let output = cmd.output().map_err(|e| {
        log::error!("[AI commit] spawn error: {}", e);
        AppError::InvalidInput(format!(
            "Failed to run agent '{}': {}. Check the agent path in Settings.",
            agent_command, e
        ))
    })?;

    // 清理临时 prompt 文件（无论成功与否）
    if let Some(ref tmp) = prompt_file {
        let _ = std::fs::remove_file(tmp);
    }

    let exit_code = output.status.code().unwrap_or(-1);
    let stdout_str = decode_output(&output.stdout);
    let stderr_str = decode_output(&output.stderr);

    log::info!("[AI commit] exit_code={}", exit_code);
    if !stdout_str.trim().is_empty() {
        log::info!("[AI commit] stdout={}", stdout_str.trim());
    }
    if !stderr_str.trim().is_empty() {
        log::warn!("[AI commit] stderr={}", stderr_str.trim());
    }

    if !output.status.success() {
        let detail = if stderr_str.trim().is_empty() {
            stdout_str.trim().to_string()
        } else {
            stderr_str.trim().to_string()
        };
        return Err(AppError::InvalidInput(format!(
            "Agent '{}' failed (exit {}): {}",
            agent_command, exit_code, detail
        )));
    }

    // 7. 清理输出
    let message = clean_ai_output(&stdout_str);

    if message.is_empty() {
        return Err(AppError::InvalidInput(
            "Agent returned an empty response.".to_string(),
        ));
    }

    Ok(message)
}

/// 用 where.exe（Windows）或 which（Unix）在给定 PATH 下解析命令的真实可执行路径。
/// 找不到时回退到原始命令名（让系统自己报错）。
fn resolve_command_path(command: &str, path_env: &str) -> String {
    // 已经是绝对路径，直接返回
    if std::path::Path::new(command).is_absolute() {
        return command.to_string();
    }

    #[cfg(target_os = "windows")]
    {
        // where.exe 支持 /F（带引号）和按 PATHEXT 顺序查找 .exe/.cmd/.bat
        let output = std::process::Command::new("where.exe")
            .arg(command)
            .env("PATH", path_env)
            .output();

        if let Ok(o) = output {
            if o.status.success() {
                let text = String::from_utf8_lossy(&o.stdout);
                // where 可能返回多行，取第一行（优先 .exe，但 .cmd 也可以直接被 cmd /C 执行）
                if let Some(first) = text.lines().next() {
                    let p = first.trim().to_string();
                    if !p.is_empty() {
                        log::info!("[AI commit] resolved '{}' -> '{}'", command, p);
                        return p;
                    }
                }
            }
        }
        command.to_string()
    }

    #[cfg(not(target_os = "windows"))]
    {
        use which::which_in;
        match which_in(
            command,
            Some(path_env),
            std::env::current_dir().unwrap_or_default(),
        ) {
            Ok(p) => {
                let s = p.to_string_lossy().to_string();
                log::info!("[AI commit] resolved '{}' -> '{}'", command, s);
                s
            }
            Err(_) => command.to_string(),
        }
    }
}

/// 获取完整 PATH：合并当前进程 PATH + 用户级/系统级 PATH，
/// 解决 Tauri GUI 进程不继承用户 shell PATH 的问题（如 npm global bin、nvm 等）。
fn resolve_full_path() -> String {
    let current = std::env::var("PATH").unwrap_or_default();

    #[cfg(target_os = "windows")]
    {
        // Windows: 读取注册表中的用户级和系统级 PATH 并合并
        let user_path = std::env::var("USERPROFILE")
            .map(|home| {
                // 常见 npm global bin 位置
                let appdata = std::env::var("APPDATA").unwrap_or_default();
                vec![
                    format!("{}\\AppData\\Local\\Microsoft\\WindowsApps", home),
                    format!("{}\\npm", appdata),
                    format!("{}\\npm", home),
                ]
            })
            .unwrap_or_default();

        // 从系统环境变量读取用户级 PATH（注册表 HKCU）
        let reg_user_path = read_registry_path_windows();

        let mut parts: Vec<String> = vec![current.clone()];
        if !reg_user_path.is_empty() {
            parts.push(reg_user_path);
        }
        parts.extend(user_path);

        // 去重合并
        let mut seen = std::collections::HashSet::new();
        parts
            .join(";")
            .split(';')
            .filter(|p| !p.is_empty() && seen.insert(p.to_string()))
            .collect::<Vec<_>>()
            .join(";")
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Unix/macOS: 追加常见 npm/nvm/homebrew 路径
        let home = std::env::var("HOME").unwrap_or_default();
        let extra = [
            format!("{}/.local/bin", home),
            format!("{}/.nvm/versions/node/current/bin", home),
            "/usr/local/bin".to_string(),
            "/opt/homebrew/bin".to_string(),
        ];
        let mut parts: Vec<&str> = current.split(':').collect();
        for e in &extra {
            if !parts.contains(&e.as_str()) {
                parts.push(e);
            }
        }
        parts.join(":")
    }
}

#[cfg(target_os = "windows")]
fn read_registry_path_windows() -> String {
    // 通过 reg.exe 读取用户级 PATH（HKCU\Environment）
    let output = std::process::Command::new("reg")
        .args(["query", "HKCU\\Environment", "/v", "PATH"])
        .output();

    match output {
        Ok(o) if o.status.success() => {
            let text = String::from_utf8_lossy(&o.stdout).to_string();
            // reg query 输出格式：
            //     PATH    REG_EXPAND_SZ    <value>
            for line in text.lines() {
                let line = line.trim();
                if line.to_uppercase().starts_with("PATH") {
                    // 找最后一个 REG_xxx 后的值
                    if let Some(pos) = line.rfind("REG_") {
                        let after = &line[pos..];
                        if let Some(val_pos) = after.find("    ") {
                            let val = after[val_pos..].trim();
                            // 展开 %USERPROFILE% 等变量
                            return expand_env_vars_windows(val);
                        }
                    }
                }
            }
            String::new()
        }
        _ => String::new(),
    }
}

#[cfg(target_os = "windows")]
fn expand_env_vars_windows(s: &str) -> String {
    // 简单展开 %VAR% 形式的环境变量
    let mut result = s.to_string();
    let re_start = result.find('%');
    if re_start.is_none() {
        return result;
    }
    // 用 cmd /C echo 展开（最简单可靠的方式）
    let output = std::process::Command::new("cmd.exe")
        .args(["/C", &format!("echo {}", s)])
        .output();
    if let Ok(o) = output {
        let expanded = String::from_utf8_lossy(&o.stdout).trim().to_string();
        if !expanded.is_empty() && !expanded.starts_with("echo") {
            result = expanded;
        }
    }
    result
}

/// 解码进程输出字节，优先 UTF-8；Windows 上若 UTF-8 失败则尝试 GBK（通过 lossy 回退）。
fn decode_output(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => {
            // 非 UTF-8（常见于 Windows GBK 输出），用 lossy 替换无效字节
            String::from_utf8_lossy(bytes).to_string()
        }
    }
}

/// 清理 AI 输出：去除 markdown 包裹、ANSI 颜色码、常见废话前缀，只保留 commit message 本体。
fn clean_ai_output(raw: &str) -> String {
    // 1. 去除 ANSI 颜色/控制码（形如 \x1b[...m）
    let ansi_stripped = strip_ansi(raw);
    let trimmed = ansi_stripped.trim();

    // 2. 去除 ``` 代码块包裹
    let inner = if trimmed.starts_with("```") {
        let without_fence = trimmed.trim_start_matches('`');
        let after_lang = without_fence
            .find('\n')
            .map(|i| &without_fence[i + 1..])
            .unwrap_or(without_fence);
        after_lang.trim_end_matches('`').trim()
    } else {
        trimmed
    };

    // 3. 去除常见 AI 废话前缀（逐行检查第一个非空行）
    let waste_prefixes: &[&str] = &[
        "here is",
        "here's",
        "the commit message",
        "commit message:",
        "suggested commit",
        "i suggest",
        "i'd suggest",
        "based on",
        "this commit",
        "sure,",
        "sure!",
        "of course",
        "以下是",
        "这是",
        "建议的",
        "提交信息：",
        "提交消息：",
    ];
    let lines: Vec<&str> = inner.lines().collect();
    // 找到第一个非空且不是废话前缀的行作为起始
    let start_idx = lines
        .iter()
        .position(|l| {
            let lower = l.trim().to_lowercase();
            !lower.is_empty() && !waste_prefixes.iter().any(|p| lower.starts_with(p))
        })
        .unwrap_or(0);
    let lines = &lines[start_idx..];

    // 4. 取 subject + 可选 body（subject + 空行 + body），遇到第二个空行截止
    //    最多保留 20 行，丢弃 AI 在 commit message 后附加的解释
    let mut result_lines: Vec<&str> = Vec::new();
    let mut blank_count = 0;
    for line in lines {
        if line.trim().is_empty() {
            blank_count += 1;
            if blank_count >= 2 {
                break;
            }
            result_lines.push(line);
        } else {
            blank_count = 0;
            result_lines.push(line);
        }
        if result_lines.len() >= 20 {
            break;
        }
    }

    result_lines.join("\n").trim().to_string()
}

/// 去除字符串中的 ANSI 转义序列（颜色码等）。
fn strip_ansi(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            // 跳过 ESC [ ... m 序列
            if chars.peek() == Some(&'[') {
                chars.next();
                // 跳到序列终止字符（字母）
                for ch in chars.by_ref() {
                    if ch.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
        } else {
            result.push(c);
        }
    }
    result
}
