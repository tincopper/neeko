use crate::git::operations;
use crate::git::transport::GitTransport;
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
    let project = manager
        .get_project(&project_id)
        .ok_or_else(|| AppError::NotFound(format!("Project not found: {}", project_id)))?;
    let work_dir = project.path.to_string_lossy().to_string();
    let transport = GitTransport::Local;
    let rt = tokio::runtime::Handle::current();
    rt.block_on(operations::remove_worktree(
        &transport,
        &work_dir,
        &worktree_path,
    ))
    .map_err(AppError::from)
}

#[tauri::command]
pub fn is_worktree_dirty(
    project_id: String,
    worktree_path: String,
    state: State<AppStateWrapper>,
) -> Result<bool, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    let _project = manager
        .get_project(&project_id)
        .ok_or_else(|| AppError::NotFound(format!("Project not found: {}", project_id)))?;
    let transport = GitTransport::Local;
    let rt = tokio::runtime::Handle::current();
    rt.block_on(operations::is_worktree_dirty(&transport, &worktree_path))
        .map_err(AppError::from)
}

#[tauri::command]
pub fn delete_branch(
    project_id: String,
    branch_name: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    let project = manager
        .get_project(&project_id)
        .ok_or_else(|| AppError::NotFound(format!("Project not found: {}", project_id)))?;
    let work_dir = project.path.to_string_lossy().to_string();
    let transport = GitTransport::Local;
    let rt = tokio::runtime::Handle::current();
    rt.block_on(operations::delete_branch(
        &transport,
        &work_dir,
        &branch_name,
        true,
    ))
    .map_err(AppError::from)
}

#[tauri::command]
pub fn checkout_branch(
    project_id: String,
    branch_name: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    let project = manager
        .get_project(&project_id)
        .ok_or_else(|| AppError::NotFound(format!("Project not found: {}", project_id)))?;
    let work_dir = project.path.to_string_lossy().to_string();
    let transport = GitTransport::Local;
    let rt = tokio::runtime::Handle::current();
    rt.block_on(operations::checkout_branch(
        &transport,
        &work_dir,
        &branch_name,
    ))
    .map_err(AppError::from)
}

#[tauri::command]
pub fn create_branch(
    project_id: String,
    branch_name: String,
    start_point: Option<String>,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    let project = manager
        .get_project(&project_id)
        .ok_or_else(|| AppError::NotFound(format!("Project not found: {}", project_id)))?;
    let work_dir = project.path.to_string_lossy().to_string();
    let transport = GitTransport::Local;
    let rt = tokio::runtime::Handle::current();
    rt.block_on(operations::create_branch(
        &transport,
        &work_dir,
        &branch_name,
        start_point.as_deref(),
    ))
    .map_err(AppError::from)
}

#[tauri::command]
pub fn rename_branch(
    project_id: String,
    old_name: String,
    new_name: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    let project = manager
        .get_project(&project_id)
        .ok_or_else(|| AppError::NotFound(format!("Project not found: {}", project_id)))?;
    let work_dir = project.path.to_string_lossy().to_string();
    let transport = GitTransport::Local;
    let rt = tokio::runtime::Handle::current();
    rt.block_on(operations::rename_branch(
        &transport,
        &work_dir,
        &old_name,
        &new_name,
    ))
    .map_err(AppError::from)
}

#[tauri::command]
pub fn rename_worktree(
    project_id: String,
    worktree_path: String,
    new_name: String,
    state: State<AppStateWrapper>,
) -> Result<String, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    let project = manager
        .get_project(&project_id)
        .ok_or_else(|| AppError::NotFound(format!("Project not found: {}", project_id)))?;
    let work_dir = project.path.to_string_lossy().to_string();
    let parent = std::path::Path::new(&worktree_path)
        .parent()
        .unwrap_or(std::path::Path::new(&worktree_path));
    let new_path = parent.join(&new_name);
    let new_path_str = new_path.to_string_lossy().to_string();
    let transport = GitTransport::Local;
    let rt = tokio::runtime::Handle::current();
    rt.block_on(operations::rename_worktree(
        &transport,
        &work_dir,
        &worktree_path,
        &new_path_str,
    ))
    .map_err(AppError::from)?;
    Ok(new_path_str)
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

/// 获取变更文件的 diff 统计（仅 additions / deletions），与 get_changed_files 分离。
/// 前端异步懒加载，避免阻塞首次渲染。
#[tauri::command]
pub fn get_changed_files_diff_stats_command(
    project_id: String,
    state: State<AppStateWrapper>,
) -> Result<Vec<FileDiffStats>, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::get_changed_files_diff_stats(&project.path).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

