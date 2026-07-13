use serde::Deserialize;

use crate::common::connection::types::AuthMethod;
use crate::common::git::operations;
use crate::common::git::transport::GitTransport;
use crate::common::git::types::{DiffResult, PushOutcome};
use crate::project::types::{
    AheadBehind, CommitDetail, CommitEntry, CommitFileChange, CommitResult, FileChange,
    FileContent, FileDiffStats, FileNode, GitBranchInfo, GitInfo, PRComment, PRCommit,
    PRFileChange, PRInfo, PRListItem, PRMergeResult, PRReviewComment, PrLabel,
};
use crate::AppError;
use crate::AppStateWrapper;
use tauri::State;

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

/// Transport for file operations and commit message generation (Local + WSL + Remote).
#[derive(Debug, Deserialize)]
pub enum FileTransportKind {
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
pub async fn stage_files(
    transport: GitTransportKind,
    file_paths: Vec<String>,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::stage_files(&t, wd, &file_paths)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unstage_files(
    transport: GitTransportKind,
    file_paths: Vec<String>,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::unstage_files(&t, wd, &file_paths)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn stage_all(transport: GitTransportKind) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::stage_all(&t, wd).await.map_err(AppError::from)
}

#[tauri::command]
pub async fn unstage_all(transport: GitTransportKind) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::unstage_all(&t, wd)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn discard_file(transport: GitTransportKind, file_path: String) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::discard_file(&t, wd, &file_path)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn discard_all(transport: GitTransportKind) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::discard_all(&t, wd)
        .await
        .map_err(AppError::from)
}

// ─── Remote operations ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn fetch(transport: GitTransportKind) -> Result<PushOutcome, AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::fetch(&t, wd).await.map_err(AppError::from)
}

#[tauri::command]
pub async fn pull(transport: GitTransportKind) -> Result<PushOutcome, AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::pull(&t, wd).await.map_err(AppError::from)
}

