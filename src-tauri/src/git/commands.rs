use crate::common::connection::types::AuthMethod;
use crate::common::git::operations;
use crate::common::git::types::{DiffResult, PushOutcome};
use crate::project::types::{
    AheadBehind, CommitDetail, CommitEntry, CommitFileChange, CommitResult, FileChange,
    FileContent, FileDiffStats, FileNode, GitBranchInfo, GitInfo, PRComment, PRCommit,
    PRFileChange, PRInfo, PRListItem, PRMergeResult, PRReviewComment, PrLabel,
};
use crate::AppError;
use crate::AppStateWrapper;
use tauri::State;

// ─── Staging ─────────────────────────────────────────────────────────────────

/// Stage specific files in the repository.
#[tauri::command]
pub async fn stage_files(
    project_id: String,
    file_paths: Vec<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::stage_files(&*t, &wd, &file_paths)
        .await
        .map_err(AppError::from)
}

/// Unstage specific files in the repository.
#[tauri::command]
pub async fn unstage_files(
    project_id: String,
    file_paths: Vec<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::unstage_files(&*t, &wd, &file_paths)
        .await
        .map_err(AppError::from)
}

/// Stage all changes in the repository.
#[tauri::command]
pub async fn stage_all(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::stage_all(&*t, &wd)
        .await
        .map_err(AppError::from)
}

/// Unstage all changes in the repository.
#[tauri::command]
pub async fn unstage_all(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::unstage_all(&*t, &wd)
        .await
        .map_err(AppError::from)
}

/// Discard changes in a specific file.
#[tauri::command]
pub async fn discard_file(
    project_id: String,
    file_path: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::discard_file(&*t, &wd, &file_path)
        .await
        .map_err(AppError::from)
}

/// Discard all local changes.
#[tauri::command]
pub async fn discard_all(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::discard_all(&*t, &wd)
        .await
        .map_err(AppError::from)
}

// ─── Remote operations ───────────────────────────────────────────────────────

/// Fetch from remote.
#[tauri::command]
pub async fn fetch(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<PushOutcome, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::fetch(&*t, &wd).await.map_err(AppError::from)
}

/// Pull from remote.
#[tauri::command]
pub async fn pull(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<PushOutcome, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::pull(&*t, &wd).await.map_err(AppError::from)
}

/// Push to remote.
#[tauri::command]
pub async fn push(
    project_id: String,
    set_upstream: Option<bool>,
    state: State<'_, AppStateWrapper>,
) -> Result<PushOutcome, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::push(&*t, &wd, set_upstream.unwrap_or(false))
        .await
        .map_err(AppError::from)
}

/// Fetch from remote with authentication.
#[tauri::command]
pub async fn fetch_with_credentials(
    project_id: String,
    username: String,
    password: String,
    state: State<'_, AppStateWrapper>,
) -> Result<PushOutcome, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::fetch_with_credentials(&*t, &wd, &username, &password)
        .await
        .map_err(AppError::from)
}

/// Pull from remote with authentication.
#[tauri::command]
pub async fn pull_with_credentials(
    project_id: String,
    username: String,
    password: String,
    state: State<'_, AppStateWrapper>,
) -> Result<PushOutcome, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::pull_with_credentials(&*t, &wd, &username, &password)
        .await
        .map_err(AppError::from)
}

/// Push to remote with authentication.
#[tauri::command]
pub async fn push_with_credentials(
    project_id: String,
    set_upstream: Option<bool>,
    username: String,
    password: String,
    state: State<'_, AppStateWrapper>,
) -> Result<PushOutcome, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::push_with_credentials(
        &*t,
        &wd,
        set_upstream.unwrap_or(false),
        &username,
        &password,
    )
    .await
    .map_err(AppError::from)
}

/// Commit specific files with a message.
#[tauri::command]
pub async fn commit_files(
    project_id: String,
    file_paths: Vec<String>,
    message: String,
    state: State<'_, AppStateWrapper>,
) -> Result<CommitResult, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::commit_files(&*t, &wd, &file_paths, &message)
        .await
        .map_err(AppError::from)
}

// ─── Cherry-pick / Revert / Tag ──────────────────────────────────────────────

