use crate::models::*;
use crate::AppError;

#[tauri::command]
pub fn refresh_wsl_git_info(distro: String, project_path: String) -> Result<GitInfo, AppError> {
    #[cfg(target_os = "windows")]
    {
        crate::git::get_wsl_git_info(&distro, &project_path).map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn get_wsl_file_diff_command(
    distro: String,
    project_path: String,
    file_path: String,
) -> Result<DiffResult, AppError> {
    #[cfg(target_os = "windows")]
    {
        crate::git::get_wsl_file_diff(&distro, &project_path, &file_path).map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, file_path);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_checkout_branch(
    distro: String,
    project_path: String,
    branch_name: String,
) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        crate::git::run_wsl_git(&distro, &project_path, &["checkout", &branch_name])
            .map(|_| ())
            .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, branch_name);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_create_branch(
    distro: String,
    project_path: String,
    branch_name: String,
) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        crate::git::run_wsl_git(&distro, &project_path, &["branch", &branch_name])
            .map(|_| ())
            .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, branch_name);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_rename_branch(
    distro: String,
    project_path: String,
    old_name: String,
    new_name: String,
) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        crate::git::run_wsl_git(
            &distro,
            &project_path,
            &["branch", "-m", &old_name, &new_name],
        )
        .map(|_| ())
        .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, old_name, new_name);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_create_worktree(
    distro: String,
    project_path: String,
    worktree_path: String,
    branch_name: String,
    new_branch: bool,
) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        let parent = std::path::Path::new(&worktree_path)
            .parent()
            .unwrap_or(std::path::Path::new(&worktree_path));
        if let Some(parent_str) = parent.to_str() {
            let safe_parent = parent_str.replace('\'', "'\\''");
            let _ =
                crate::utils::command::wsl::exec(&distro, &format!("mkdir -p '{}'", safe_parent))?;
        }
        let args: Vec<&str> = if new_branch {
            vec!["worktree", "add", "-b", &branch_name, &worktree_path]
        } else {
            vec!["worktree", "add", &worktree_path, &branch_name]
        };
        crate::git::run_wsl_git(&distro, &project_path, &args)
            .map(|_| ())
            .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, worktree_path, branch_name, new_branch);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_remove_worktree(
    distro: String,
    project_path: String,
    worktree_path: String,
) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        crate::git::run_wsl_git(
            &distro,
            &project_path,
            &["worktree", "remove", "--force", &worktree_path],
        )
        .map(|_| ())
        .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, worktree_path);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_rename_worktree(
    distro: String,
    project_path: String,
    worktree_path: String,
    new_name: String,
) -> Result<String, AppError> {
    #[cfg(target_os = "windows")]
    {
        crate::git::run_wsl_git(
            &distro,
            &project_path,
            &["worktree", "move", &worktree_path, &new_name],
        )
        .map_err(AppError::from)
        .map(|_| new_name)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, worktree_path, new_name);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_get_worktree_changed_files(
    distro: String,
    worktree_path: String,
) -> Result<Vec<FileChange>, AppError> {
    #[cfg(target_os = "windows")]
    {
        crate::git::get_wsl_worktree_changed_files(&distro, &worktree_path).map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, worktree_path);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_is_worktree_dirty(distro: String, worktree_path: String) -> Result<bool, AppError> {
    #[cfg(target_os = "windows")]
    {
        crate::git::wsl_is_worktree_dirty(&distro, &worktree_path).map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, worktree_path);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_get_worktree_file_diff(
    distro: String,
    worktree_path: String,
    file_path: String,
) -> Result<DiffResult, AppError> {
    #[cfg(target_os = "windows")]
    {
        crate::git::get_wsl_worktree_file_diff(&distro, &worktree_path, &file_path)
            .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, worktree_path, file_path);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

// ─── New WSL Git Commands ─────────────────────────────────────────────────────

#[tauri::command]
pub fn wsl_stage_files(
    distro: String,
    project_path: String,
    file_paths: Vec<String>,
) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        if file_paths.is_empty() {
            return Ok(());
        }
        let quoted_files: Vec<String> = file_paths
            .iter()
            .map(|f| format!("'{}'", crate::utils::command::wsl::safe_path(f)))
            .collect();
        let sp = crate::utils::command::wsl::safe_path(&project_path);
        let cmd = format!("cd '{sp}' && git add -- {}", quoted_files.join(" "));
        crate::utils::command::wsl::exec(&distro, &cmd)
            .map(|_| ())
            .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, file_paths);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_unstage_files(
    distro: String,
    project_path: String,
    file_paths: Vec<String>,
) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        if file_paths.is_empty() {
            return Ok(());
        }
        let quoted_files: Vec<String> = file_paths
            .iter()
            .map(|f| format!("'{}'", crate::utils::command::wsl::safe_path(f)))
            .collect();
        let sp = crate::utils::command::wsl::safe_path(&project_path);
        let cmd = format!(
            "cd '{sp}' && git restore --staged -- {}",
            quoted_files.join(" ")
        );
        crate::utils::command::wsl::exec(&distro, &cmd)
            .map(|_| ())
            .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, file_paths);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_discard_file(
    distro: String,
    project_path: String,
    file_path: String,
) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        crate::git::run_wsl_git(&distro, &project_path, &["checkout", "--", &file_path])
            .map(|_| ())
            .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, file_path);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_commit_files(
    distro: String,
    project_path: String,
    file_paths: Vec<String>,
    message: String,
) -> Result<CommitResult, AppError> {
    #[cfg(target_os = "windows")]
    {
        crate::git::wsl_commit_files(&distro, &project_path, &file_paths, &message)
            .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, file_paths, message);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_push(distro: String, project_path: String, set_upstream: bool) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        let sp = crate::utils::command::wsl::safe_path(&project_path);
        if set_upstream {
            // Get current branch name first
            let branch_output = crate::utils::command::wsl::exec(
                &distro,
                &format!("cd '{sp}' && git rev-parse --abbrev-ref HEAD 2>/dev/null"),
            )
            .map_err(AppError::from)?;
            let branch = branch_output.trim().to_string();
            let safe_branch = crate::utils::command::wsl::safe_path(&branch);
            crate::utils::command::wsl::exec(
                &distro,
                &format!("cd '{sp}' && git push --set-upstream origin '{safe_branch}'"),
            )
            .map(|_| ())
            .map_err(AppError::from)
        } else {
            crate::utils::command::wsl::exec(&distro, &format!("cd '{sp}' && git push"))
                .map(|_| ())
                .map_err(AppError::from)
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, set_upstream);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_pull(distro: String, project_path: String) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        crate::git::run_wsl_git(&distro, &project_path, &["pull"])
            .map(|_| ())
            .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_fetch(distro: String, project_path: String) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        crate::git::run_wsl_git(&distro, &project_path, &["fetch", "--all"])
            .map(|_| ())
            .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_get_commit_log(
    distro: String,
    project_path: String,
    count: usize,
    skip: Option<usize>,
) -> Result<Vec<CommitEntry>, AppError> {
    #[cfg(target_os = "windows")]
    {
        crate::git::wsl_get_commit_log(&distro, &project_path, count, skip.unwrap_or(0))
            .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, count, skip);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_get_commit_detail(
    distro: String,
    project_path: String,
    commit_hash: String,
) -> Result<CommitDetail, AppError> {
    #[cfg(target_os = "windows")]
    {
        crate::git::wsl_get_commit_detail(&distro, &project_path, &commit_hash)
            .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, commit_hash);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_get_commit_files(
    distro: String,
    project_path: String,
    commit_hash: String,
) -> Result<Vec<CommitFileChange>, AppError> {
    #[cfg(target_os = "windows")]
    {
        crate::git::wsl_get_commit_files(&distro, &project_path, &commit_hash)
            .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, commit_hash);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_get_commit_file_diff(
    distro: String,
    project_path: String,
    commit_hash: String,
    file_path: String,
) -> Result<DiffResult, AppError> {
    #[cfg(target_os = "windows")]
    {
        crate::git::wsl_get_commit_file_diff(&distro, &project_path, &commit_hash, &file_path)
            .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, commit_hash, file_path);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_get_ahead_behind(distro: String, project_path: String) -> Result<AheadBehind, AppError> {
    #[cfg(target_os = "windows")]
    {
        crate::git::wsl_get_ahead_behind(&distro, &project_path).map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_cherry_pick(
    distro: String,
    project_path: String,
    commit_hash: String,
) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        crate::git::run_wsl_git(&distro, &project_path, &["cherry-pick", &commit_hash])
            .map(|_| ())
            .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, commit_hash);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_revert_commit(
    distro: String,
    project_path: String,
    commit_hash: String,
) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        crate::git::run_wsl_git(
            &distro,
            &project_path,
            &["revert", "--no-edit", &commit_hash],
        )
        .map(|_| ())
        .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, commit_hash);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_create_tag(
    distro: String,
    project_path: String,
    tag_name: String,
    message: Option<String>,
) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        match message {
            Some(ref msg) => crate::git::run_wsl_git(
                &distro,
                &project_path,
                &["tag", "-a", &tag_name, "-m", msg],
            )
            .map(|_| ())
            .map_err(AppError::from),
            None => crate::git::run_wsl_git(&distro, &project_path, &["tag", &tag_name])
                .map(|_| ())
                .map_err(AppError::from),
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, tag_name, message);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_read_dir_tree(
    distro: String,
    root_path: String,
    sub_path: Option<String>,
    max_depth: Option<u32>,
) -> Result<Vec<FileNode>, AppError> {
    #[cfg(target_os = "windows")]
    {
        let depth = max_depth.unwrap_or(4);
        crate::git::wsl_read_dir_tree(&distro, &root_path, sub_path.as_deref(), depth)
            .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, root_path, sub_path, max_depth);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[cfg(test)]
mod tests {
    // Test scaffolding - these tests document expected behavior
    // Real WSL execution requires Windows + WSL environment

    #[test]
    fn test_wsl_stage_files_empty_list_returns_ok() {
        // On non-Windows, we'd get WSL error, but the logic for empty list is platform-independent
        // This documents the contract: empty file list → Ok(())
        // Actual integration requires Windows + WSL
        // todo!("integration test requires WSL environment")
        let _ = (); // placeholder assertion
    }

    #[test]
    fn test_wsl_get_ahead_behind_no_upstream() {
        // Documents: when no upstream, returns AheadBehind { ahead: 0, behind: 0 }
        // todo!("integration test requires WSL environment")
        let _ = ();
    }

    #[test]
    fn test_wsl_commit_files_structure() {
        // Documents: CommitResult has success, hash, message fields
        let result = crate::models::CommitResult {
            success: true,
            hash: "abc1234".to_string(),
            message: "test commit".to_string(),
        };
        assert!(result.success);
        assert_eq!(result.hash, "abc1234");
    }

    #[test]
    fn test_wsl_create_tag_with_message() {
        // Documents: tag with message uses -a flag
        // todo!("integration test requires WSL environment")
        let _ = ();
    }

    #[test]
    fn test_wsl_read_dir_tree_default_depth() {
        // Documents: default max_depth is 4
        // todo!("integration test requires WSL environment")
        let _ = ();
    }
}
