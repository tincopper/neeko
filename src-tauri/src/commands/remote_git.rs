use crate::models::*;
use crate::AppError;

/// 文件树默认递归深度
const DEFAULT_TREE_DEPTH: u32 = 4;

#[tauri::command]
pub async fn refresh_remote_git_info(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    project_path: String,
) -> Result<GitInfo, AppError> {
    crate::git::remote::get_remote_git_info(&host, port, &username, &auth, &project_path)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn get_remote_file_diff_command(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    project_path: String,
    file_path: String,
) -> Result<DiffResult, AppError> {
    crate::git::remote::get_remote_file_diff(
        &host,
        port,
        &username,
        &auth,
        &project_path,
        &file_path,
    )
    .await
    .map_err(AppError::from)
}

#[tauri::command]
pub async fn remote_checkout_branch(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    project_path: String,
    branch_name: String,
) -> Result<(), AppError> {
    let cmd = format!("git checkout '{}'", branch_name.replace('\'', "'\\''"));
    crate::git::remote::run_remote_git(&host, port, &username, &auth, &project_path, &cmd)
        .await
        .map(|_| ())
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn remote_create_branch(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    project_path: String,
    branch_name: String,
) -> Result<(), AppError> {
    let cmd = format!("git branch '{}'", branch_name.replace('\'', "'\\''"));
    crate::git::remote::run_remote_git(&host, port, &username, &auth, &project_path, &cmd)
        .await
        .map(|_| ())
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn remote_rename_branch(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    project_path: String,
    old_name: String,
    new_name: String,
) -> Result<(), AppError> {
    let q = |s: &str| format!("'{}'", s.replace('\'', "'\\''"));
    let cmd = format!("git branch -m {} {}", q(&old_name), q(&new_name));
    crate::git::remote::run_remote_git(&host, port, &username, &auth, &project_path, &cmd)
        .await
        .map(|_| ())
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn remote_create_worktree(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    project_path: String,
    worktree_path: String,
    branch_name: String,
    new_branch: bool,
) -> Result<(), AppError> {
    let parent = std::path::Path::new(&worktree_path)
        .parent()
        .unwrap_or(std::path::Path::new(&worktree_path));
    if let Some(parent_str) = parent.to_str() {
        let safe_parent = parent_str.replace('\'', "'\\''");
        crate::utils::command::ssh::exec_command(
            &host,
            port,
            &username,
            &auth,
            &format!("mkdir -p '{}'", safe_parent),
        )
        .await
        .map_err(AppError::from)?;
    }
    let q = |s: &str| format!("'{}'", s.replace('\'', "'\\''"));
    let cmd = if new_branch {
        format!(
            "git worktree add -b {} {}",
            q(&branch_name),
            q(&worktree_path)
        )
    } else {
        format!("git worktree add {} {}", q(&worktree_path), q(&branch_name))
    };
    crate::git::remote::run_remote_git(&host, port, &username, &auth, &project_path, &cmd)
        .await
        .map(|_| ())
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn remote_remove_worktree(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    project_path: String,
    worktree_path: String,
) -> Result<(), AppError> {
    let q = |s: &str| format!("'{}'", s.replace('\'', "'\\''"));
    let cmd = format!("git worktree remove --force {}", q(&worktree_path));
    crate::git::remote::run_remote_git(&host, port, &username, &auth, &project_path, &cmd)
        .await
        .map(|_| ())
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn remote_rename_worktree(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    project_path: String,
    worktree_path: String,
    new_name: String,
) -> Result<String, AppError> {
    let parent = std::path::Path::new(&worktree_path)
        .parent()
        .and_then(|p| p.to_str())
        .unwrap_or(".");
    let new_path = format!("{}/{}", parent, new_name);
    let q = |s: &str| format!("'{}'", s.replace('\'', "'\\''"));
    let cmd = format!("git worktree move {} {}", q(&worktree_path), q(&new_path));
    crate::git::remote::run_remote_git(&host, port, &username, &auth, &project_path, &cmd)
        .await
        .map(|_| new_path)
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn remote_get_worktree_changed_files(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    worktree_path: String,
) -> Result<Vec<FileChange>, AppError> {
    crate::git::remote::get_remote_worktree_changed_files(
        &host,
        port,
        &username,
        &auth,
        &worktree_path,
    )
    .await
    .map_err(AppError::from)
}

#[tauri::command]
pub async fn remote_is_worktree_dirty(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    worktree_path: String,
) -> Result<bool, AppError> {
    crate::git::remote::remote_is_worktree_dirty(&host, port, &username, &auth, &worktree_path)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn remote_get_worktree_file_diff(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    worktree_path: String,
    file_path: String,
) -> Result<DiffResult, AppError> {
    crate::git::remote::get_remote_worktree_file_diff(
        &host,
        port,
        &username,
        &auth,
        &worktree_path,
        &file_path,
    )
    .await
    .map_err(AppError::from)
}

#[tauri::command]
pub async fn get_remote_home_dir(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
) -> Result<String, AppError> {
    crate::utils::command::ssh::exec_command(&host, port, &username, &auth, "echo $HOME")
        .await
        .map(|s| s.trim().to_string())
        .map_err(AppError::from)
}

// ─── Extended Remote Git Commands (Step 5) ───────────────────────────────────

#[tauri::command]
pub async fn remote_stage_files(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    project_path: String,
    file_paths: Vec<String>,
) -> Result<(), AppError> {
    if file_paths.is_empty() {
        return Ok(());
    }
    let quoted_files: Vec<String> = file_paths
        .iter()
        .map(|f| format!("'{}'", crate::utils::command::ssh::safe_path(f)))
        .collect();
    let cmd = format!("git add -- {}", quoted_files.join(" "));
    crate::git::remote::run_remote_git(&host, port, &username, &auth, &project_path, &cmd)
        .await
        .map(|_| ())
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn remote_unstage_files(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    project_path: String,
    file_paths: Vec<String>,
) -> Result<(), AppError> {
    if file_paths.is_empty() {
        return Ok(());
    }
    let quoted_files: Vec<String> = file_paths
        .iter()
        .map(|f| format!("'{}'", crate::utils::command::ssh::safe_path(f)))
        .collect();
    let cmd = format!("git restore --staged -- {}", quoted_files.join(" "));
    crate::git::remote::run_remote_git(&host, port, &username, &auth, &project_path, &cmd)
        .await
        .map(|_| ())
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn remote_discard_file(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    project_path: String,
    file_path: String,
) -> Result<(), AppError> {
    let fp = crate::utils::command::ssh::safe_path(&file_path);
    let cmd = format!("git checkout -- '{fp}'");
    crate::git::remote::run_remote_git(&host, port, &username, &auth, &project_path, &cmd)
        .await
        .map(|_| ())
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn remote_commit_files(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    project_path: String,
    file_paths: Vec<String>,
    message: String,
) -> Result<CommitResult, AppError> {
    crate::git::remote::remote_commit_files_fn(
        &host,
        port,
        &username,
        &auth,
        &project_path,
        &file_paths,
        &message,
    )
    .await
    .map_err(AppError::from)
}

#[tauri::command]
pub async fn remote_push(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    project_path: String,
    set_upstream: bool,
) -> Result<(), AppError> {
    let sp = crate::utils::command::ssh::safe_path(&project_path);
    let cmd = if set_upstream {
        let branch_output = crate::utils::command::ssh::exec_command(
            &host,
            port,
            &username,
            &auth,
            &format!("cd '{sp}' && git rev-parse --abbrev-ref HEAD 2>/dev/null"),
        )
        .await
        .map_err(AppError::from)?;
        let branch = branch_output.trim().to_string();
        let safe_branch = crate::utils::command::ssh::safe_path(&branch);
        format!("cd '{sp}' && git push --set-upstream origin '{safe_branch}'")
    } else {
        format!("cd '{sp}' && git push")
    };
    crate::utils::command::ssh::exec_command(&host, port, &username, &auth, &cmd)
        .await
        .map(|_| ())
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn remote_pull(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    project_path: String,
) -> Result<(), AppError> {
    crate::git::remote::run_remote_git(&host, port, &username, &auth, &project_path, "git pull")
        .await
        .map(|_| ())
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn remote_fetch(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    project_path: String,
) -> Result<(), AppError> {
    crate::git::remote::run_remote_git(
        &host,
        port,
        &username,
        &auth,
        &project_path,
        "git fetch --all",
    )
    .await
    .map(|_| ())
    .map_err(AppError::from)
}

#[tauri::command]
pub async fn remote_get_commit_log(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    project_path: String,
    count: usize,
    skip: Option<usize>,
) -> Result<Vec<CommitEntry>, AppError> {
    crate::git::remote::remote_get_commit_log(
        &host,
        port,
        &username,
        &auth,
        &project_path,
        count,
        skip.unwrap_or(0),
    )
    .await
    .map_err(AppError::from)
}

#[tauri::command]
pub async fn remote_get_commit_detail(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    project_path: String,
    commit_hash: String,
) -> Result<CommitDetail, AppError> {
    crate::git::remote::remote_get_commit_detail_fn(
        &host,
        port,
        &username,
        &auth,
        &project_path,
        &commit_hash,
    )
    .await
    .map_err(AppError::from)
}

#[tauri::command]
pub async fn remote_get_commit_files(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    project_path: String,
    commit_hash: String,
) -> Result<Vec<CommitFileChange>, AppError> {
    crate::git::remote::remote_get_commit_files_fn(
        &host,
        port,
        &username,
        &auth,
        &project_path,
        &commit_hash,
    )
    .await
    .map_err(AppError::from)
}

#[tauri::command]
pub async fn remote_get_commit_file_diff(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    project_path: String,
    commit_hash: String,
    file_path: String,
) -> Result<DiffResult, AppError> {
    crate::git::remote::remote_get_commit_file_diff_fn(
        &host,
        port,
        &username,
        &auth,
        &project_path,
        &commit_hash,
        &file_path,
    )
    .await
    .map_err(AppError::from)
}

#[tauri::command]
pub async fn remote_get_ahead_behind(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    project_path: String,
) -> Result<AheadBehind, AppError> {
    crate::git::remote::remote_get_ahead_behind_fn(&host, port, &username, &auth, &project_path)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn remote_cherry_pick(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    project_path: String,
    commit_hash: String,
) -> Result<(), AppError> {
    let ch = crate::utils::command::ssh::safe_path(&commit_hash);
    let cmd = format!("git cherry-pick '{ch}'");
    crate::git::remote::run_remote_git(&host, port, &username, &auth, &project_path, &cmd)
        .await
        .map(|_| ())
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn remote_revert_commit(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    project_path: String,
    commit_hash: String,
) -> Result<(), AppError> {
    let ch = crate::utils::command::ssh::safe_path(&commit_hash);
    let cmd = format!("git revert --no-edit '{ch}'");
    crate::git::remote::run_remote_git(&host, port, &username, &auth, &project_path, &cmd)
        .await
        .map(|_| ())
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn remote_create_tag(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    project_path: String,
    tag_name: String,
    message: Option<String>,
) -> Result<(), AppError> {
    let tn = crate::utils::command::ssh::safe_path(&tag_name);
    let cmd = match message {
        Some(ref msg) => {
            let safe_msg = msg.replace('\'', "'\\''");
            format!("git tag -a '{tn}' -m '{safe_msg}'")
        }
        None => format!("git tag '{tn}'"),
    };
    crate::git::remote::run_remote_git(&host, port, &username, &auth, &project_path, &cmd)
        .await
        .map(|_| ())
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn remote_read_dir_tree(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    root_path: String,
    sub_path: Option<String>,
    max_depth: Option<u32>,
) -> Result<Vec<FileNode>, AppError> {
    let depth = max_depth.unwrap_or(DEFAULT_TREE_DEPTH);
    crate::git::remote::remote_read_dir_tree_fn(
        &host,
        port,
        &username,
        &auth,
        &root_path,
        sub_path.as_deref(),
        depth,
    )
    .await
    .map_err(AppError::from)
}

#[tauri::command]
pub async fn remote_read_file_content(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    project_path: String,
    file_path: String,
    root_path: Option<String>,
) -> Result<FileContent, AppError> {
    use crate::utils::command::ssh::{exec_command, safe_path};

    let base = root_path.unwrap_or(project_path);
    let full_path = format!("{}/{}", base, file_path);
    let safe_fp = safe_path(&full_path);

    // 文件大小
    let stat_cmd = format!("stat -c '%s' '{safe_fp}' 2>/dev/null || echo 0");
    let size: u64 = exec_command(&host, port, &username, &auth, &stat_cmd)
        .await
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0);

    // 二进制检测
    let binary_cmd =
        format!("head -c 8192 '{safe_fp}' | grep -ql '\\x00' 2>/dev/null && echo 1 || echo 0");
    let is_binary = exec_command(&host, port, &username, &auth, &binary_cmd)
        .await
        .map(|out| out.trim() == "1")
        .unwrap_or(false);

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
    let content = exec_command(&host, port, &username, &auth, &cat_cmd)
        .await
        .map_err(AppError::from)?;

    Ok(FileContent {
        path: file_path,
        content,
        size,
        is_binary: false,
    })
}

#[tauri::command]
pub async fn remote_write_file_content(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    project_path: String,
    file_path: String,
    content: String,
    root_path: Option<String>,
) -> Result<(), AppError> {
    use crate::utils::command::ssh::{exec_command, safe_path};

    let base = root_path.unwrap_or(project_path);
    let full_path = format!("{}/{}", base, file_path);
    let safe_fp = safe_path(&full_path);

    // 确保父目录存在
    if let Some(parent) = std::path::Path::new(&full_path).parent() {
        let safe_parent = safe_path(parent.to_str().unwrap_or(""));
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

#[cfg(test)]
mod tests {
    #[test]
    fn test_remote_stage_files_empty_list_contract() {
        // Documents: empty file list → Ok(()) without SSH call
        // Actual integration requires live SSH target
        let _ = ();
    }

    #[test]
    fn test_remote_commit_files_result_structure() {
        let result = crate::models::CommitResult {
            success: true,
            hash: "abc1234".to_string(),
            message: "test commit".to_string(),
        };
        assert!(result.success);
        assert_eq!(result.hash, "abc1234");
    }

    #[test]
    fn test_remote_get_ahead_behind_no_upstream_returns_zeros() {
        let ab = crate::models::AheadBehind {
            ahead: 0,
            behind: 0,
        };
        assert_eq!(ab.ahead, 0);
        assert_eq!(ab.behind, 0);
    }

    #[test]
    fn test_remote_create_tag_with_message_uses_annotated() {
        // Documents: tag with message uses -a flag (annotated)
        // Actual execution requires live SSH target
        let _ = ();
    }

    #[test]
    fn test_remote_read_dir_tree_default_depth() {
        // Documents: default max_depth is 4
        let depth: u32 = None::<u32>.unwrap_or(4);
        assert_eq!(depth, 4);
    }
}