/// Cherry-pick a commit.
#[tauri::command]
pub async fn cherry_pick(
    project_id: String,
    commit_hash: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::cherry_pick(&*t, &wd, &commit_hash)
        .await
        .map_err(AppError::from)
}

/// Revert a commit.
#[tauri::command]
pub async fn revert(
    project_id: String,
    commit_hash: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::revert(&*t, &wd, &commit_hash)
        .await
        .map_err(AppError::from)
}

/// Create a Git tag.
#[tauri::command]
pub async fn create_tag(
    project_id: String,
    name: String,
    message: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::create_tag(&*t, &wd, &name, &message)
        .await
        .map_err(AppError::from)
}

// ─── Branching ───────────────────────────────────────────────────────────────

/// Checkout a branch.
#[tauri::command]
pub async fn checkout_branch(
    project_id: String,
    branch_name: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::checkout_branch(&*t, &wd, &branch_name)
        .await
        .map_err(AppError::from)
}

/// Create a new branch.
#[tauri::command]
pub async fn create_branch(
    project_id: String,
    branch_name: String,
    start_point: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::create_branch(&*t, &wd, &branch_name, start_point.as_deref())
        .await
        .map_err(AppError::from)
}

/// Delete a branch.
#[tauri::command]
pub async fn delete_branch(
    project_id: String,
    branch_name: String,
    force: Option<bool>,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::delete_branch(&*t, &wd, &branch_name, force.unwrap_or(false))
        .await
        .map_err(AppError::from)
}

/// Rename a branch.
#[tauri::command]
pub async fn rename_branch(
    project_id: String,
    old_name: String,
    new_name: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::rename_branch(&*t, &wd, &old_name, &new_name)
        .await
        .map_err(AppError::from)
}

/// Create and switch to a new branch.
#[tauri::command]
pub async fn create_and_switch_branch(
    project_id: String,
    branch_name: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::create_and_switch_branch(&*t, &wd, &branch_name)
        .await
        .map_err(AppError::from)
}

/// Checkout a commit in detached HEAD state.
#[tauri::command]
pub async fn checkout_detached(
    project_id: String,
    commit_hash: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::checkout_detached(&*t, &wd, &commit_hash)
        .await
        .map_err(AppError::from)
}

// ─── Worktree ────────────────────────────────────────────────────────────────

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
    // Ensure parent directory exists (no-op for WSL/Remote)
    if let Some(parent) = std::path::Path::new(&worktree_path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    operations::create_worktree(&*t, &wd, &worktree_path, &branch_name, new_branch)
        .await
        .map_err(AppError::from)
}

/// Remove a Git worktree.
#[tauri::command]
pub async fn remove_worktree(
    project_id: String,
    worktree_path: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::remove_worktree(&*t, &wd, &worktree_path)
        .await
        .map_err(AppError::from)
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
    operations::rename_worktree(&*t, &wd, &old_path, &new_path)
        .await
        .map_err(AppError::from)
}

/// Check if a worktree has uncommitted changes.
#[tauri::command]
pub async fn is_worktree_dirty(
    project_id: String,
    worktree_path: String,
    state: State<'_, AppStateWrapper>,
) -> Result<bool, AppError> {
    let (t, _wd) = state.resolve_project(&project_id)?;
    operations::is_worktree_dirty(&*t, &worktree_path)
        .await
        .map_err(AppError::from)
}

// ─── Info / Read operations ──────────────────────────────────────────────────

