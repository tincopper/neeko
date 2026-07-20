//! Tauri commands for DAP — thin IPC only.

use tauri::{AppHandle, State};

use super::adapter;
use super::discover::EntryPoint;
use super::types::{
    BreakpointSpec, DapSessionInfo, LaunchConfig, StackFrameDto, VariableDto,
};
use crate::AppError;
use crate::AppStateWrapper;

/// List launch configs for a project.
#[tauri::command]
pub fn dap_list_configs(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<LaunchConfig>, AppError> {
    crate::dap::manager::DapManager::list_or_discover_configs(&state, &project_id)
}

/// Save launch configs for a project.
#[tauri::command]
pub fn dap_save_configs(
    project_id: String,
    configurations: Vec<LaunchConfig>,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    crate::dap::manager::DapManager::save_configs(&state, &project_id, configurations)
}

/// Discover entry points for a project.
#[tauri::command]
pub fn dap_discover_entries(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<EntryPoint>, AppError> {
    crate::dap::manager::DapManager::discover_entries(&state, &project_id)
}

/// Start a DAP debug session.
#[tauri::command]
pub async fn dap_start_session(
    project_id: String,
    config_name: Option<String>,
    current_file: Option<String>,
    state: State<'_, AppStateWrapper>,
    app: AppHandle,
) -> Result<DapSessionInfo, AppError> {
    state
        .dap_manager
        .start_session(&state, app, &project_id, config_name, current_file)
        .await
}

/// Stop a DAP debug session.
#[tauri::command]
pub async fn dap_stop_session(
    session_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    state.dap_manager.stop_session(&session_id).await
}

/// Get the active DAP session for a project.
#[tauri::command]
pub async fn dap_get_session(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<Option<DapSessionInfo>, AppError> {
    Ok(state.dap_manager.active_for_project(&project_id).await)
}

/// List all active DAP sessions.
#[tauri::command]
pub async fn dap_list_sessions(
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<DapSessionInfo>, AppError> {
    Ok(state.dap_manager.list_sessions().await)
}

/// Set breakpoints for a file.
#[tauri::command]
pub async fn dap_set_breakpoints(
    project_id: String,
    file_path: String,
    lines: Vec<u32>,
    session_id: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<BreakpointSpec>, AppError> {
    state
        .dap_manager
        .set_breakpoints(
            &state,
            &project_id,
            &file_path,
            lines,
            session_id.as_deref(),
        )
        .await
}

/// Get breakpoints for a project.
#[tauri::command]
pub async fn dap_get_breakpoints(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<BreakpointSpec>, AppError> {
    state.dap_manager.get_breakpoints(&state, &project_id).await
}

/// Send a control action (continue, next, etc.) to a DAP session.
#[tauri::command]
pub async fn dap_control(
    session_id: String,
    action: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let session = state
        .dap_manager
        .get_session(&session_id)
        .await
        .ok_or_else(|| AppError::NotFound(format!("Session not found: {session_id}")))?;
    session.control(&action).await
}

/// Get the stack trace for a DAP session.
#[tauri::command]
pub async fn dap_stack_trace(
    session_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<StackFrameDto>, AppError> {
    let session = state
        .dap_manager
        .get_session(&session_id)
        .await
        .ok_or_else(|| AppError::NotFound(format!("Session not found: {session_id}")))?;
    session.stack_trace().await
}

/// Get variables for a stack frame.
#[tauri::command]
pub async fn dap_variables(
    session_id: String,
    frame_id: i64,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<VariableDto>, AppError> {
    let session = state
        .dap_manager
        .get_session(&session_id)
        .await
        .ok_or_else(|| AppError::NotFound(format!("Session not found: {session_id}")))?;
    session.scopes_variables(frame_id).await
}

/// Evaluate an expression in a debug session.
#[tauri::command]
pub async fn dap_evaluate(
    session_id: String,
    expression: String,
    frame_id: Option<i64>,
    state: State<'_, AppStateWrapper>,
) -> Result<String, AppError> {
    let session = state
        .dap_manager
        .get_session(&session_id)
        .await
        .ok_or_else(|| AppError::NotFound(format!("Session not found: {session_id}")))?;
    session.evaluate(&expression, frame_id).await
}

/// Check whether the adapter for a launch type (`go`, `lldb`, …) is available
/// in the **project** environment (Local / WSL / SSH).
#[tauri::command]
pub async fn dap_check_adapter(
    project_id: String,
    adapter_type: String,
    state: State<'_, AppStateWrapper>,
) -> Result<bool, AppError> {
    let env = state.project_environment(&project_id)?;
    let target = env.to_exec_target();
    Ok(adapter::adapter_available(&adapter_type, &target).await)
}
