//! Live session 的运行时词表与条目形状（无 IO，可直测）。
//!
//! 词表**刻意不复用** `agent::chat::session_store::SessionStatus`：那是持久化词表
//! （只有 `Closed`，没有被 `Failed` / `Stopped` 区分的必要），且被 `agent_sessions.db`
//! 的 `status` 列语义绑住。运行时词表与持久化词表之间只有一条单向投影
//! （`cursor::from_entry`）—— 否则「加一个 UI 状态」就要改数据库语义。

use chrono::{DateTime, Utc};

use serde::{Deserialize, Serialize};

// 词表本体在 `common::agent::title`（conversation 也要用同一份判据）；
// 这里 `pub use` 保持 `entry::TitleSource` 的既有路径可用。
pub use crate::common::agent::title::TitleSource;
use crate::common::git::WorkspaceSession;

/// 会话种类。
///
/// 新增种类 = 加一个 variant + 一个 wiring 生产者（`wiring/{chat,pty}.rs`）；
/// 状态机（`state::reduce`）与快照接口不变。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionKind {
    /// Agent Chat 会话（长驻 agent 进程 + 事件流）。
    Chat,
    /// 终端会话（本地 PTY / WSL / SSH）。
    Terminal,
}

/// 运行时状态（视图**只渲染**它，不得推断）。
///
/// **不派生 `Ord`**：状态之间没有大小关系，只有「多会话单元里谁最需要注意」这一条
/// 优先级（`awaitingApproval > running > failed > ready > stopped`），那条规则属于
/// 视图（前端 `STATE_RANK`）。给枚举加一个隐式声明序会让 `sort_by_key(|s| s.state)`
/// 静默排出另一套语义，而编译器不会报错。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionState {
    /// 就绪 / 空闲（等待下一轮）。
    Ready,
    /// 正在处理一轮（terminal：进程活着即为该态，不做「静默 N 秒 ⇒ Idle」推断）。
    Running,
    /// 等待用户审批 / 澄清。
    AwaitingApproval,
    /// 失败终止。
    Failed,
    /// 正常终止（进程退出 / 会话关闭）。
    Stopped,
}

impl SessionState {
    /// 是否已终止。终止态**吸收一切迟到信号**（见 [`crate::live_sessions::state::reduce`]）。
    #[must_use]
    pub const fn is_terminal(self) -> bool {
        matches!(self, Self::Failed | Self::Stopped)
    }
}

/// 一条 live session 条目（注册表的 value）。
#[derive(Debug, Clone)]
pub struct SessionEntry {
    /// 后端铸造的会话 id（chat：`agent_stream` 返回的 id；terminal：PTY 会话 id）。
    pub session_id: String,
    /// 会话种类。
    pub kind: SessionKind,
    /// 该会话使用的 agent（纯 shell terminal 为 `None`）。
    pub agent_id: Option<String>,
    /// **执行地址**（红线 12：地址是身份，不是字符串前缀）。
    pub workspace: WorkspaceSession,
    /// 已解析的执行根。既是 `ResumeCursor.cwd` 的投影来源，也是
    /// 「这个会话属于哪个单元」的判据（`UnitScope::owns`）——
    /// 地址本身没有路径分量，无法直接参与路径归属判定。
    pub cwd: String,
    /// 当前状态（只能经 `Registry::apply(signal)` 改变）。
    pub state: SessionState,
    /// 当前标题（由 `title::admit` + `title::should_upgrade` 裁决，只在
    /// `upgrade_title` 一处写入）。
    pub title: String,
    /// 标题来源（质量顺序见 [`TitleSource`]）。
    pub title_source: TitleSource,
    /// agent 侧的**原生**会话 id（CLI 自己的 session id），用于恢复。
    ///
    /// 来源只有一处：CLI hook 上报的 `HookEvent.agent_session_id`。它是
    /// `conversation::adapter::resume_command` 唯一的入参 —— neeko 自己的 `session_id`
    /// 对 CLI 毫无意义，拿它拼不出 `--resume`。
    ///
    /// **不进 wire 契约**：视图不需要它（UI 不显示、也不据此派生），只有
    /// `live_session_resume_command` 在点击时读一次。
    pub native_session_id: Option<String>,
    /// 会话开始时刻。
    pub started_at: DateTime<Utc>,
    /// 最后一次状态 / 标题变化时刻（UI 的相对时间用它，别伪造 Idle）。
    pub updated_at: DateTime<Utc>,
    /// 已完成的回合数。
    pub turn_count: u32,
    /// 用户是否已经在这个会话里**发出过输入**（= 侧栏该把它列出来的时刻）。
    ///
    /// 一旦置位就不再回落：发送那一刻标题已经拿到，用户就该在侧栏看到这条会话 ——
    /// 不必等 agent 跑完。置位点：终端的用户提交、chat 的 `agent_stream`（真回合）、
    /// CLI 的 hook 上报。**打开 tab 不置位**（PTY / 静默会话的创建不算用户在用它）。
    pub has_user_input: bool,
    /// 状态是否来自权威事件（CLI hook 的完成 / 审批 / 失败），且仍在等待下一次用户输入。
    ///
    /// PTY 输出只能推断“可能还在跑”；Codex TUI 在完成后的重绘、光标刷新或重新进入 CLI
    /// 也会产生字节，若让它们覆盖 hook 的完成态，就会把 `Ready` 永久推回 `Running`。
    /// 因此权威事件置位本门，只有用户真正提交输入时才清除。
    pub awaiting_user_activity: bool,
}