/// Get repository information.
#[tauri::command]
pub async fn get_git_info(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<GitInfo, AppError> {
    let (backend, wd) = state.resolve_project(&project_id)?;
    operations::get_git_info(&*backend, &wd)
        .await
        .map_err(AppError::from)
}

/// Get branch information.
#[tauri::command]
pub async fn get_git_branch_info(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<GitBranchInfo, AppError> {
    let (backend, wd) = state.resolve_project(&project_id)?;
    operations::get_git_branch_info(&*backend, &wd)
        .await
        .map_err(AppError::from)
}

/// Get changed files in a worktree.
#[tauri::command]
pub async fn get_worktree_changed_files(
    project_id: String,
    worktree_path: String,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<FileChange>, AppError> {
    let (backend, wd) = state.resolve_project(&project_id)?;
    // When worktree_path is empty, use the main project path
    let repo_path = if worktree_path.is_empty() {
        &wd
    } else {
        &worktree_path
    };
    operations::get_worktree_changed_files(&*backend, repo_path)
        .await
        .map_err(AppError::from)
}

/// Get diff statistics for changed files.
#[tauri::command]
pub async fn get_changed_files_diff_stats(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<FileDiffStats>, AppError> {
    let (backend, wd) = state.resolve_project(&project_id)?;
    operations::get_changed_files_diff_stats(&*backend, &wd)
        .await
        .map_err(AppError::from)
}

/// Get the diff for a specific file.
#[tauri::command]
pub async fn get_file_diff(
    project_id: String,
    file_path: String,
    state: State<'_, AppStateWrapper>,
) -> Result<DiffResult, AppError> {
    let t0 = std::time::Instant::now();
    let (backend, wd) = state.resolve_project(&project_id)?;
    let result = operations::get_file_diff(&*backend, &wd, &file_path)
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

// ─── Commit log / history ────────────────────────────────────────────────────

/// Get the commit log.
#[tauri::command]
pub async fn get_commit_log(
    project_id: String,
    count: usize,
    skip: Option<usize>,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<CommitEntry>, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::get_commit_log(&*t, &wd, count, skip.unwrap_or(0))
        .await
        .map_err(AppError::from)
}

/// Get details for a specific commit.
#[tauri::command]
pub async fn get_commit_detail(
    project_id: String,
    commit_hash: String,
    state: State<'_, AppStateWrapper>,
) -> Result<CommitDetail, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::get_commit_detail(&*t, &wd, &commit_hash)
        .await
        .map_err(AppError::from)
}

/// Get files changed in a commit.
#[tauri::command]
pub async fn get_commit_files(
    project_id: String,
    commit_hash: String,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<CommitFileChange>, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::get_commit_files(&*t, &wd, &commit_hash)
        .await
        .map_err(AppError::from)
}

/// Get the diff for a file in a commit.
#[tauri::command]
pub async fn get_commit_file_diff(
    project_id: String,
    commit_hash: String,
    file_path: String,
    state: State<'_, AppStateWrapper>,
) -> Result<DiffResult, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::get_commit_file_diff(&*t, &wd, &commit_hash, &file_path)
        .await
        .map_err(AppError::from)
}

/// Get ahead/behind counts for the current branch.
#[tauri::command]
pub async fn get_ahead_behind(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<AheadBehind, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::get_ahead_behind(&*t, &wd)
        .await
        .map_err(AppError::from)
}

// ─── Default branch ──────────────────────────────────────────────────────────

/// Get the default branch name.
#[tauri::command]
pub async fn default_branch(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<String, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::default_branch(&*t, &wd)
        .await
        .map_err(AppError::from)
}

// ─── File operations (unified via file service) ────────────────────────────

/// 文件树默认递归深度
/// Default maximum depth for directory tree traversal.
const DEFAULT_TREE_DEPTH: u32 = 4;

/// Read the directory tree.
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
    let target = t.exec_target();
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
    let target = t.exec_target();
    let base = root_path.unwrap_or(wd);
    crate::common::file::services::read_file_content(&target, &base, &file_path).await
}

/// Write file content.
#[tauri::command]
pub async fn write_file_content(
    project_id: String,
    file_path: String,
    content: String,
    root_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let target = t.exec_target();
    let base = root_path.unwrap_or(wd);
    crate::common::file::services::write_file_content(&target, &base, &file_path, &content).await
}

// ─── Remote/SSH utilities ───────────────────────────────────────────────────

/// Get the home directory on a remote host.
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
    let wd_path = std::path::Path::new(&wd);
    let target = t.exec_target();
    crate::git::list_prs(wd_path, &target, &state, limit)
        .await
        .map_err(|e| AppError::Git(e.to_string()))
}

/// List repository labels.
#[tauri::command]
pub async fn list_repo_labels_command(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<PrLabel>, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let wd_path = std::path::Path::new(&wd);
    let target = t.exec_target();
    crate::git::list_repo_labels(wd_path, &target)
        .await
        .map_err(|e| AppError::Git(e.to_string()))
}

/// List repository authors.
#[tauri::command]
pub async fn list_repo_authors_command(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<String>, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let wd_path = std::path::Path::new(&wd);
    let target = t.exec_target();
    crate::git::list_repo_authors(wd_path, &target)
        .await
        .map_err(|e| AppError::Git(e.to_string()))
}

/// View pull request details.
#[tauri::command]
pub async fn view_pr_command(
    project_id: String,
    pr_number: u64,
    state: State<'_, AppStateWrapper>,
) -> Result<PRInfo, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let wd_path = std::path::Path::new(&wd);
    let target = t.exec_target();
    crate::git::view_pr(wd_path, &target, pr_number)
        .await
        .map_err(|e| AppError::Git(e.to_string()))
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
    let wd_path = std::path::Path::new(&wd);
    let target = t.exec_target();
    crate::git::create_pr(wd_path, &target, &title, &body, base.as_deref(), draft)
        .await
        .map_err(|e| AppError::Git(e.to_string()))
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
    let wd_path = std::path::Path::new(&wd);
    let target = t.exec_target();
    crate::git::merge_pr(wd_path, &target, pr_number, &method)
        .await
        .map_err(|e| AppError::Git(e.to_string()))
}

