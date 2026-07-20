//! Tauri commands for terminal session lifecycle.

#[allow(clippy::wildcard_imports)]
use crate::common::terminal::types::*;
use crate::AppError;
use crate::AppStateWrapper;
use tauri::State;

/// Creates a new PTY terminal session for a project.
#[tauri::command]
pub async fn create_terminal_session(
    project_id: String,
    cols: u16,
    rows: u16,
    shell: Option<String>,
    working_dir: Option<String>,
    command: Option<String>,
    state: State<'_, AppStateWrapper>,
    app_handle: tauri::AppHandle,
) -> Result<TerminalSession, AppError> {
    state
        .create_terminal_session(
            &project_id,
            cols,
            rows,
            shell,
            working_dir,
            command,
            app_handle,
        )
        .await
}

/// Closes a terminal session by ID.
#[tauri::command]
pub fn close_terminal_session(session_id: String, state: State<AppStateWrapper>) {
    state.close_session(&session_id);
}

/// Resizes a terminal session to the specified column/row dimensions.
#[tauri::command]
pub fn resize_terminal(
    session_id: String,
    cols: u16,
    rows: u16,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    state.resize_session(&session_id, cols, rows)
}