/// 获取 Git 分支信息（轻量级，不含 changed_files）
/// 前端可异步加载，避免阻塞首次渲染。
#[tauri::command]
pub fn get_git_branch_info_command(
    project_id: String,
    state: State<AppStateWrapper>,
) -> Result<crate::models::GitBranchInfo, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::get_git_branch_info(&project.path).map_err(AppError::from)
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
    let project = manager
        .get_project(&project_id)
        .ok_or_else(|| AppError::NotFound(format!("Project not found: {}", project_id)))?;
    let work_dir = project.path.to_string_lossy().to_string();
    let transport = GitTransport::Local;
    let rt = tokio::runtime::Handle::current();
    rt.block_on(operations::stage_files(
        &transport,
        &work_dir,
        &file_paths,
    ))
    .map_err(AppError::from)
}

#[tauri::command]
pub fn unstage_files_command(
    project_id: String,
    file_paths: Vec<String>,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    let project = manager
        .get_project(&project_id)
        .ok_or_else(|| AppError::NotFound(format!("Project not found: {}", project_id)))?;
    let work_dir = project.path.to_string_lossy().to_string();
    let transport = GitTransport::Local;
    let rt = tokio::runtime::Handle::current();
    rt.block_on(operations::unstage_files(
        &transport,
        &work_dir,
        &file_paths,
    ))
    .map_err(AppError::from)
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
    let project = manager
        .get_project(&project_id)
        .ok_or_else(|| AppError::NotFound(format!("Project not found: {}", project_id)))?;
    let work_dir = project.path.to_string_lossy().to_string();
    let transport = GitTransport::Local;
    let rt = tokio::runtime::Handle::current();
    rt.block_on(operations::discard_file(
        &transport,
        &work_dir,
        &file_path,
    ))
    .map_err(AppError::from)
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
    let project = manager
        .get_project(&project_id)
        .ok_or_else(|| AppError::NotFound(format!("Project not found: {}", project_id)))?;
    let work_dir = project.path.to_string_lossy().to_string();
    let transport = GitTransport::Local;
    let rt = tokio::runtime::Handle::current();
    rt.block_on(operations::fetch(&transport, &work_dir))
        .map_err(AppError::from)
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
    let project = manager
        .get_project(&project_id)
        .ok_or_else(|| AppError::NotFound(format!("Project not found: {}", project_id)))?;
    let work_dir = project.path.to_string_lossy().to_string();
    let transport = GitTransport::Local;
    let rt = tokio::runtime::Handle::current();
    rt.block_on(operations::push(&transport, &work_dir, set_upstream))
        .map_err(AppError::from)
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
    let project = manager
        .get_project(&project_id)
        .ok_or_else(|| AppError::NotFound(format!("Project not found: {}", project_id)))?;
    let work_dir = project.path.to_string_lossy().to_string();
    let transport = GitTransport::Local;
    let rt = tokio::runtime::Handle::current();
    rt.block_on(operations::cherry_pick(
        &transport,
        &work_dir,
        &commit_hash,
    ))
    .map_err(AppError::from)
}

#[tauri::command]
pub fn revert_command(
    project_id: String,
    commit_hash: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    let project = manager
        .get_project(&project_id)
        .ok_or_else(|| AppError::NotFound(format!("Project not found: {}", project_id)))?;
    let work_dir = project.path.to_string_lossy().to_string();
    let transport = GitTransport::Local;
    let rt = tokio::runtime::Handle::current();
    rt.block_on(operations::revert(&transport, &work_dir, &commit_hash))
        .map_err(AppError::from)
}

#[tauri::command]
pub fn create_tag_command(
    project_id: String,
    tag_name: String,
    message: Option<String>,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    let project = manager
        .get_project(&project_id)
        .ok_or_else(|| AppError::NotFound(format!("Project not found: {}", project_id)))?;
    let work_dir = project.path.to_string_lossy().to_string();
    let tag_message = message.as_deref().unwrap_or(&tag_name);
    let transport = GitTransport::Local;
    let rt = tokio::runtime::Handle::current();
    rt.block_on(operations::create_tag(
        &transport,
        &work_dir,
        &tag_name,
        tag_message,
    ))
    .map_err(AppError::from)
}

#[tauri::command]
pub fn checkout_detached_command(
    project_id: String,
    commit_hash: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    let project = manager
        .get_project(&project_id)
        .ok_or_else(|| AppError::NotFound(format!("Project not found: {}", project_id)))?;
    let work_dir = project.path.to_string_lossy().to_string();
    let transport = GitTransport::Local;
    let rt = tokio::runtime::Handle::current();
    rt.block_on(operations::checkout_branch(
        &transport,
        &work_dir,
        &commit_hash,
    ))
    .map_err(AppError::from)
}

#[tauri::command]
pub fn create_and_switch_branch_command(
    project_id: String,
    branch_name: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    let project = manager
        .get_project(&project_id)
        .ok_or_else(|| AppError::NotFound(format!("Project not found: {}", project_id)))?;
    let work_dir = project.path.to_string_lossy().to_string();
    let transport = GitTransport::Local;
    let rt = tokio::runtime::Handle::current();
    rt.block_on(operations::create_and_switch_branch(
        &transport,
        &work_dir,
        &branch_name,
    ))
    .map_err(AppError::from)
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
