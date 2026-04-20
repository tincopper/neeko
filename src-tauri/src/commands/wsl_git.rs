use crate::state::*;

#[tauri::command]
pub fn refresh_wsl_git_info(distro: String, project_path: String) -> Result<GitInfo, String> {
    #[cfg(target_os = "windows")]
    {
        crate::git::get_wsl_git_info(&distro, &project_path).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path);
        Err("WSL is only supported on Windows".to_string())
    }
}

#[tauri::command]
pub fn get_wsl_file_diff_command(
    distro: String,
    project_path: String,
    file_path: String,
) -> Result<DiffResult, String> {
    #[cfg(target_os = "windows")]
    {
        crate::git::get_wsl_file_diff(&distro, &project_path, &file_path)
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, file_path);
        Err("WSL is only supported on Windows".to_string())
    }
}

#[tauri::command]
pub fn wsl_checkout_branch(
    distro: String,
    project_path: String,
    branch_name: String,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        crate::git::run_wsl_git(&distro, &project_path, &["checkout", &branch_name])
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, branch_name);
        Err("WSL is only supported on Windows".to_string())
    }
}

#[tauri::command]
pub fn wsl_create_branch(
    distro: String,
    project_path: String,
    branch_name: String,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        crate::git::run_wsl_git(&distro, &project_path, &["branch", &branch_name])
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, branch_name);
        Err("WSL is only supported on Windows".to_string())
    }
}

#[tauri::command]
pub fn wsl_rename_branch(
    distro: String,
    project_path: String,
    old_name: String,
    new_name: String,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        crate::git::run_wsl_git(
            &distro,
            &project_path,
            &["branch", "-m", &old_name, &new_name],
        )
        .map(|_| ())
        .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, old_name, new_name);
        Err("WSL is only supported on Windows".to_string())
    }
}

#[tauri::command]
pub fn wsl_get_commit_log(
    distro: String,
    project_path: String,
    offset: usize,
    limit: usize,
) -> Result<Vec<CommitInfo>, String> {
    #[cfg(target_os = "windows")]
    {
        crate::git::get_wsl_commit_log(&distro, &project_path, offset, limit)
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, offset, limit);
        Err("WSL is only supported on Windows".to_string())
    }
}

#[tauri::command]
pub fn wsl_get_commit_detail(
    distro: String,
    project_path: String,
    commit_hash: String,
) -> Result<CommitDetail, String> {
    #[cfg(target_os = "windows")]
    {
        crate::git::get_wsl_commit_detail(&distro, &project_path, &commit_hash)
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, commit_hash);
        Err("WSL is only supported on Windows".to_string())
    }
}

#[tauri::command]
pub fn wsl_get_all_branches(
    distro: String,
    project_path: String,
) -> Result<BranchGroup, String> {
    #[cfg(target_os = "windows")]
    {
        crate::git::get_wsl_all_branches(&distro, &project_path).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path);
        Err("WSL is only supported on Windows".to_string())
    }
}

#[tauri::command]
pub fn wsl_create_worktree(
    distro: String,
    project_path: String,
    worktree_path: String,
    branch_name: String,
    new_branch: bool,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let args: Vec<&str> = if new_branch {
            vec!["worktree", "add", "-b", &branch_name, &worktree_path]
        } else {
            vec!["worktree", "add", &worktree_path, &branch_name]
        };
        crate::git::run_wsl_git(&distro, &project_path, &args)
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, worktree_path, branch_name, new_branch);
        Err("WSL is only supported on Windows".to_string())
    }
}

#[tauri::command]
pub fn wsl_remove_worktree(
    distro: String,
    project_path: String,
    worktree_path: String,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        crate::git::run_wsl_git(
            &distro,
            &project_path,
            &["worktree", "remove", "--force", &worktree_path],
        )
        .map(|_| ())
        .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, worktree_path);
        Err("WSL is only supported on Windows".to_string())
    }
}

#[tauri::command]
pub fn wsl_rename_worktree(
    distro: String,
    project_path: String,
    worktree_path: String,
    new_name: String,
) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        crate::git::run_wsl_git(
            &distro,
            &project_path,
            &["worktree", "move", &worktree_path, &new_name],
        )
        .map_err(|e| e.to_string())
        .map(|_| new_name)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, worktree_path, new_name);
        Err("WSL is only supported on Windows".to_string())
    }
}
