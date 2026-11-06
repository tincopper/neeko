//! live-sessions IPC：快照 + long-poll 版本等待（命令层极薄，红线 6）。

use std::time::Duration;

use tauri::State;

use crate::live_sessions::entry::TitleSource;
use crate::live_sessions::events::emit_changed;
use crate::live_sessions::registry::Registry;
use crate::live_sessions::view::{LiveSessionsSnapshot, LiveSessionsWait};
use crate::{AppError, AppStateWrapper};

/// 长轮询默认挂起时长（前端 25s 续挂；后端上限内自兜底）。
const WAIT_TIMEOUT_DEFAULT_MS: u64 = 25_000;
/// 后端允许的最短挂起（低于它等价于空转轮询）。
const WAIT_TIMEOUT_MIN: Duration = Duration::from_secs(1);
/// 后端允许的最长挂起（与 `terminal_drain_wait` 同为 30s 上限）。
const WAIT_TIMEOUT_MAX: Duration = Duration::from_secs(30);

/// 把请求的挂起时长钳制进允许区间（纯函数，便于单测）。
///
/// `None` / `Some(0)` = 用默认值：前端把「没想法」和「立刻返回」混为一谈时，
/// 默认值必须是一个**有用的**挂起时长（否则退化成忙循环）。
#[must_use]
fn clamp_wait_timeout(timeout_ms: Option<u64>) -> Duration {
    let requested = match timeout_ms {
        Some(ms) if ms > 0 => ms,
        _ => WAIT_TIMEOUT_DEFAULT_MS,
    };
    Duration::from_millis(requested).clamp(WAIT_TIMEOUT_MIN, WAIT_TIMEOUT_MAX)
}

/// 列出 live session 快照（**全量**，不分单元）。
///
/// 快照要同时服务三种视图（侧栏按单元 / tab 标题 / 连接页），各视图的分组口径不同；
/// 后端只交出一份完整、稳定排序的快照，按 `workspaceKey` 等值的分组由前端 selector 完成。
/// 曾经的 `workspace: Option<WorkspaceSession>` 参数从未被调用方使用，却让这里多出一套
/// 与前端并行的「单元归属」判据（`UnitScope::owns` 按 cwd 最深根 vs 前端按 key 等值）——
/// 两套判据迟早对不上，故删除。
#[tauri::command]
pub async fn list_live_sessions(
    state: State<'_, AppStateWrapper>,
) -> Result<LiveSessionsSnapshot, AppError> {
    Ok(state.live_sessions.snapshot_view())
}

/// 版本未变则挂起，直到注册表版本变化或超时（credit-pull：不推全量快照）。
///
/// 返回 `changed: false` 表示「这段时间没有任何变更」—— 前端据此续挂，**不得**当成
/// 数据到达（那会让空闲期每 25s 重拉一次快照）。
#[tauri::command]
pub async fn wait_live_sessions(
    since: u64,
    timeout_ms: Option<u64>,
    state: State<'_, AppStateWrapper>,
) -> Result<LiveSessionsWait, AppError> {
    let timeout = clamp_wait_timeout(timeout_ms);
    let version = state.live_sessions.wait_for_change(since, timeout).await;
    Ok(LiveSessionsWait {
        version,
        changed: version != since,
    })
}

/// 终端上报「用户提交过输入」—— 行文本随活动一起到达，**能否命名由注册表按会话类型裁决**。
///
/// # 源隔离仍然成立（第 35 轮），但多了一个**纯 shell** 例外（第 37 轮）
///
/// OSC 标题（`onTitleChange`）依旧完全不进注册表 —— 它与状态栏、cwd、spinner、
/// TUI 控件文本共用通道。行文本的分流在 [`Registry::report_terminal_input`]：
///
/// | 会话 | 这行能不能当标题 | 理由 |
/// | --- | --- | --- |
/// | 纯 shell（`agent_id = None`） | **能** | 它没有 hook / conversation 缓存，这是唯一素材 |
/// | agent 终端（`agent_id = Some`） | **不能** | 里面混着 `/model` 过滤词这类 TUI 面板输入 |
///
/// 命令体只有派发（红线 6）：裁决不在命令层 —— 它要读 `agent_id`，而那是注册表里的事实。
#[allow(clippy::unnecessary_wraps)] // 返回形状是 IPC 契约，不是当下的错误路径
#[tauri::command]
pub fn report_live_session_activity(
    session_id: String,
    line: String,
    state: State<'_, AppStateWrapper>,
    app_handle: tauri::AppHandle,
) -> Result<bool, AppError> {
    let changed = state
        .live_sessions
        .report_terminal_input(&session_id, &line);
    notify(&state.live_sessions, &app_handle, changed);
    Ok(changed)
}

