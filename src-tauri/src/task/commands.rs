//! Tauri commands for task configuration CRUD and execution.

use crate::task::{DiscoveredTask, TaskConfig};
use crate::AppError;
use crate::AppStateWrapper;
use std::path::Path;
use tauri::State;

/// Get all task configs (app-level and project-level).
#[tauri::command]
pub fn get_task_configs(
    project_path: Option<String>,
    state: State<AppStateWrapper>,
) -> Result<Vec<TaskConfig>, AppError> {
    let _ = &state; // state available for future use
    let configs = crate::task::get_all_task_configs(project_path.as_deref());
    Ok(configs)
}

/// Scan project for auto-discovered tasks. Does not write to disk.
#[tauri::command]
pub fn discover_task_configs(
    project_path: String,
    state: State<AppStateWrapper>,
) -> Result<Vec<DiscoveredTask>, AppError> {
    let _ = &state;
    let path = Path::new(&project_path);
    Ok(crate::task::discover_tasks(path))
}

/// Persist a discovered task as a project-scoped TaskConfig.
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

/// Save (create or update) a task config.
#[tauri::command]
pub fn save_task_config(
    config: TaskConfig,
    project_path: Option<String>,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let _ = &state;
    crate::task::save_task(&config, project_path.as_deref()).map_err(AppError::from)
}

/// Delete a task config by ID and scope.
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

/// Stop a running task by closing its PTY session.
#[tauri::command]
pub fn stop_task(
    session_id: String,
    state: State<AppStateWrapper>,
    app_handle: tauri::AppHandle,
) -> Result<(), AppError> {
    // 拆除单一入口：走 router 按会话归属（PTY / SSH）路由，而不是直连某
    // 一个后端 —— 后者会静默漏掉 SSH 会话并泄漏 owners 登记。
    state
        .terminal_router
        .close_session(&session_id, Some(&app_handle));
    Ok(())
}