#[tauri::command]
pub async fn push(
    transport: GitTransportKind,
    set_upstream: Option<bool>,
) -> Result<PushOutcome, AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::push(&t, wd, set_upstream.unwrap_or(false))
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn fetch_with_credentials(
    transport: GitTransportKind,
    username: String,
    password: String,
) -> Result<PushOutcome, AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::fetch_with_credentials(&t, wd, &username, &password)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn pull_with_credentials(
    transport: GitTransportKind,
    username: String,
    password: String,
) -> Result<PushOutcome, AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::pull_with_credentials(&t, wd, &username, &password)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn push_with_credentials(
    transport: GitTransportKind,
    set_upstream: Option<bool>,
    username: String,
    password: String,
) -> Result<PushOutcome, AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::push_with_credentials(&t, wd, set_upstream.unwrap_or(false), &username, &password)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn commit_files(
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
pub async fn cherry_pick(transport: GitTransportKind, commit_hash: String) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::cherry_pick(&t, wd, &commit_hash)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn revert(transport: GitTransportKind, commit_hash: String) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::revert(&t, wd, &commit_hash)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn create_tag(
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
pub async fn checkout_branch(
    transport: GitTransportKind,
    branch_name: String,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::checkout_branch(&t, wd, &branch_name)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn create_branch(
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
pub async fn delete_branch(
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
pub async fn rename_branch(
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
pub async fn create_and_switch_branch(
    transport: GitTransportKind,
    branch_name: String,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::create_and_switch_branch(&t, wd, &branch_name)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn checkout_detached(
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
pub async fn create_worktree(
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
pub async fn remove_worktree(
    transport: GitTransportKind,
    worktree_path: String,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::remove_worktree(&t, wd, &worktree_path)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn rename_worktree(
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
pub async fn is_worktree_dirty(
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
pub async fn get_git_info(transport: GitTransportKind) -> Result<GitInfo, AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    if t.supports_git2() {
        let repo = t
            .open_repo(wd)
            .ok_or_else(|| AppError::from(anyhow::anyhow!("Failed to open git repository")))?;
        let branch_info = crate::common::git::local::get_git_branch_info_from_repo(&repo)
            .map_err(AppError::from)?;
        let changed_files = crate::common::git::local::get_changed_files_from_repo(&repo)
            .map_err(AppError::from)?;
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
pub async fn get_git_branch_info(transport: GitTransportKind) -> Result<GitBranchInfo, AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    if t.supports_git2() {
        let repo = t
            .open_repo(wd)
            .ok_or_else(|| AppError::from(anyhow::anyhow!("Failed to open git repository")))?;
        crate::common::git::local::get_git_branch_info_from_repo(&repo).map_err(AppError::from)
    } else {
        operations::get_git_branch_info_shell(&t, wd)
            .await
            .map_err(AppError::from)
    }
}

#[tauri::command]
pub async fn get_worktree_changed_files(
    transport: GitTransportKind,
    worktree_path: String,
) -> Result<Vec<FileChange>, AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    // When worktree_path is empty, use the main project path
    let repo_path = if worktree_path.is_empty() {
        wd
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
    transport: GitTransportKind,
) -> Result<Vec<FileDiffStats>, AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    if t.supports_git2() {
        let repo_path = std::path::Path::new(wd);
        crate::common::git::local::get_changed_files_diff_stats(repo_path).map_err(AppError::from)
    } else {
        operations::get_changed_files_diff_stats_local(wd)
            .await
            .map_err(AppError::from)
    }
}

#[tauri::command]
pub async fn get_file_diff(
    transport: GitTransportKind,
    file_path: String,
) -> Result<DiffResult, AppError> {
    let t0 = std::time::Instant::now();
    let (t, wd) = into_transport_and_dir(&transport);
    let result = if t.supports_git2() {
        crate::common::git::local::get_file_diff(std::path::Path::new(wd), &file_path)
            .map_err(AppError::from)
    } else {
        operations::get_file_diff(&t, wd, &file_path)
            .await
            .map_err(AppError::from)
    };
    let elapsed_ms = t0.elapsed().as_millis();
    log::debug!("[perf] Rust get_file_diff: {} {}ms", file_path, elapsed_ms);
    result
}

#[tauri::command]
pub async fn is_git_repo(transport: GitTransportKind) -> Result<bool, AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    Ok(t.is_git_repo(wd).await)
}

// ─── Commit log / history ────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_commit_log(
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
pub async fn get_commit_detail(
    transport: GitTransportKind,
    commit_hash: String,
) -> Result<CommitDetail, AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::get_commit_detail(&t, wd, &commit_hash)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn get_commit_files(
    transport: GitTransportKind,
    commit_hash: String,
) -> Result<Vec<CommitFileChange>, AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::get_commit_files(&t, wd, &commit_hash)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn get_commit_file_diff(
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
pub async fn get_ahead_behind(transport: GitTransportKind) -> Result<AheadBehind, AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::get_ahead_behind(&t, wd)
        .await
        .map_err(AppError::from)
}

// ─── Default branch ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn default_branch(transport: GitTransportKind) -> Result<String, AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::default_branch(&t, wd)
        .await
        .map_err(AppError::from)
}

// ─── File operations (unified Remote + WSL) ─────────────────────────────────

/// 文件树默认递归深度
const DEFAULT_TREE_DEPTH: u32 = 4;

#[tauri::command]
pub async fn read_dir_tree(
    transport: FileTransportKind,
    root_path: Option<String>,
    sub_path: Option<String>,
    max_depth: Option<u32>,
) -> Result<Vec<FileNode>, AppError> {
    let depth = max_depth.unwrap_or(DEFAULT_TREE_DEPTH);
    match transport {
        FileTransportKind::Local { project_path } => {
            let base = std::path::PathBuf::from(root_path.unwrap_or(project_path));
            tokio::task::spawn_blocking(move || {
                crate::common::file::services::read_dir_tree(&base, sub_path.as_deref(), depth)
            })
            .await
            .map_err(|e| AppError::InvalidInput(format!("Task join error: {}", e)))?
            .map_err(AppError::from)
        }
        #[cfg(target_os = "windows")]
        FileTransportKind::Wsl {
            distro,
            project_path,
        } => {
            let base = root_path.unwrap_or(project_path);
            tokio::task::spawn_blocking(move || {
                crate::common::git::wsl_read_dir_tree(&distro, &base, sub_path.as_deref(), depth)
            })
            .await
            .map_err(|e| AppError::InvalidInput(format!("Task join error: {}", e)))?
            .map_err(AppError::from)
        }
        FileTransportKind::Remote {
            host,
            port,
            username,
            auth,
            project_path,
        } => {
            let base = root_path.unwrap_or(project_path);
            crate::common::git::remote::remote_read_dir_tree_fn(
                &host,
                port,
                &username,
                &auth,
                &base,
                sub_path.as_deref(),
                depth,
            )
            .await
            .map_err(AppError::from)
        }
    }
}

/// Shared implementation for reading file content via shell (stat -> binary-detect -> cat).
/// Works for both Remote (SSH) and WSL transports.
async fn read_file_content_shell(
    full_path: &str,
    file_path: String,
    #[cfg(target_os = "windows")] distro: &str,
    #[cfg(not(target_os = "windows"))] _distro: &str,
    host: Option<(&str, u16, &str, &AuthMethod)>,
) -> Result<FileContent, AppError> {
    let safe_fp = crate::common::utils::command::local::safe_path(full_path);

    // 文件大小
    let stat_cmd = format!("stat -c '%s' '{safe_fp}' 2>/dev/null || echo 0");
    let size: u64 = if let Some((h, p, u, a)) = &host {
        crate::common::utils::command::ssh::exec_command(h, *p, u, a, &stat_cmd)
            .await
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(0)
    } else {
        #[cfg(target_os = "windows")]
        {
            tokio::task::spawn_blocking({
                let d = distro.to_string();
                let c = stat_cmd.clone();
                move || crate::common::utils::command::wsl::exec(&d, &c)
            })
            .await
            .map_err(|e| AppError::InvalidInput(format!("Task join error: {}", e)))?
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(0)
        }
        #[cfg(not(target_os = "windows"))]
        {
            0
        }
    };

    // 二进制检测
    let binary_cmd =
        format!("head -c 8192 '{safe_fp}' | grep -ql '\\x00' 2>/dev/null && echo 1 || echo 0");
    let is_binary = if let Some((h, p, u, a)) = &host {
        crate::common::utils::command::ssh::exec_command(h, *p, u, a, &binary_cmd)
            .await
            .map(|out| out.trim() == "1")
            .unwrap_or(false)
    } else {
        #[cfg(target_os = "windows")]
        {
            tokio::task::spawn_blocking({
                let d = distro.to_string();
                let c = binary_cmd.clone();
                move || crate::common::utils::command::wsl::exec(&d, &c)
            })
            .await
            .map_err(|e| AppError::InvalidInput(format!("Task join error: {}", e)))?
            .map(|out| out.trim() == "1")
            .unwrap_or(false)
        }
        #[cfg(not(target_os = "windows"))]
        {
            false
        }
    };

    if is_binary {
        return Ok(FileContent {
            path: file_path,
            content: String::new(),
            size,
            is_binary: true,
        });
    }

    // 读取文件内容
    let cat_cmd = format!("cat '{safe_fp}'");
    let content = if let Some((h, p, u, a)) = &host {
        crate::common::utils::command::ssh::exec_command(h, *p, u, a, &cat_cmd)
            .await
            .map_err(AppError::from)?
    } else {
        #[cfg(target_os = "windows")]
        {
            tokio::task::spawn_blocking({
                let d = distro.to_string();
                let c = cat_cmd.clone();
                move || crate::common::utils::command::wsl::exec(&d, &c)
            })
            .await
            .map_err(|e| AppError::InvalidInput(format!("Task join error: {}", e)))?
            .map_err(AppError::from)?
        }
        #[cfg(not(target_os = "windows"))]
        {
            return Err(AppError::Wsl("WSL is only supported on Windows".into()));
        }
    };

    Ok(FileContent {
        path: file_path,
        content,
        size,
        is_binary: false,
    })
}

#[tauri::command]
pub async fn read_file_content(
    transport: FileTransportKind,
    file_path: String,
    root_path: Option<String>,
) -> Result<FileContent, AppError> {
    match &transport {
        FileTransportKind::Local { project_path } => {
            let base = std::path::PathBuf::from(root_path.unwrap_or_else(|| project_path.clone()));
            let base = Box::new(base);
            let fp = file_path.clone();
            tokio::task::spawn_blocking(move || {
                crate::common::file::services::read_file_content(&base, &fp)
            })
            .await
            .map_err(|e| AppError::InvalidInput(format!("Task join error: {}", e)))?
            .map_err(AppError::from)
        }
        #[cfg(target_os = "windows")]
        FileTransportKind::Wsl {
            distro,
            project_path,
        } => {
            let base = root_path.unwrap_or_else(|| project_path.clone());
            let full_path = format!("{}/{}", base, file_path);
            read_file_content_shell(&full_path, file_path, distro, None).await
        }
        FileTransportKind::Remote {
            host,
            port,
            username,
            auth,
            project_path,
        } => {
            let base = root_path.unwrap_or_else(|| project_path.clone());
            let full_path = format!("{}/{}", base, file_path);
            read_file_content_shell(
                &full_path,
                file_path,
                #[cfg(target_os = "windows")]
                "",
                #[cfg(not(target_os = "windows"))]
                "",
                Some((host, *port, username, auth)),
            )
            .await
        }
    }
}

#[tauri::command]
pub async fn write_file_content(
    transport: FileTransportKind,
    file_path: String,
    content: String,
    root_path: Option<String>,
) -> Result<(), AppError> {
    match transport {
        FileTransportKind::Local { project_path } => {
            let base = std::path::PathBuf::from(root_path.unwrap_or(project_path));
            let base = Box::new(base);
            let fp = file_path.clone();
            let c = content.clone();
            tokio::task::spawn_blocking(move || {
                crate::common::file::services::write_file_content(&base, &fp, &c)
            })
            .await
            .map_err(|e| AppError::InvalidInput(format!("Task join error: {}", e)))?
            .map_err(AppError::from)
        }
        #[cfg(target_os = "windows")]
        FileTransportKind::Wsl {
            distro,
            project_path,
        } => {
            let base = root_path.unwrap_or(project_path);
            let full_path = format!("{}/{}", base, file_path);
            let safe_fp = crate::common::utils::command::local::safe_path(&full_path);

            // 确保父目录存在
            if let Some(parent) = std::path::Path::new(&full_path).parent() {
                let safe_parent =
                    crate::common::utils::command::local::safe_path(parent.to_str().unwrap_or(""));
                let mkdir_cmd = format!("mkdir -p '{safe_parent}'");
                let d = distro.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    crate::common::utils::command::wsl::exec(&d, &mkdir_cmd)
                })
                .await
                .map_err(|e| AppError::InvalidInput(format!("Task join error: {}", e)))?;
            }

            // 使用 base64 编码传输，避免 shell 转义问题（与 Remote 统一）
            use base64::Engine;
            let encoded = base64::engine::general_purpose::STANDARD.encode(content.as_bytes());
            let write_cmd = format!("echo '{}' | base64 -d > '{safe_fp}'", encoded);
            tokio::task::spawn_blocking(move || {
                crate::common::utils::command::wsl::exec(&distro, &write_cmd)
            })
            .await
            .map_err(|e| AppError::InvalidInput(format!("Task join error: {}", e)))?
            .map_err(AppError::from)?;

            Ok(())
        }
        FileTransportKind::Remote {
            host,
            port,
            username,
            auth,
            project_path,
        } => {
            use crate::common::utils::command::ssh::exec_command;

            let base = root_path.unwrap_or(project_path);
            let full_path = format!("{}/{}", base, file_path);
            let safe_fp = crate::common::utils::command::local::safe_path(&full_path);

            // 确保父目录存在
            if let Some(parent) = std::path::Path::new(&full_path).parent() {
                let safe_parent =
                    crate::common::utils::command::local::safe_path(parent.to_str().unwrap_or(""));
                let mkdir_cmd = format!("mkdir -p '{safe_parent}'");
                let _ = exec_command(&host, port, &username, &auth, &mkdir_cmd).await;
            }

            // 使用 base64 编码传输，避免 shell 转义问题
            use base64::Engine;
            let encoded = base64::engine::general_purpose::STANDARD.encode(content.as_bytes());
            let write_cmd = format!("echo '{}' | base64 -d > '{safe_fp}'", encoded);
            exec_command(&host, port, &username, &auth, &write_cmd)
                .await
                .map_err(AppError::from)?;

            Ok(())
        }
    }
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
    transport: FileTransportKind,
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
    let output = match transport {
        FileTransportKind::Local { project_path } => {
            let sp = std::path::PathBuf::from(&project_path);
            let config =
                resolve_agent_config(&state, &agent_id, agent_command_override.as_deref())?;
            ai_svc::generate_commit_message(&sp, &config, &file_paths).map_err(AppError::from)?
        }
        FileTransportKind::Remote {
            host,
            port,
            username,
            auth,
            project_path,
        } => {
            use crate::common::utils::command::ssh;

            let sp = crate::common::utils::command::local::safe_path(&project_path);
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
            match ssh::exec_command(&host, port, &username, &auth, &full_cmd).await {
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
        FileTransportKind::Wsl {
            distro,
            project_path,
        } => {
            let sp = crate::common::utils::command::local::safe_path(&project_path);
            let actual_cmd = ai_svc::build_agent_commit_cmd(
                &sp,
                &agent_cmd,
                &prompt_args,
                &post_prompt_args,
                &prompt,
            );

            // 注入环境加载前缀，source ~/.profile 加载用户路径（.cargo/bin 等）
            let actual_cmd = format!(r#"source ~/.profile 2>/dev/null; {}"#, actual_cmd);

            // 获取 WSL 默认用户名，确保以正确用户身份启动（HOME=/home/<user>）
            let wsl_user = crate::common::utils::command::local::exec("wsl.exe")
                .arg("-d")
                .arg(&distro)
                .arg("whoami")
                .output()
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .unwrap_or_else(|_| "root".to_string());
            log::info!("[AI commit WSL] wsl_user={}", wsl_user);

            // 使用 bash -ic 交互模式执行（绕过 .bashrc 的 non-interactive guard，确保 nvm 加载）
            //    -u <user>: 确保 HOME=/home/<user>，profile 路径正确
            //    env_remove("PATH"): 清除 Windows 污染 PATH，从干净基础开始
            let wsl_output = tokio::task::spawn_blocking(move || {
                crate::common::utils::command::local::exec("wsl.exe")
                    .arg("-d")
                    .arg(&distro)
                    .arg("-u")
                    .arg(&wsl_user)
                    .arg("bash")
                    .arg("-ic")
                    .arg(&actual_cmd)
                    .env_remove("PATH")
                    .output()
                    .map_err(|e| {
                        AppError::InvalidInput(format!("Failed to execute wsl.exe: {}", e))
                    })
            })
            .await
            .map_err(|e| AppError::InvalidInput(format!("Task join error: {}", e)))??;

            let exit_code = wsl_output.status.code().unwrap_or(-1);
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

            if !wsl_output.status.success() {
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
    crate::common::utils::command::ssh::exec_command(&host, port, &username, &auth, "echo $HOME")
        .await
        .map(|s| s.trim().to_string())
        .map_err(AppError::from)
}

// ─── PR Commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn is_gh_installed_command() -> bool {
    crate::git::is_gh_installed()
}

#[tauri::command]
pub fn is_gh_authenticated_command() -> bool {
    crate::git::is_gh_authenticated()
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
pub fn list_repo_labels_command(
    project_id: String,
    state: State<AppStateWrapper>,
) -> Result<Vec<PrLabel>, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::list_repo_labels(&project.path).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn list_repo_authors_command(
    project_id: String,
    state: State<AppStateWrapper>,
) -> Result<Vec<String>, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::list_repo_authors(&project.path).map_err(AppError::from)
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
pub fn list_pr_files_command(
    project_id: String,
    pr_number: u64,
    state: State<AppStateWrapper>,
) -> Result<Vec<PRFileChange>, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::list_pr_files(&project.path, pr_number).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn list_pr_commits_command(
    project_id: String,
    pr_number: u64,
    state: State<AppStateWrapper>,
) -> Result<Vec<PRCommit>, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::list_pr_commits(&project.path, pr_number).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn add_pr_review_comment_command(
    project_id: String,
    pr_number: u64,
    body: String,
    file_path: String,
    line: u64,
    side: String,
    state: State<AppStateWrapper>,
) -> Result<PRReviewComment, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::add_pr_review_comment(&project.path, pr_number, &body, &file_path, line, &side)
            .map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub async fn list_pr_review_comments_command(
    project_id: String,
    pr_number: u64,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<PRReviewComment>, AppError> {
    let t0 = std::time::Instant::now();
    let project_path = {
        let manager = state.project_manager.lock().map_err(AppError::from)?;
        match manager.get_project(&project_id) {
            Some(p) => p.path.clone(),
            None => {
                return Err(AppError::NotFound(format!(
                    "Project not found: {}",
                    project_id
                )))
            }
        }
    };
    let result = tokio::task::spawn_blocking(move || {
        crate::git::list_pr_review_comments(&project_path, pr_number).map_err(AppError::from)
    })
    .await
    .map_err(|e| AppError::Io(format!("spawn_blocking failed: {}", e)))??;
    log::debug!(
        "[perf] Rust list_pr_review_comments: PR #{} {}ms",
        pr_number,
        t0.elapsed().as_millis()
    );
    Ok(result)
}

// ─── PR Comment Commands ────────────────────────────────────────────────────

#[tauri::command]
pub fn list_pr_comments_command(
    project_id: String,
    pr_number: u64,
    state: State<AppStateWrapper>,
) -> Result<Vec<PRComment>, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::list_pr_comments(&project.path, pr_number).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn add_pr_comment_command(
    project_id: String,
    pr_number: u64,
    body: String,
    state: State<AppStateWrapper>,
) -> Result<PRComment, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::add_pr_comment(&project.path, pr_number, &body).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn edit_pr_comment_command(
    project_id: String,
    pr_number: u64,
    comment_id: String,
    body: String,
    state: State<AppStateWrapper>,
) -> Result<PRComment, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::edit_pr_comment(&project.path, pr_number, &comment_id, &body)
            .map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn delete_pr_comment_command(
    project_id: String,
    pr_number: u64,
    comment_id: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::delete_pr_comment(&project.path, pr_number, &comment_id).map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}

#[tauri::command]
pub fn add_comment_reaction_command(
    project_id: String,
    pr_number: u64,
    comment_id: String,
    emoji: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    if let Some(project) = manager.get_project(&project_id) {
        crate::git::add_comment_reaction(&project.path, pr_number, &comment_id, &emoji)
            .map_err(AppError::from)
    } else {
        Err(AppError::NotFound(format!(
            "Project not found: {}",
            project_id
        )))
    }
}