/// Close a pull request.
#[tauri::command]
pub async fn close_pr_command(
    project_id: String,
    pr_number: u64,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let wd_path = std::path::Path::new(&wd);
    let target = t.exec_target();
    crate::git::close_pr(wd_path, &target, pr_number)
        .await
        .map_err(|e| AppError::Git(e.to_string()))
}

/// List files changed in a pull request.
#[tauri::command]
pub async fn list_pr_files_command(
    project_id: String,
    pr_number: u64,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<PRFileChange>, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let wd_path = std::path::Path::new(&wd);
    let target = t.exec_target();
    crate::git::list_pr_files(wd_path, &target, pr_number)
        .await
        .map_err(|e| AppError::Git(e.to_string()))
}

/// List commits in a pull request.
#[tauri::command]
pub async fn list_pr_commits_command(
    project_id: String,
    pr_number: u64,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<PRCommit>, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let wd_path = std::path::Path::new(&wd);
    let target = t.exec_target();
    crate::git::list_pr_commits(wd_path, &target, pr_number)
        .await
        .map_err(|e| AppError::Git(e.to_string()))
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
    let wd_path = std::path::Path::new(&wd);
    let target = t.exec_target();
    crate::git::add_pr_review_comment(wd_path, &target, pr_number, &body, &file_path, line, &side)
        .await
        .map_err(|e| AppError::Git(e.to_string()))
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
    let wd_path = std::path::Path::new(&wd);
    let target = t.exec_target();
    let result = crate::git::list_pr_review_comments(wd_path, &target, pr_number)
        .await
        .map_err(|e| AppError::Git(e.to_string()))?;
    log::debug!(
        "[perf] Rust list_pr_review_comments: PR #{} {}ms",
        pr_number,
        t0.elapsed().as_millis()
    );
    Ok(result)
}

// ─── PR Comment Commands ────────────────────────────────────────────────────

/// List comments on a pull request.
#[tauri::command]
pub async fn list_pr_comments_command(
    project_id: String,
    pr_number: u64,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<PRComment>, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let wd_path = std::path::Path::new(&wd);
    let target = t.exec_target();
    crate::git::list_pr_comments(wd_path, &target, pr_number)
        .await
        .map_err(|e| AppError::Git(e.to_string()))
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
    let wd_path = std::path::Path::new(&wd);
    let target = t.exec_target();
    crate::git::add_pr_comment(wd_path, &target, pr_number, &body)
        .await
        .map_err(|e| AppError::Git(e.to_string()))
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
    let wd_path = std::path::Path::new(&wd);
    let target = t.exec_target();
    crate::git::edit_pr_comment(wd_path, &target, pr_number, &comment_id, &body)
        .await
        .map_err(|e| AppError::Git(e.to_string()))
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
    let wd_path = std::path::Path::new(&wd);
    let target = t.exec_target();
    crate::git::delete_pr_comment(wd_path, &target, pr_number, &comment_id)
        .await
        .map_err(|e| AppError::Git(e.to_string()))
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
    let wd_path = std::path::Path::new(&wd);
    let target = t.exec_target();
    crate::git::add_comment_reaction(wd_path, &target, pr_number, &comment_id, &emoji)
        .await
        .map_err(|e| AppError::Git(e.to_string()))
}
