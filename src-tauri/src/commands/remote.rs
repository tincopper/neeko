use crate::models::*;
use crate::AppError;
use crate::AppStateWrapper;
use tauri::State;

#[macro_export]
macro_rules! remote_commands {
    () => {
        $crate::commands::create_remote_terminal_session,
        $crate::commands::close_remote_terminal_session,
        $crate::commands::resize_remote_terminal,
        $crate::commands::test_remote_connection,
        $crate::commands::list_remote_directories,
        $crate::commands::refresh_remote_git_info,
        $crate::commands::get_remote_file_diff_command,
        $crate::commands::remote_checkout_branch,
        $crate::commands::remote_create_branch,
        $crate::commands::remote_rename_branch,
        $crate::commands::remote_create_worktree,
        $crate::commands::remote_remove_worktree,
        $crate::commands::remote_rename_worktree,
        $crate::commands::open_remote_ide,
        $crate::commands::remote_set_project_color,
    };
}

/// 设置 Remote (SSH) 项目的 avatar 颜色（None 表示清回 hash 默认）
/// 修改 sessions.json 内匹配 entry_id + project_id 的记录
#[tauri::command]
pub fn remote_set_project_color(
    entry_id: String,
    project_id: String,
    color: Option<String>,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let mut session = state
        .storage_manager
        .load_session()
        .map_err(AppError::from)?;
    for entry in session.remote_entries.iter_mut() {
        if entry.id != entry_id {
            continue;
        }
        for project in entry.projects.iter_mut() {
            if project.id == project_id {
                project.avatar_color = color.clone();
            }
        }
    }
    state
        .storage_manager
        .save_session(&session)
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn create_remote_terminal_session(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    project_path: String,
    cols: u16,
    rows: u16,
    state: State<'_, AppStateWrapper>,
    app_handle: tauri::AppHandle,
) -> Result<TerminalSession, AppError> {
    state
        .remote_terminal_manager
        .create_session(
            &host,
            port,
            &username,
            &auth,
            &project_path,
            cols,
            rows,
            app_handle,
        )
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub fn close_remote_terminal_session(session_id: String, state: State<AppStateWrapper>) {
    state.remote_terminal_manager.close_session(&session_id);
}

#[tauri::command]
pub fn resize_remote_terminal(
    session_id: String,
    cols: u16,
    rows: u16,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    state
        .remote_terminal_manager
        .resize_session(&session_id, cols, rows)
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn test_remote_connection(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    state
        .remote_terminal_manager
        .test_connection(&host, port, &username, &auth)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn list_remote_directories(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    path: String,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<String>, AppError> {
    state
        .remote_terminal_manager
        .list_directories(&host, port, &username, &auth, &path)
        .await
        .map_err(AppError::from)
}
