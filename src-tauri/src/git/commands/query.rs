#![allow(unused_imports, missing_docs)]

use crate::common::git::operations;
use crate::common::git::path_guard::{resolve_validated_work_dir, validate_repo_relative_path};
use crate::common::git::transport::GitTransport;
use crate::common::git::types::DiffResult;
use crate::project::types::{FileChange, FileDiffStats, GitBranchInfo, GitInfo};
use crate::AppError;
use crate::AppStateWrapper;
use tauri::State;

/// Get repository information.
#[tauri::command]
pub async fn get_git_info(
    project_id: String,
    worktree_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<GitInfo, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let repo_path = resolve_validated_work_dir(&t, &worktree_path, &wd)?;
    let mut info = operations::get_git_info(&t, repo_path)
        .await
        .map_err(AppError::from)?;
    // G2 单一权威化：主路径（未指定 worktree）且有权威快照时，changed_files 一律
    // 以快照为准（CLI porcelain 唯一计算路径），避免 libgit2 第二套 status 的
    // 全量结果覆盖更新的快照事件（P1 跨源覆盖残留）。
    if worktree_path.as_deref().unwrap_or("").is_empty() {
        if let Some(snap) = state.watcher_manager.snapshot(&project_id) {
            info.changed_files = snap.entries.clone();
        }
    }
    Ok(info)
}

/// Get branch information.
#[tauri::command]
pub async fn get_git_branch_info(
    project_id: String,
    worktree_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<GitBranchInfo, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let repo_path = resolve_validated_work_dir(&t, &worktree_path, &wd)?;
    operations::get_git_branch_info(&t, repo_path)
        .await
        .map_err(AppError::from)
}

/// Changed-file query result（G2 D2 收编）：`version=0` 表示无 versioned 快照语义
/// （WSL/SSH / worktree 兜底），前端只在 `version>0` 时做 version gate。
#[derive(Debug, Clone, serde::Serialize)]
pub struct ChangedFilesPayload {
    pub files: Vec<FileChange>,
    pub version: u64,
}

/// Get changed files in a worktree.
///
/// G2 D2 收编：主路径（空 worktree_path）且已有权威快照 → 直接读 watcher 快照
/// （CLI porcelain 唯一计算路径的产物，与 git-status-snapshot 事件同源同版本），
/// 不再跑第二套 libgit2 status。worktree / WSL / SSH（watcher 不挂）走原 transport
/// 兜底（version=0）。
#[tauri::command]
pub async fn get_worktree_changed_files(
    project_id: String,
    worktree_path: String,
    state: State<'_, AppStateWrapper>,
) -> Result<ChangedFilesPayload, AppError> {
    if worktree_path.is_empty() {
        if let Some(snap) = state.watcher_manager.snapshot(&project_id) {
            log::debug!(
                "[GitWorker] get_worktree_changed_files({}) served from snapshot v{} ({} entries)",
                project_id,
                snap.version,
                snap.entries.len()
            );
            return Ok(ChangedFilesPayload {
                files: snap.entries.clone(),
                version: snap.version,
            });
        }
    }
    let (t, wd) = state.resolve_project(&project_id)?;
    // 空串视为未指定 worktree（回落项目根），并校验非空路径
    let wt = Some(worktree_path);
    let repo_path = resolve_validated_work_dir(&t, &wt, &wd)?;
    let files = operations::get_worktree_changed_files(&t, repo_path)
        .await
        .map_err(AppError::from)?;
    Ok(ChangedFilesPayload { files, version: 0 })
}

/// List untracked files under a directory (expands a collapsed untracked-dir
/// entry shown in the changes list). Returns an error when the path is not a
/// git repository; the UI expand handler catches it.
#[tauri::command]
pub async fn get_untracked_files(
    project_id: String,
    worktree_path: String,
    dir_path: String,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<String>, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    // 空串视为未指定 worktree（回落项目根），并校验非空路径
    let wt = Some(worktree_path);
    let repo_path = resolve_validated_work_dir(&t, &wt, &wd)?;
    validate_repo_relative_path(&t, repo_path, &dir_path)?;
    operations::get_untracked_files(&t, repo_path, &dir_path)
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
    let (t, wd) = state.resolve_project(&project_id)?;
    let repo_path = resolve_validated_work_dir(&t, &worktree_path, &wd)?;
    operations::get_changed_files_diff_stats(&t, repo_path)
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
    let (t, wd) = state.resolve_project(&project_id)?;
    let repo_path = resolve_validated_work_dir(&t, &worktree_path, &wd)?;
    validate_repo_relative_path(&t, repo_path, &file_path)?;
    let collapse = collapse.unwrap_or(true);
    let result = operations::get_file_diff(&t, repo_path, &file_path, collapse)
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
