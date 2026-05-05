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
            let _ = crate::command::wsl::exec(&distro, &format!("mkdir -p '{}'", safe_parent))?;
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
