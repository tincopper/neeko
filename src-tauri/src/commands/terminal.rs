use crate::state::*;
use crate::AppStateWrapper;
use tauri::State;

#[tauri::command]
pub fn create_terminal_session(
    project_id: String,
    cols: u16,
    rows: u16,
    shell: Option<String>,
    working_dir: Option<String>,
    state: State<AppStateWrapper>,
    app_handle: tauri::AppHandle,
) -> Result<TerminalSession, String> {
    let manager = state
        .project_manager
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;
    if let Some(project) = manager.get_project(&project_id) {
        let path = project.path.to_string_lossy().to_string();
        state
            .terminal_manager
            .create_session(&path, cols, rows, shell, working_dir, app_handle)
            .map_err(|e| e.to_string())
    } else {
        Err(format!("Project not found: {}", project_id))
    }
}

#[tauri::command]
pub fn close_terminal_session(session_id: String, state: State<AppStateWrapper>) {
    state.terminal_manager.close_session(&session_id);
}

#[tauri::command]
pub fn resize_terminal(
    session_id: String,
    cols: u16,
    rows: u16,
    state: State<AppStateWrapper>,
) -> Result<(), String> {
    state
        .terminal_manager
        .resize_session(&session_id, cols, rows)
        .map_err(|e| e.to_string())
}
