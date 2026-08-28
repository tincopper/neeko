#![allow(unused_imports, missing_docs)]

use std::path::Path;

use crate::project::types::{
    PRComment, PRCommit, PRFileChange, PRInfo, PRListItem, PRMergeResult, PRReviewComment, PrLabel,
};
use crate::AppError;
use crate::AppStateWrapper;
use tauri::State;

/// PR/gh CLI 错误统一映射（曾以 `AppError::Git(e.to_string())` 复制 16 处，
/// 且丢失 transport.rs `classify_stderr` 的错误分类成果）：
/// `GitExecError` 保留 kind 分类（auth/network/ambiguous/…），其余保留原始消息。
fn map_git_err(e: anyhow::Error) -> AppError {
    match e.downcast_ref::<crate::common::git::transport::GitExecError>() {
        Some(ge) => AppError::Git(format!("{:?}: {}", ge.kind, ge)),
        None => AppError::Git(e.to_string()),
    }
}

/// Check if GitHub CLI is installed.
#[tauri::command]
pub async fn is_gh_installed_command() -> bool {
    crate::git::is_gh_installed().await
}

/// Check if GitHub CLI is authenticated.
#[tauri::command]
pub async fn is_gh_authenticated_command() -> bool {
    crate::git::is_gh_authenticated().await
}

/// List pull requests.
#[tauri::command]
pub async fn list_prs_command(
    project_id: String,
    state: String,
    limit: usize,
    state_w: State<'_, AppStateWrapper>,
) -> Result<Vec<PRListItem>, AppError> {
    let (t, wd) = state_w.resolve_project(&project_id)?;
    crate::git::list_prs(Path::new(&wd), &t, &state, limit)
        .await
        .map_err(map_git_err)
}

/// List repository labels.
#[tauri::command]
pub async fn list_repo_labels_command(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<PrLabel>, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    crate::git::list_repo_labels(Path::new(&wd), &t)
        .await
        .map_err(map_git_err)
}

/// List repository authors.
#[tauri::command]
pub async fn list_repo_authors_command(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<String>, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    crate::git::list_repo_authors(Path::new(&wd), &t)
        .await
        .map_err(map_git_err)
}

/// View pull request details.
#[tauri::command]
pub async fn view_pr_command(
    project_id: String,
    pr_number: u64,
    state: State<'_, AppStateWrapper>,
) -> Result<PRInfo, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    crate::git::view_pr(Path::new(&wd), &t, pr_number)
        .await
        .map_err(map_git_err)
}

/// Create a pull request.
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
    crate::git::create_pr(Path::new(&wd), &t, &title, &body, base.as_deref(), draft)
        .await
        .map_err(map_git_err)
}

/// Merge a pull request.
#[tauri::command]
pub async fn merge_pr_command(
    project_id: String,
    pr_number: u64,
    method: String,
    state: State<'_, AppStateWrapper>,
) -> Result<PRMergeResult, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    crate::git::merge_pr(Path::new(&wd), &t, pr_number, &method)
        .await
        .map_err(map_git_err)
}

/// Close a pull request.
#[tauri::command]
pub async fn close_pr_command(
    project_id: String,
    pr_number: u64,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    crate::git::close_pr(Path::new(&wd), &t, pr_number)
        .await
        .map_err(map_git_err)
}

/// List files changed in a pull request.
#[tauri::command]
pub async fn list_pr_files_command(
    project_id: String,
    pr_number: u64,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<PRFileChange>, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    crate::git::list_pr_files(Path::new(&wd), &t, pr_number)
        .await
        .map_err(map_git_err)
}

/// List commits in a pull request.
#[tauri::command]
pub async fn list_pr_commits_command(
    project_id: String,
    pr_number: u64,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<PRCommit>, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    crate::git::list_pr_commits(Path::new(&wd), &t, pr_number)
        .await
        .map_err(map_git_err)
}

/// Add a review comment on a pull request.
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
    crate::git::add_pr_review_comment(
        Path::new(&wd),
        &t,
        pr_number,
        &body,
        &file_path,
        line,
        &side,
    )
    .await
    .map_err(map_git_err)
}

/// List review comments on a pull request.
#[tauri::command]
pub async fn list_pr_review_comments_command(
    project_id: String,
    pr_number: u64,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<PRReviewComment>, AppError> {
    let t0 = std::time::Instant::now();
    let (t, wd) = state.resolve_project(&project_id)?;
    let result = crate::git::list_pr_review_comments(Path::new(&wd), &t, pr_number)
        .await
        .map_err(map_git_err)?;
    log::debug!(
        "[perf] Rust list_pr_review_comments: PR #{} {}ms",
        pr_number,
        t0.elapsed().as_millis()
    );
    Ok(result)
}

/// List comments on a pull request.
#[tauri::command]
pub async fn list_pr_comments_command(
    project_id: String,
    pr_number: u64,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<PRComment>, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    crate::git::list_pr_comments(Path::new(&wd), &t, pr_number)
        .await
        .map_err(map_git_err)
}

/// Add a comment to a pull request.
#[tauri::command]
pub async fn add_pr_comment_command(
    project_id: String,
    pr_number: u64,
    body: String,
    state: State<'_, AppStateWrapper>,
) -> Result<PRComment, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    crate::git::add_pr_comment(Path::new(&wd), &t, pr_number, &body)
        .await
        .map_err(map_git_err)
}

/// Edit a comment on a pull request.
#[tauri::command]
pub async fn edit_pr_comment_command(
    project_id: String,
    pr_number: u64,
    comment_id: String,
    body: String,
    state: State<'_, AppStateWrapper>,
) -> Result<PRComment, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    crate::git::edit_pr_comment(Path::new(&wd), &t, pr_number, &comment_id, &body)
        .await
        .map_err(map_git_err)
}

/// Delete a comment on a pull request.
#[tauri::command]
pub async fn delete_pr_comment_command(
    project_id: String,
    pr_number: u64,
    comment_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    crate::git::delete_pr_comment(Path::new(&wd), &t, pr_number, &comment_id)
        .await
        .map_err(map_git_err)
}

/// Add a reaction to a comment.
#[tauri::command]
pub async fn add_comment_reaction_command(
    project_id: String,
    pr_number: u64,
    comment_id: String,
    emoji: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    crate::git::add_comment_reaction(Path::new(&wd), &t, pr_number, &comment_id, &emoji)
        .await
        .map_err(map_git_err)
}
