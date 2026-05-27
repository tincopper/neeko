use serde::Deserialize;

use crate::git::operations;
use crate::git::transport::GitTransport;
use crate::connection::types::AuthMethod;
use crate::project::types::{
    AheadBehind, CommitDetail, CommitEntry, CommitFileChange, CommitResult, FileChange,
    FileDiffStats, GitBranchInfo, GitInfo,
};
use crate::git::types::DiffResult;
use crate::AppError;

#[derive(Debug, Deserialize)]
pub enum GitTransportKind {
    Local {
        project_path: String,
    },
    #[cfg(target_os = "windows")]
    Wsl {
        distro: String,
        project_path: String,
    },
    Remote {
        host: String,
        port: u16,
        username: String,
        auth: AuthMethod,
        project_path: String,
    },
}

fn into_transport_and_dir(kind: &GitTransportKind) -> (GitTransport, &str) {
    match kind {
        GitTransportKind::Local { project_path } => (GitTransport::Local, project_path.as_str()),
        #[cfg(target_os = "windows")]
        GitTransportKind::Wsl {
            distro,
            project_path,
        } => (
            GitTransport::Wsl {
                distro: distro.clone(),
            },
            project_path.as_str(),
        ),
        GitTransportKind::Remote {
            host,
            port,
            username,
            auth,
            project_path,
        } => (
            GitTransport::Remote {
                host: host.clone(),
                port: *port,
                username: username.clone(),
                auth: auth.clone(),
            },
            project_path.as_str(),
        ),
    }
}

// ─── Staging ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn unified_stage_files(
    transport: GitTransportKind,
    file_paths: Vec<String>,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::stage_files(&t, wd, &file_paths)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_unstage_files(
    transport: GitTransportKind,
    file_paths: Vec<String>,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::unstage_files(&t, wd, &file_paths)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_stage_all(transport: GitTransportKind) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::stage_all(&t, wd).await.map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_unstage_all(transport: GitTransportKind) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::unstage_all(&t, wd)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_discard_file(
    transport: GitTransportKind,
    file_path: String,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::discard_file(&t, wd, &file_path)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_discard_all(transport: GitTransportKind) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::discard_all(&t, wd)
        .await
        .map_err(AppError::from)
}

// ─── Remote operations ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn unified_fetch(transport: GitTransportKind) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::fetch(&t, wd).await.map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_pull(transport: GitTransportKind) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::pull(&t, wd).await.map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_push(
    transport: GitTransportKind,
    set_upstream: Option<bool>,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::push(&t, wd, set_upstream.unwrap_or(false))
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_commit_files(
    transport: GitTransportKind,
    file_paths: Vec<String>,
    message: String,
) -> Result<CommitResult, AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::commit_files(&t, wd, &file_paths, &message)
        .await
        .map_err(AppError::from)
}

// ─── Cherry-pick / Revert / Tag ──────────────────────────────────────────────

