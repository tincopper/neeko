//! Tauri commands for DAP — thin IPC only.
//!
//! 命令层只做参数接收 + 调度（AGENTS.md Review Gate #6）：会话/断点/配置编排在
//! [`super::manager`]，无头构建在 [`super::build`]，进程与目录控制细节不在本层。

use tauri::{AppHandle, State};

use super::build;
use super::discover::EntryPoint;
use super::manager::DapManager;
use super::types::{
    BreakpointLine, BreakpointSpec, DapSessionInfo, DebugBuildOutput, JavaDebugTarget,
    JavaJdtlsTarget, LaunchConfig, StackFrameDto, VariableDto,
};
use crate::common::types::FileContent;
use crate::AppError;
use crate::AppStateWrapper;

/// List launch configs for a project.
#[tauri::command]
pub fn dap_list_configs(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<LaunchConfig>, AppError> {
    DapManager::list_or_discover_configs(&state, &project_id)
}

/// Save launch configs for a project.
#[tauri::command]
pub fn dap_save_configs(
    project_id: String,
    configurations: Vec<LaunchConfig>,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    DapManager::save_configs(&state, &project_id, configurations)
}

/// Discover entry points for a project.
#[tauri::command]
pub fn dap_discover_entries(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<EntryPoint>, AppError> {
    DapManager::discover_entries(&state, &project_id)
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
    breakpoints: Vec<BreakpointLine>,
    session_id: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<BreakpointSpec>, AppError> {
    state
        .dap_manager
        .set_breakpoints(
            &state,
            &project_id,
            &file_path,
            breakpoints,
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

/// Set the global-mute flag for a project（per-project 单 bool）。
#[tauri::command]
pub async fn dap_set_breakpoints_muted(
    project_id: String,
    muted: bool,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    state
        .dap_manager
        .set_breakpoints_muted(&state, &project_id, muted)
        .await
}

/// Get the global-mute flag for a project.
#[tauri::command]
pub async fn dap_get_breakpoints_muted(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<bool, AppError> {
    state
        .dap_manager
        .get_breakpoints_muted(&state, &project_id)
        .await
}

/// Send a control action (continue, next, etc.) to a DAP session.
#[tauri::command]
pub async fn dap_control(
    session_id: String,
    action: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    state.dap_manager.control(&session_id, &action).await
}

/// Get the stack trace for a DAP session.
#[tauri::command]
pub async fn dap_stack_trace(
    session_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<StackFrameDto>, AppError> {
    state.dap_manager.stack_trace(&session_id).await
}

/// Fetch the source content behind a DAP `sourceReference` (adapters that keep
/// sources off-disk: remote debuggees, debuggee-provided sources).
#[tauri::command]
pub async fn dap_source_content(
    session_id: String,
    source_reference: i64,
    state: State<'_, AppStateWrapper>,
) -> Result<String, AppError> {
    state
        .dap_manager
        .source_content(&session_id, source_reference)
        .await
}

/// Read a stopped stack frame's source file even when it lives outside the
/// project root (third-party / stdlib code), read-only.
///
/// 授权模型见 [`super::external_source`]：凭据是「会话正停在该路径」，由
/// manager 复核当前调用栈；单次读取设 512KB 上限。前端在项目内读取失败后
/// 兜底调用，失败不建 tab。
#[tauri::command]
pub async fn dap_read_external_source(
    project_id: String,
    session_id: String,
    path: String,
    state: State<'_, AppStateWrapper>,
) -> Result<FileContent, AppError> {
    super::external_source::read_external_source(&state, &project_id, &session_id, &path).await
}

/// Get variables for a stack frame.
#[tauri::command]
pub async fn dap_variables(
    session_id: String,
    frame_id: i64,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<VariableDto>, AppError> {
    state.dap_manager.variables(&session_id, frame_id).await
}

/// Get child variables for a `variablesReference` (lazy tree expansion).
#[tauri::command]
pub async fn dap_variables_by_reference(
    session_id: String,
    variables_reference: i64,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<VariableDto>, AppError> {
    state
        .dap_manager
        .variables_by_reference(&session_id, variables_reference)
        .await
}

/// Evaluate an expression in a debug session.
#[tauri::command]
pub async fn dap_evaluate(
    session_id: String,
    expression: String,
    frame_id: Option<i64>,
    state: State<'_, AppStateWrapper>,
) -> Result<String, AppError> {
    state
        .dap_manager
        .evaluate(&session_id, &expression, frame_id)
        .await
}

/// Check whether the adapter for a launch type (`go`, `lldb`, …) is available
/// in the **project** environment (Local / WSL / SSH).
#[tauri::command]
pub async fn dap_check_adapter(
    project_id: String,
    adapter_type: String,
    state: State<'_, AppStateWrapper>,
) -> Result<bool, AppError> {
    DapManager::check_adapter(&state, &project_id, &adapter_type).await
}

/// Headless build for editor inline Debug (§4, C1/C4)：参数校验、构建目录校验、
/// 执行与双流截断均在 [`super::build`]（命令层只做调度）。
#[tauri::command]
pub async fn debug_build_test_binary(
    project_id: String,
    command: String,
    cwd: String,
    state: State<'_, AppStateWrapper>,
) -> Result<DebugBuildOutput, AppError> {
    build::build_test_binary(&state, &project_id, &command, &cwd).await
}

/// Java attach-first 调试：spawn 测试 JVM（Console Launcher + jdwp suspend=y，
/// `command` 由前端 buildJavaDebugCommand 构造）→ 解析 jdwp 端口 →
/// JavaAdapter attach 会话。编排在 Java 语言后端（`adapter::java::backend`），
/// JVM 生命周期随会话清理。
/// `classpath` 为 debuggee 运行时 classpath 条目（前端 buildJavaClasspathEntries），
/// 供 host 解析库源码。
#[tauri::command]
pub async fn debug_java_attach(
    project_id: String,
    command: String,
    cwd: String,
    test_name: String,
    classpath: Vec<String>,
    state: State<'_, AppStateWrapper>,
    app: AppHandle,
) -> Result<DapSessionInfo, AppError> {
    let target = JavaDebugTarget {
        command,
        cwd,
        test_name,
        classpath,
    };
    match state
        .dap_manager
        .start_language_debug(
            &state,
            app,
            crate::dap::adapter::DebugRequest::JavaAttach { project_id, target },
        )
        .await?
    {
        // A 路径 attach-first：成功即会话（无 Warming/Unavailable 分支 —— 探测在 plan 内，
        // 不可用以 Err 上抛）。
        crate::dap::adapter::DebugStartOutcome::Session { session } => Ok(session),
        crate::dap::adapter::DebugStartOutcome::Warming { detail } => Err(AppError::Dap(format!(
            "java debug warming unexpectedly: {detail}"
        ))),
        crate::dap::adapter::DebugStartOutcome::Unavailable { message, .. } => {
            Err(AppError::Dap(message))
        }
    }
}

/// B'（JDTLS 后端）调试：能力探测 → 直连 JDTLS 内 DAP 端口 → `launch`。
///
/// 只做参数接收 + 调度（编排在 [`DapManager::start_language_debug`]）。结果三态
/// （`session` / `warming` / `unavailable`）**不含自动换引擎**：不可用时由前端按
/// `staticallyDetectable` 决定"一次性询问改用 Host"还是"报错 + 显式入口"；
/// A（host）路径仍走 `debug_java_attach`。
#[tauri::command]
pub async fn debug_java_start(
    project_id: String,
    target: JavaJdtlsTarget,
    state: State<'_, AppStateWrapper>,
    app: AppHandle,
) -> Result<crate::dap::adapter::DebugStartOutcome, AppError> {
    state
        .dap_manager
        .start_language_debug(
            &state,
            app,
            crate::dap::adapter::DebugRequest::JavaJdtls { project_id, target },
        )
        .await
}
