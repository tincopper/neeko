//! Tauri commands for terminal session lifecycle.

#[allow(clippy::wildcard_imports)]
use crate::common::terminal::types::*;
use crate::AppError;
use crate::AppStateWrapper;
use tauri::State;

/// Creates a new PTY terminal session for a project.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
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

/// Drains all buffered terminal output for a session as raw bytes.
///
/// 内存治理（credit-pull 协议）：数据走二进制 Response（前端得 ArrayBuffer），
/// 零 JSON 序列化开销；唤醒事件仅是零载荷 hint。
///
/// 必须保持 async：同步命令在 Tauri 主线程执行，多会话并发输出时 drain
/// invoke 洪泛会挤占主线程，饿死 create_terminal_session 等全部命令
/// （冻结故障回炉，任务 design.md §8.1 放大器 A）。
#[tauri::command]
pub async fn terminal_drain(
    session_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<tauri::ipc::Response, AppError> {
    state.terminal_drain(&session_id)
}