#[tauri::command]
pub async fn unified_cherry_pick(
    transport: GitTransportKind,
    commit_hash: String,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::cherry_pick(&t, wd, &commit_hash)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_revert(
    transport: GitTransportKind,
    commit_hash: String,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::revert(&t, wd, &commit_hash)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_create_tag(
    transport: GitTransportKind,
    name: String,
    message: String,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::create_tag(&t, wd, &name, &message)
        .await
        .map_err(AppError::from)
}

// ─── Branching ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn unified_checkout_branch(
    transport: GitTransportKind,
    branch_name: String,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::checkout_branch(&t, wd, &branch_name)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_create_branch(
    transport: GitTransportKind,
    branch_name: String,
    start_point: Option<String>,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::create_branch(&t, wd, &branch_name, start_point.as_deref())
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_delete_branch(
    transport: GitTransportKind,
    branch_name: String,
    force: Option<bool>,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::delete_branch(&t, wd, &branch_name, force.unwrap_or(false))
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_rename_branch(
    transport: GitTransportKind,
    old_name: String,
    new_name: String,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::rename_branch(&t, wd, &old_name, &new_name)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_create_and_switch_branch(
    transport: GitTransportKind,
    branch_name: String,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::create_and_switch_branch(&t, wd, &branch_name)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_checkout_detached(
    transport: GitTransportKind,
    commit_hash: String,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::checkout_detached(&t, wd, &commit_hash)
        .await
        .map_err(AppError::from)
}

// ─── Worktree ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn unified_create_worktree(
    transport: GitTransportKind,
    worktree_path: String,
    branch_name: String,
    new_branch: bool,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    // Ensure parent directory exists for local
    if let GitTransportKind::Local { project_path: _ } = &transport {
        if let Some(parent) = std::path::Path::new(&worktree_path).parent() {
            let _ = std::fs::create_dir_all(parent);
        }
    }
    operations::create_worktree(&t, wd, &worktree_path, &branch_name, new_branch)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_remove_worktree(
    transport: GitTransportKind,
    worktree_path: String,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::remove_worktree(&t, wd, &worktree_path)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_rename_worktree(
    transport: GitTransportKind,
    old_path: String,
    new_path: String,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::rename_worktree(&t, wd, &old_path, &new_path)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_is_worktree_dirty(
    transport: GitTransportKind,
    worktree_path: String,
) -> Result<bool, AppError> {
    let (t, _wd) = into_transport_and_dir(&transport);
    operations::is_worktree_dirty(&t, &worktree_path)
        .await
        .map_err(AppError::from)
}

// ─── Info / Read operations ──────────────────────────────────────────────────

#[tauri::command]
pub async fn unified_get_git_info(transport: GitTransportKind) -> Result<GitInfo, AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    if t.supports_git2() {
        let repo = t
            .open_repo(wd)
            .ok_or_else(|| AppError::from(anyhow::anyhow!("Failed to open git repository")))?;
        let branch_info =
            crate::git::local::get_git_branch_info_from_repo(&repo).map_err(AppError::from)?;
        let changed_files =
            crate::git::local::get_changed_files_from_repo(&repo).map_err(AppError::from)?;
        let is_clean = changed_files.is_empty();
        Ok(GitInfo {
            current_branch: branch_info.current_branch,
            branches: branch_info.branches,
            worktrees: branch_info.worktrees,
            changed_files,
            is_clean,
        })
    } else {
        operations::get_git_info_shell(&t, wd)
            .await
            .map_err(AppError::from)
    }
}

#[tauri::command]
pub async fn unified_get_git_branch_info(
    transport: GitTransportKind,
) -> Result<GitBranchInfo, AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    if t.supports_git2() {
        let repo = t
            .open_repo(wd)
            .ok_or_else(|| AppError::from(anyhow::anyhow!("Failed to open git repository")))?;
        crate::git::local::get_git_branch_info_from_repo(&repo).map_err(AppError::from)
    } else {
        operations::get_git_branch_info_shell(&t, wd)
            .await
            .map_err(AppError::from)
    }
}

#[tauri::command]
pub async fn unified_get_worktree_changed_files(
    transport: GitTransportKind,
    worktree_path: String,
) -> Result<Vec<FileChange>, AppError> {
    let (t, _wd) = into_transport_and_dir(&transport);
    if t.supports_git2() {
        let repo = t
            .open_repo(&worktree_path)
            .ok_or_else(|| AppError::from(anyhow::anyhow!("Failed to open git repository")))?;
        crate::git::local::get_changed_files_from_repo(&repo).map_err(AppError::from)
    } else {
        operations::get_worktree_changed_files(&t, &worktree_path)
            .await
            .map_err(AppError::from)
    }
}

#[tauri::command]
pub async fn unified_get_changed_files_diff_stats(
    transport: GitTransportKind,
) -> Result<Vec<FileDiffStats>, AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    if t.supports_git2() {
        let repo_path = std::path::Path::new(wd);
        crate::git::local::get_changed_files_diff_stats(repo_path).map_err(AppError::from)
    } else {
        operations::get_changed_files_diff_stats_local(wd)
            .await
            .map_err(AppError::from)
    }
}

#[tauri::command]
pub async fn unified_get_file_diff(
    transport: GitTransportKind,
    file_path: String,
) -> Result<DiffResult, AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    if t.supports_git2() {
        crate::git::local::get_file_diff(std::path::Path::new(wd), &file_path)
            .map_err(AppError::from)
    } else {
        operations::get_file_diff(&t, wd, &file_path)
            .await
            .map_err(AppError::from)
    }
}

#[tauri::command]
pub async fn unified_is_git_repo(transport: GitTransportKind) -> Result<bool, AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    Ok(t.is_git_repo(wd).await)
}

// ─── Commit log / history ────────────────────────────────────────────────────

#[tauri::command]
pub async fn unified_get_commit_log(
    transport: GitTransportKind,
    count: usize,
    skip: Option<usize>,
) -> Result<Vec<CommitEntry>, AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::get_commit_log(&t, wd, count, skip.unwrap_or(0))
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_get_commit_detail(
    transport: GitTransportKind,
    commit_hash: String,
) -> Result<CommitDetail, AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::get_commit_detail(&t, wd, &commit_hash)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_get_commit_files(
    transport: GitTransportKind,
    commit_hash: String,
) -> Result<Vec<CommitFileChange>, AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::get_commit_files(&t, wd, &commit_hash)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_get_commit_file_diff(
    transport: GitTransportKind,
    commit_hash: String,
    file_path: String,
) -> Result<DiffResult, AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::get_commit_file_diff(&t, wd, &commit_hash, &file_path)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_get_ahead_behind(
    transport: GitTransportKind,
) -> Result<AheadBehind, AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::get_ahead_behind(&t, wd)
        .await
        .map_err(AppError::from)
}

// ─── Default branch ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn unified_default_branch(transport: GitTransportKind) -> Result<String, AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::default_branch(&t, wd)
        .await
        .map_err(AppError::from)
}