/// 侧栏行内改名：**来源恒为 `User`**，IPC 不接受前端声明的 `source`。
///
/// 这是唯一从前端写标题的入口。`Native` / `Prompt` 由各生产者直接写注册表（hook topic /
/// conversation 缓存 / 终端活动 / chat 的 prompt），不经 IPC —— 让前端可控来源等于给
/// 任意字节流开一条伪装成 provider title 的路。
#[allow(clippy::unnecessary_wraps)] // 同上：返回形状是契约
#[tauri::command]
pub fn rename_live_session(
    session_id: String,
    title: String,
    state: State<'_, AppStateWrapper>,
    app_handle: tauri::AppHandle,
) -> Result<bool, AppError> {
    let changed = state
        .live_sessions
        .set_title(&session_id, TitleSource::User, &title);
    notify(&state.live_sessions, &app_handle, changed);
    Ok(changed)
}

/// 真变化才发一次版本号（载荷只有版本号，与其它生产者同口径）。
fn notify(registry: &Registry, app_handle: &tauri::AppHandle, changed: bool) {
    if changed {
        emit_changed(app_handle, registry.version());
    }
}

/// 恢复成功后，让新会话**继承**旧会话的身份并让旧条目退场。
///
/// 关 tab 只把条目标成 `Stopped`（见 `lifecycle::close_and_notify`），于是侧栏仍留着
/// 「点回来」的入口。用户点回来后，新 PTY 是那条会话的**延续**：
///
/// - 不继承 ⇒ 新会话要等用户敲第一条输入才会被列出，表现是「点了恢复，那一行反而消失了」；
/// - 不退场 ⇒ 侧栏同时挂着「已停止」与「新会话」两行。
///
/// 语义全在 [`Registry::adopt`]：只接受**终止态**的 `from`，且只搬 `into` 缺的字段。
#[tauri::command]
pub fn adopt_live_session(
    from_session_id: String,
    into_session_id: String,
    state: State<'_, AppStateWrapper>,
    app_handle: tauri::AppHandle,
) -> bool {
    let adopted = state
        .live_sessions
        .adopt(&from_session_id, &into_session_id);
    if adopted {
        emit_changed(&app_handle, state.live_sessions.version());
    }
    adopted
}

/// 这条会话的**原生恢复命令**（`["--resume", "<native id>"]` 这类）；`None` = 不支持。
///
/// 点击侧栏会话行、需要重建 tab 时调用：拿到的 args 由前端拼进 `taskCommand`，于是新建的
/// 终端是**续写**而不是重开（与 Histor 面板的恢复路径同形）。
///
/// 判据全在后端，前端不维护能力表：
/// - `native_session_id` 只来自 CLI hook（neeko 自己的 `session_id` 对 CLI 无意义，
///   拼不出 `--resume`）；
/// - 「这个 agent 支不支持原生恢复」由 adapter 回答；
/// - 无 hook 的会话（或需要 file path 的 adapter）返回 `None` —— 前端退回「新建一个同
///   agent 的终端」，不猜。
#[tauri::command]
pub fn live_session_resume_command(
    session_id: String,
    state: State<'_, AppStateWrapper>,
) -> Option<Vec<String>> {
    let entry = state.live_sessions.entry(&session_id)?;
    let agent_id = entry.agent_id?;
    let native_session_id = entry.native_session_id?;
    state
        .conversation_manager
        .resume_command_for_native(&agent_id, &native_session_id, &entry.cwd)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timeout_defaults_to_25_seconds() {
        assert_eq!(clamp_wait_timeout(None), Duration::from_millis(25_000));
        assert_eq!(clamp_wait_timeout(Some(0)), Duration::from_millis(25_000));
    }

    #[test]
    fn timeout_is_clamped_into_the_allowed_range() {
        assert_eq!(clamp_wait_timeout(Some(500)), WAIT_TIMEOUT_MIN);
        assert_eq!(clamp_wait_timeout(Some(5_000)), Duration::from_secs(5));
        assert_eq!(clamp_wait_timeout(Some(60_000)), WAIT_TIMEOUT_MAX);
        assert_eq!(clamp_wait_timeout(Some(u64::MAX)), WAIT_TIMEOUT_MAX);
    }

    /// IPC 契约：改名命令**没有** `source` 参数。
    ///
    /// 前端可控的来源曾让任意终端字节流伪装成 `Native` 覆盖用户改名（第 35 轮事故）；
    /// 现在来源由命令体固定为 `User`，这条断言是它的编译期钉子。
    #[test]
    fn rename_command_takes_no_source() {
        let _: for<'a> fn(
            String,
            String,
            tauri::State<'a, AppStateWrapper>,
            tauri::AppHandle,
        ) -> Result<bool, AppError> = rename_live_session;
    }

    /// IPC 契约：终端活动命令收 `(sessionId, line)`，**不接受**来源或标题类型。
    ///
    /// 「这行能不能当标题」的裁决在 `Registry::report_terminal_input`（读 `agent_id`），
    /// 命令层只转发 —— 参数里一旦出现 `source` / `titleSource`，就说明裁决又跑回了命令层。
    #[test]
    fn activity_command_takes_only_the_line() {
        let _: for<'a> fn(
            String,
            String,
            tauri::State<'a, AppStateWrapper>,
            tauri::AppHandle,
        ) -> Result<bool, AppError> = report_live_session_activity;
    }
}
