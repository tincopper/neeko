//! Tauri commands for DAP — thin IPC only.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use super::adapter;
use super::discover::EntryPoint;
use super::launch_support::{build_shell_argv, resolve_build_dir, windows_cmd_quote};
use super::types::{BreakpointSpec, DapSessionInfo, LaunchConfig, StackFrameDto, VariableDto};
use crate::common::executor::factory::ExecTarget;
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

/// Start a DAP debug session from a synthetic launch config (editor inline
/// test debug: lldb launch with program = test binary, args = [name]).
#[tauri::command]
pub async fn dap_start_session_config(
    project_id: String,
    config: LaunchConfig,
    state: State<'_, AppStateWrapper>,
    app: AppHandle,
) -> Result<DapSessionInfo, AppError> {
    state
        .dap_manager
        .start_session_config(&state, app, &project_id, config)
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

/// Get child variables for a `variablesReference` (lazy tree expansion).
#[tauri::command]
pub async fn dap_variables_by_reference(
    session_id: String,
    variables_reference: i64,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<VariableDto>, AppError> {
    let session = state
        .dap_manager
        .get_session(&session_id)
        .await
        .ok_or_else(|| AppError::NotFound(format!("Session not found: {session_id}")))?;
    session.variables_by_reference(variables_reference).await
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

/// Maximum captured headless-build stdout (§4: 2MB 截断；PTY 合流输出永不进入解析器）。
const DEBUG_BUILD_OUTPUT_LIMIT: usize = 2 * 1024 * 1024;

/// 无头测试构建产物（DTO；cargo 语义解析留前端纯函数，命令层只做参数校验 + 调度）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DebugBuildOutput {
    /// Process exit code (non-zero = build failed, short-circuit per C2).
    pub exit_code: i32,
    /// Piped stdout, truncated to 2MB (clean pipe input for the parser).
    pub stdout: String,
}

/// Headless test-binary build for editor inline Debug (§4, C1/C4).
///
/// Runs `command` in `cwd` via the unified exec facade (piped stdout, never a
/// PTY session) and returns `{ exit_code, stdout }` with stdout truncated to
/// 2MB. `cwd` is canonicalize-validated against the project root on Local
/// (remote targets: lexical NUL check only — cannot canonicalize remotely).
#[tauri::command]
pub async fn debug_build_test_binary(
    project_id: String,
    command: String,
    cwd: String,
    state: State<'_, AppStateWrapper>,
) -> Result<DebugBuildOutput, AppError> {
    if command.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "debug build command must not be empty".into(),
        ));
    }
    if cwd.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "debug build cwd must not be empty".into(),
        ));
    }
    let (target, project_root) = state.resolve_project(&project_id)?;
    let dir = resolve_build_dir(&target, &project_root, &cwd).await?;
    // Windows 本地经 `cmd /C` 执行，前端命令的 POSIX 单引号（`cargo test 'name'`）
    // 在 cmd 下是字面字符——转成 cmd 双引号；非 Windows Local 原样透传。
    let command = if matches!(target, ExecTarget::Local) && cfg!(windows) {
        windows_cmd_quote(&command)
    } else {
        command
    };
    let (shell, args) = build_shell_argv(&command);
    let output = crate::core::exec::collect(&target, shell, &args, Some(dir.as_str()))
        .await
        .map_err(|e| AppError::Dap(format!("debug build spawn failed: {e}")))?;
    Ok(DebugBuildOutput {
        exit_code: output.exit_code,
        stdout: truncate_build_stdout(&output.stdout, DEBUG_BUILD_OUTPUT_LIMIT),
    })
}

/// Java attach-first 调试：spawn 测试 JVM（Console Launcher + jdwp suspend=y，
/// `command` 由前端 buildJavaDebugCommand 构造）→ 解析 jdwp 端口 →
/// JavaAdapter attach 会话。整段编排在 DapManager 内（JVM 生命周期随会话清理）。
#[tauri::command]
pub async fn debug_java_attach(
    project_id: String,
    command: String,
    cwd: String,
    test_name: String,
    state: State<'_, AppStateWrapper>,
    app: AppHandle,
) -> Result<DapSessionInfo, AppError> {
    state
        .dap_manager
        .start_java_attach(&state, app, &project_id, &command, &cwd, &test_name)
        .await
}

fn truncate_build_stdout(raw: &[u8], limit: usize) -> String {
    // Back off over UTF-8 continuation bytes (10xxxxxx) so the cut lands on a
    // char boundary; lossy-decode the (valid-prefix) remainder.
    let mut end = raw.len().min(limit);
    // end == raw.len() is always a boundary; only back off inside the buffer.
    while end > 0 && end < raw.len() && (raw[end] & 0xC0) == 0x80 {
        end -= 1;
    }
    String::from_utf8_lossy(&raw[..end]).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_output_deserializes_snake_case() {
        let out: DebugBuildOutput =
            serde_json::from_str(r#"{"exit_code":101,"stdout":"error"}"#).expect("valid dto");
        assert_eq!(
            out,
            DebugBuildOutput {
                exit_code: 101,
                stdout: "error".into()
            }
        );
        let back = serde_json::to_value(&out).expect("serializable");
        assert_eq!(back["exit_code"], 101);
        assert_eq!(back["stdout"], "error");
    }

    #[test]
    fn truncate_keeps_short_stdout_intact() {
        assert_eq!(
            truncate_build_stdout(b"ok\n", DEBUG_BUILD_OUTPUT_LIMIT),
            "ok\n"
        );
        assert_eq!(truncate_build_stdout(b"", DEBUG_BUILD_OUTPUT_LIMIT), "");
    }

    #[test]
    fn truncate_cuts_at_limit_on_char_boundary() {
        // Multi-byte chars: limit inside an `é` (2 bytes) must back off, never panic.
        let raw = "é".repeat(100);
        let out = truncate_build_stdout(raw.as_bytes(), 101);
        assert!(out.len() <= 101);
        assert_eq!(out, "é".repeat(50));
        // Exact limit keeps everything.
        let out = truncate_build_stdout(raw.as_bytes(), 200);
        assert_eq!(out, raw);
    }
}
