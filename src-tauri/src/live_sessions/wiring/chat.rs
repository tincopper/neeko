//! chat 生产者：`StreamEvent → Signal`（纯函数）+ 合帧批次内的批量投影。
//!
//! 接线点是既有的唯一汇聚处 `agent::chat::commands::spawn_session_pipeline`
//! （会话注册 / 16ms 合帧 emit / 通知投影 / 结束注销都在那里）——
//! **不新增事件通道**，注册表只是同一批事件的另一个消费者。
//!
//! # 第二条接线点：续聊
//!
//! `agent_stream` 命中既有会话（`manager.owns`）后会直接把 Turn 投给会话、**不进**
//! `spawn_session_pipeline`。`agent_chat_open` 建了静默会话、用户再发第一条消息时走的就是
//! 这条分支 —— 所以 [`register_or_engage`] 必须能对「已登记的 `Silent` 会话」补上
//! 标题与 `has_user_input`，否则那条会话永远不会出现在侧栏。

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
    /// 启动形态（登记时的初始可见性 + 已登记会话是否补做 Engage，见 [`ChatRegistrationKind`]）。
    pub kind: ChatRegistrationKind,
}

/// chat 会话的启动形态。
///
/// 同一枚举读两次，因为「第一次出现」与「用户真的用起来了」是两件事，可能不同时发生：
///
/// | 形态 | 登记时可见 | 登记后遇到 `Turn` 时 |
/// | --- | --- | --- |
/// | `Silent` | 否 | 补标题 + 置位（`report_first`） |
/// | `Turn` / `Resume` | 是 | 什么也不做（续聊）|
#[derive(Debug, Clone, Copy)]
pub(crate) enum ChatRegistrationKind {
    /// `agent_stream`：用户刚发出**第一条消息**。标题此刻就有 ⇒ 立刻可见。
    Turn,
    /// `agent_chat_resume`：恢复一条**已有历史**的对话，直接可见。
    Resume,
    /// `agent_chat_open`：静默建连（只为拿 configOptions）—— 用户还没用它，不可见。
    Silent,
}

impl ChatRegistrationKind {
    /// 登记时的初始可见性。
    const fn has_user_input(self) -> bool {
        matches!(self, Self::Turn | Self::Resume)
    }
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

/// 注册 chat 会话的标题素材与初始可见性（见 [`ChatRegistration`]）。
///
/// 两个派生项都放在 `impl` 里：`register_or_engage` 的两条分支（首次登记 / 首次 Engage）
/// 必须用**同一份**标题素材，否则「登记时的名字」与「被用起来的名字」会分叉。
impl ChatRegistration<'_> {
    /// 标题素材：`topic`（Native）> `prompt`（Prompt）；都没有 ⇒ `None`。
    ///
    /// 不留 agent 名当占位：`pi` / `claude-code` 这类 id 对用户没有意义，而会话行本身
    /// 就在单元下面（项目名也是冗余的）。空标题由视图解释 —— 未 Engage 前侧栏不列，
    /// tab 回退 `tab.title`；首条 prompt 一到就自动升级成真标题。
    fn title(&self) -> Option<(TitleSource, String)> {
        let candidates = [
            (TitleSource::Native, self.topic.unwrap_or("")),
            (TitleSource::Prompt, self.prompt),
        ];
        title::pick(&candidates)
    }

    /// 登记用的条目（初始可见性取启动形态）。
    fn entry(&self) -> SessionEntry {
        let title = self
            .title()
            .unwrap_or((TitleSource::Placeholder, String::new()));
        SessionEntry::new(
            self.session_id,
            SessionKind::Chat,
            Some(self.agent_id.to_string()),
            self.workspace.clone(),
            self.cwd,
            title,
        )
        .with_user_input(self.kind.has_user_input())
    }
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
    if register_or_engage(registry, input) {
        emit_changed(app, registry.version());
    }
}

/// 续聊（`agent_stream` 命中既有会话）的唯一 Engage 入口。
///
/// 续聊命令不会进入 `spawn_session_pipeline`，因此不能复用
/// [`register_and_notify`]（它需要一份完整的登记素材）；但「用户确实在用」的
/// 语义必须与首次登记完全一致，故仍由本文件唯一拥有。
pub(crate) fn engage_existing(
    registry: &Registry,
    app: &tauri::AppHandle,
    session_id: &str,
    prompt: &str,
) -> bool {
    let changed = engage_registered(registry, session_id, Some((TitleSource::Prompt, prompt)));
    if changed {
        emit_changed(app, registry.version());
    }
    changed
}

/// 对**已登记**会话做一次 Engage；不依赖 Tauri AppHandle，命令层与接线层共用。
///
/// `report_first` 把「首次置位 / 无标题时补名 / 已有标题不覆盖」的门控放在 Registry
/// 锁内；这里只负责把标题素材转换成统一的上报形状，避免命令层复述 `TitleSource::Prompt`。
fn engage_registered(
    registry: &Registry,
    session_id: &str,
    title: Option<(TitleSource, &str)>,
) -> bool {
    registry.report_first(session_id, title)
}

/// 「首次出现就登记，之后再出现只做一次 Engage」的**唯一**决策（可直测，不需要 `AppHandle`）。
///
/// 每轮 `agent_stream` 都会走到这里，而续聊的会话 id 与首轮相同：
///
/// 1. **未登记** ⇒ 登记（`register_if_absent`：「首次出现」这条判据在锁内成立一次）；
/// 2. **已登记** ⇒ 只可能是两种情况，由 `kind` 区分：
///    - `Silent`（`agent_chat_open` 静默建连）— 什么也不做；
///    - `Turn` / `Resume`（用户真的在用它）— `report_first`：**第一次** Engage 补上标题 +
///      置位，续聊什么都不写（会话名取第一次的素材，侧栏不闪）。
///
/// 第 2 条是 `agent_chat_open` → `agent_stream` 续聊主链路的**唯一**可见性来源：那条分支
/// 命中 `manager.owns` 后会提前返回，不进 `spawn_session_pipeline`，因此不经过登记。
fn register_or_engage(registry: &Registry, input: ChatRegistration<'_>) -> bool {
    if registry.register_if_absent(input.entry()) {
        return true;
    }
    if !input.kind.has_user_input() {
        return false;
    }
    let title = input.title();
    engage_registered(
        registry,
        input.session_id,
        title
            .as_ref()
            .map(|(source, text)| (*source, text.as_str())),
    )
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
