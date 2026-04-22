use crate::models::*;
use crate::AppError;

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
