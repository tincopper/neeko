use crate::task::{DiscoveredTask, TaskConfig};
use crate::AppError;
use crate::AppStateWrapper;
use std::path::Path;
use tauri::{Emitter, State};

#[tauri::command]
pub fn get_task_configs(
    project_path: Option<String>,
    state: State<AppStateWrapper>,
) -> Result<Vec<TaskConfig>, AppError> {
    let _ = &state; // state available for future use
    let configs = crate::task::get_all_task_configs(project_path.as_deref());
    Ok(configs)
}

/// Scan project for auto-discovered tasks (package.json scripts, …).
/// Does not write to disk — import is a separate explicit step.
#[tauri::command]
pub fn discover_task_configs(
    project_path: String,
    state: State<AppStateWrapper>,
) -> Result<Vec<DiscoveredTask>, AppError> {
    let _ = &state;
    let path = Path::new(&project_path);
    Ok(crate::task::discover_tasks(path))
}

/// Persist a discovered task as a project-scoped TaskConfig (idempotent by id).
#[tauri::command]
pub fn import_discovered_task(
    task: DiscoveredTask,
    project_path: String,
    project_id: Option<String>,
    state: State<AppStateWrapper>,
) -> Result<TaskConfig, AppError> {
    let _ = &state;
    let config = crate::task::to_task_config(&task, project_id);
    crate::task::save_task(&config, Some(&project_path)).map_err(AppError::from)?;
    Ok(config)
}

#[tauri::command]
pub fn save_task_config(
    config: TaskConfig,
    project_path: Option<String>,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let _ = &state;
    crate::task::save_task(&config, project_path.as_deref()).map_err(AppError::from)
}

#[tauri::command]
pub fn delete_task_config(
    id: String,
    scope: String,
    project_path: Option<String>,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let _ = &state;
    crate::task::delete_task(&id, &scope, project_path.as_deref()).map_err(AppError::from)
}

#[tauri::command]
pub fn run_task(
    command: String,
    cwd: String,
    state: State<AppStateWrapper>,
    app_handle: tauri::AppHandle,
) -> Result<String, AppError> {
    // Create a PTY session in the given working directory and send the command
    let session = state
        .terminal_manager
        .create_session(&cwd, 80, 24, None, None, None, app_handle.clone())
        .map_err(AppError::from)?;

    let session_id = session.id.clone();

    // Send the command + Enter to the PTY via the event system
    let input_event = format!("terminal-input-{}", session_id);
    let mut payload = command.into_bytes();
    payload.push(b'\r');
    let _ = app_handle.emit(&input_event, &payload);

    Ok(session_id)
}

#[tauri::command]
pub fn stop_task(session_id: String, state: State<AppStateWrapper>) -> Result<(), AppError> {
    state
        .terminal_manager
        .close_session_in_background(&session_id);
    Ok(())
}