impl SessionEntry {
    /// 新建条目：状态从 [`SessionState::Ready`] 开始，时间戳取当前时刻。
    ///
    /// 标题恒为**空串的 `Placeholder`** —— 标题只能经注册表的 `upgrade_title` 写入。
    /// 留一个 title 参数就等于开一条绕过准入判据（`title::admit`）的旁路：登记路径
    /// 会拿到未经准入的成品，而单调升级会让它粘住（弱级永不覆盖强级）。
    /// 调用方要命名，就在登记后依次上报候选（见 `wiring::chat`）。
    #[must_use]
    pub fn new(
        session_id: impl Into<String>,
        kind: SessionKind,
        agent_id: Option<String>,
        workspace: WorkspaceSession,
        cwd: impl Into<String>,
    ) -> Self {
        let now = Utc::now();
        Self {
            session_id: session_id.into(),
            kind,
            agent_id,
            workspace,
            cwd: cwd.into(),
            state: SessionState::Ready,
            title: String::new(),
            title_source: TitleSource::Placeholder,
            native_session_id: None,
            started_at: now,
            updated_at: now,
            turn_count: 0,
            has_user_input: false,
            awaiting_user_activity: false,
        }
    }

    /// 覆盖初始状态（terminal：进程一旦创建成功就是 `Running`，不推断 Idle）。
    #[must_use]
    pub const fn with_state(mut self, state: SessionState) -> Self {
        self.state = state;
        self
    }

    /// 登记时的初始可见性（chat 的三种启动形态各不相同，见
    /// `wiring::chat::ChatRegistrationKind`）。
    #[must_use]
    pub const fn with_user_input(mut self, has_user_input: bool) -> Self {
        self.has_user_input = has_user_input;
        self
    }

    /// 是否有可展示的真标题 —— **唯一判据**（注册表内部与 hook 投影共用）。
    ///
    /// 退化为「非空」是因为 [`title::admit`](crate::live_sessions::title::admit) 对
    /// `Placeholder` 恒返回 `None`：于是 `title_source == Placeholder ⟺ title.is_empty()`
    /// 恒成立（持久化不变量）。
    ///
    /// **只适用于 `SessionEntry`**：wire 上的 `SessionView.title` 永远非空（视图层用
    /// [`SessionView::placeholder_label`] 补齐），所以前端 `isNamedSession` 看的是
    /// `titleSource`，不是空串 —— 两处判据不同，别互相"化简"。
    #[must_use]
    pub const fn has_real_title(&self) -> bool {
        !self.title.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ws(project_id: &str, worktree: Option<&str>) -> WorkspaceSession {
        WorkspaceSession::of(project_id, worktree.map(str::to_string))
    }

    /// 标题来源的 `Ord` **就是**质量顺序 —— `should_upgrade` 依赖它，
    /// 顺序错了会让 Placeholder 覆盖 Native（且没有任何编译错误）。
    #[test]
    fn title_source_order_encodes_quality() {
        let order = [
            TitleSource::Placeholder,
            TitleSource::Prompt,
            TitleSource::Native,
            TitleSource::User,
        ];
        for pair in order.windows(2) {
            assert!(pair[0] < pair[1], "{:?} 必须弱于 {:?}", pair[0], pair[1]);
        }
    }

    #[test]
    fn terminal_state_helpers() {
        assert!(!SessionState::Ready.is_terminal());
        assert!(!SessionState::Running.is_terminal());
        assert!(!SessionState::AwaitingApproval.is_terminal());
        assert!(SessionState::Failed.is_terminal());
        assert!(SessionState::Stopped.is_terminal());
    }

    /// 新条目**没有标题**：标题只能经注册表的 `upgrade_title` 写入。
    ///
    /// 留一个 title 参数就等于开一条绕过准入判据（`title::admit`）的旁路 ——
    /// 而单调升级会让绕过判据的噪声粘住。
    #[test]
    fn new_entry_starts_ready_with_zero_turns_and_no_title() {
        let entry = SessionEntry::new(
            "s1",
            SessionKind::Chat,
            Some("pi".into()),
            ws("p1", None),
            "/proj",
        );
        assert_eq!(entry.state, SessionState::Ready);
        assert_eq!(entry.turn_count, 0);
        assert_eq!(entry.title, "");
        assert_eq!(entry.title_source, TitleSource::Placeholder);
        assert_eq!(entry.started_at, entry.updated_at);
    }

    #[test]
    fn with_state_overrides_the_initial_state() {
        let entry = SessionEntry::new(
            "s1",
            SessionKind::Terminal,
            None,
            ws("p1", Some("/proj-wt")),
            "/proj-wt",
        )
        .with_state(SessionState::Running);
        assert_eq!(entry.state, SessionState::Running);
        assert_eq!(entry.kind, SessionKind::Terminal);
        assert_eq!(entry.agent_id, None);
    }
}
