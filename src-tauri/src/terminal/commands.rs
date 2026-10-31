//! Tauri commands for terminal session lifecycle.

#[allow(clippy::wildcard_imports)]
use crate::common::terminal::types::*;
use crate::AppError;
use crate::AppStateWrapper;
use tauri::State;

/// Creates a new PTY terminal session addressed by Workspace.
///
/// 运行根（cwd）由后端从 Workspace 身份派生：缺省 = `repo.root()`（工作树根 /
/// 项目根），`working_dir` 为可选的 Workspace 内子目录覆盖。
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn create_terminal_session(
    workspace: crate::common::git::WorkspaceSession,
    cols: u16,
    rows: u16,
    shell: Option<String>,
    working_dir: Option<String>,
    command: Option<String>,
    state: State<'_, AppStateWrapper>,
    app_handle: tauri::AppHandle,
) -> Result<TerminalSession, AppError> {
    // 唯一解析入口：Workspace 身份 → (项目环境, 执行目标, 已解析 WorkspaceRef)——一次读项目取齐。
    // 禁止退化成按 project 解析（会丢 worktree 维度，worktree 视图静默按主仓执行）。
    let (environment, target, repo) = state.resolve_workspace_target_with_env(&workspace).await?;
    // 运行根 = 该 Workspace 的根（子目录覆盖只影响进程 cwd，不影响主题等项目级产物）。
    let workspace_root = repo.root();
    // 缺省 cwd = 该 Workspace 的根；可选覆盖须落在根之内（越界 → InvalidInput）。
    let cwd = crate::terminal::services::resolve_terminal_cwd(
        &target,
        workspace_root,
        working_dir.as_deref(),
    )
    .await?;
    state
        .terminal_router
        .create_session(
            crate::terminal::SessionSpec {
                env: environment,
                workspace_root: workspace_root.to_string(),
                cwd,
                cols,
                rows,
                shell,
                // 命令层只会创建**任务终端**：一段 shell 命令行（argv 形态属团队成员）。
                launch: command.map(crate::terminal::TerminalLaunch::Shell),
                // 普通终端会话没有身份要注入；团队成员走团队域的执行层（带 `member_env`）。
                extra_env: Vec::new(),
            },
            app_handle,
        )
        .await
}

/// Closes a terminal session by ID.
#[tauri::command]
pub fn close_terminal_session(session_id: String, state: State<AppStateWrapper>) {
    state.terminal_router.close_session(&session_id);
}

/// Resizes a terminal session to the specified column/row dimensions.
#[tauri::command]
pub fn resize_terminal(
    session_id: String,
    cols: u16,
    rows: u16,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    state
        .terminal_router
        .resize_session(&session_id, cols, rows)
}

/// Drains all buffered terminal output for a session as raw bytes.
///
/// 内存治理（credit-pull 协议）：数据走二进制 Response（前端得 ArrayBuffer），
/// 零 JSON 序列化开销。前端由全局共享轮询器（`createPollingDrainScheduler`，
/// 100ms tick）定期拉取 —— 无 wake-hint 事件（方案 B 去 eval 化）。
///
/// 必须保持 async：同步命令在 Tauri 主线程执行，多会话并发输出时 drain
/// invoke 洪泛会挤占主线程，饿死 create_terminal_session 等全部命令
/// （冻结故障回炉，任务 design.md §8.1 放大器 A）。
#[tauri::command]
pub async fn terminal_drain(
    session_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<tauri::ipc::Response, AppError> {
    state.terminal_router.drain(&session_id)
}
/// Long-poll drain: 无数据时挂起至 push/close/超时（前端每 session 一条挂起 fetch）。
/// `timeout_ms` 后端钳制到 1–30s（`timeout_ms == 0` 视为 1s）。
/// 必须保持 async：挂起等待在 tokio 上执行，不占 Tauri 主线程。
#[tauri::command]
pub async fn terminal_drain_wait(
    session_id: String,
    timeout_ms: u64,
    state: State<'_, AppStateWrapper>,
) -> Result<tauri::ipc::Response, AppError> {
    state
        .terminal_router
        .drain_wait(&session_id, timeout_ms)
        .await
}
