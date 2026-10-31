//! chat 生产者：`StreamEvent → Signal`（纯函数）+ 合帧批次内的批量投影。
//!
//! 接线点是既有的唯一汇聚处 `agent::chat::commands::spawn_session_pipeline`
//! （会话注册 / 16ms 合帧 emit / 通知投影 / 结束注销都在那里）——
//! **不新增事件通道**，注册表只是同一批事件的另一个消费者。

use crate::agent::chat::events::{SequencedEvent, StreamEvent};
use crate::common::git::WorkspaceSession;
use crate::live_sessions::emit_changed;
use crate::live_sessions::entry::{SessionEntry, SessionKind, TitleSource};
use crate::live_sessions::registry::Registry;
use crate::live_sessions::state::Signal;
use crate::live_sessions::title;

/// 注册 chat 会话所需的原生输入。
///
/// 与命令层的 `StreamRequest` 解耦：wiring 只认识「事实」，不依赖 IPC 载荷类型，
/// 于是它的单测不需要构造整个 `AppStateWrapper`。
#[derive(Debug, Clone, Copy)]
pub(crate) struct ChatRegistration<'a> {
    /// 会话 id（`agent_stream` 返回给前端的同一个）。
    pub session_id: &'a str,
    /// Agent identifier。
    pub agent_id: &'a str,
    /// 执行地址。
    pub workspace: &'a WorkspaceSession,
    /// 已解析的执行根。
    pub cwd: &'a str,
    /// 恢复会话时前端传入的 agent 原生标题（`StreamRequest.topic`）。
    pub topic: Option<&'a str>,
    /// 首轮 prompt（新会话的标题素材）。
    pub prompt: &'a str,
}

/// 事件 → 信号（**唯一**映射点；未列入的事件是纯载荷，不改变状态）。
///
/// `Error` 之后的 `TurnEnd` 仍会到达（pi 实测），由 `state::reduce` 的终止吸收丢弃。
///
/// # 为什么内容事件也发 `TurnStarted`
///
/// `TurnStart` 不是每个传输都发：pi 传输**从不产出** `StreamEvent::TurnStart`
/// （`pi_rpc/session.rs` 的翻译表里没有那个臂）。只认 `TurnStart` 的话，pi 会话在整轮
/// 对话期间都停在 `Ready` —— 侧栏与 tab 的状态点看起来「永远是同一个」，这正是
/// 2026-10-31 的实测反馈。**内容流动就是在跑**：首个 `TextDelta` / `ToolStart` 落到
/// `Running`，`TurnEnd` 落回 `Ready`。`Running + TurnStarted` 是幂等的，ACP 同时发
/// `TurnStart` 也不会多翻一次。
#[must_use]
pub(crate) const fn signal_of(event: &StreamEvent) -> Option<Signal> {
    match event {
        StreamEvent::SessionStart { .. } | StreamEvent::ContextInit { .. } => Some(Signal::Created),
        StreamEvent::TurnStart { .. }
        | StreamEvent::TextDelta { .. }
        | StreamEvent::ReasoningDelta { .. }
        | StreamEvent::ToolStart { .. }
        | StreamEvent::ToolOutput { .. }
        | StreamEvent::ToolEnd { .. }
        | StreamEvent::CommandRun { .. }
        | StreamEvent::TodoUpdated { .. }
        | StreamEvent::FileDiff { .. } => Some(Signal::TurnStarted),
        StreamEvent::RequestApproval { .. } => Some(Signal::ApprovalRequested),
        StreamEvent::UserInput { .. } => Some(Signal::ApprovalResolved),
        StreamEvent::TurnEnd { .. } => Some(Signal::TurnFinished),
        StreamEvent::Error { .. } => Some(Signal::Failed),
        StreamEvent::SessionDone { .. } => Some(Signal::Exited),
        _ => None,
    }
}

/// 注册 chat 会话：标题按来源质量取最强（`topic` > `prompt`），都没有就**留空**。
///
/// 不留 agent 名当占位：`pi` / `claude-code` 这类 id 对用户没有意义，而会话行本身
/// 就在单元下面（项目名也是冗余的）。空标题由视图解释 —— 侧栏只画图标、tab 兜底
/// `tab.title`；首条 prompt 一到就自动升级成真标题。
fn register(registry: &Registry, input: ChatRegistration<'_>) -> bool {
    let candidates = [
        (TitleSource::Native, input.topic.unwrap_or("")),
        (TitleSource::Prompt, input.prompt),
    ];
    let title = title::pick(&candidates).unwrap_or((TitleSource::Placeholder, String::new()));
    registry.register(SessionEntry::new(
        input.session_id,
        SessionKind::Chat,
        Some(input.agent_id.to_string()),
        input.workspace.clone(),
        input.cwd,
        title,
    ))
}

/// 登记 + 通知前端（chat 的**唯一**登记入口，与 `wiring::pty` 的三个通知入口对称）。
///
/// 通知与登记绑定在同一处：分散到调用点的话，新增一个生产者忘写 `emit_changed` 的表现
/// 是「侧栏不刷新、无报错、无日志」。
pub(crate) fn register_and_notify(
    registry: &Registry,
    app: &tauri::AppHandle,
    input: ChatRegistration<'_>,
) {
    register(registry, input);
    emit_changed(app, registry.version());
}

/// 投影一个合帧批次（在 `emit` 闭包里与通知投影并列调用）。
///
/// 返回「本批次是否真的改变了状态」—— 调用方据此决定是否发变更事件
/// （R2.3：审批往返等抖动不得刷爆 IPC）。
pub(crate) fn observe(registry: &Registry, session_id: &str, events: &[SequencedEvent]) -> bool {
    let mut changed = false;
    for sequenced in events {
        if let Some(signal) = signal_of(&sequenced.event) {
            changed |= registry.apply(session_id, signal);
        }
    }
    changed
}

#[cfg(test)]
mod tests;
