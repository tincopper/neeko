//! Live session 的运行时词表与条目形状（无 IO，可直测）。
//!
//! 词表**刻意不复用** `agent::chat::session_store::SessionStatus`：那是持久化词表
//! （只有 `Closed`，没有被 `Failed` / `Stopped` 区分的必要），且被 `agent_sessions.db`
//! 的 `status` 列语义绑住。运行时词表与持久化词表之间只有一条单向投影
//! （`cursor::from_entry`）—— 否则「加一个 UI 状态」就要改数据库语义。

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

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

/// 标题来源。**`Ord` 即质量顺序**（靠前者弱、靠后者强）：
/// `Placeholder < Prompt < Native < User`。
///
/// 它决定「谁可以覆盖谁」（由 [`crate::live_sessions::title::should_upgrade`] 消费），
/// **不进 UI** —— 界面只表达结果（有真标题 / 占位斜体）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TitleSource {
    /// 创建期占位（agent 名 / `Terminal`）。
    Placeholder,
    /// 首轮 prompt 截断。
    Prompt,
    /// agent 原生标题（恢复会话的 topic、OSC 0/2、conversation 扫描）。
    Native,
    /// 用户改名（自动来源永不覆盖）。
    User,
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
    /// 当前标题（由 `title::pick` / `title::should_upgrade` 决定）。
    pub title: String,
    /// 标题来源（质量顺序见 [`TitleSource`]）。
    pub title_source: TitleSource,
    /// 会话开始时刻。
    pub started_at: DateTime<Utc>,
    /// 最后一次状态 / 标题变化时刻（UI 的相对时间用它，别伪造 Idle）。
    pub updated_at: DateTime<Utc>,
    /// 已完成的回合数。
    pub turn_count: u32,
}

impl SessionEntry {
    /// 新建条目：状态从 [`SessionState::Ready`] 开始，时间戳取当前时刻。
    ///
    /// `title` 收 `(来源, 文本)` 元组：两者由 [`crate::live_sessions::title::pick`]
    /// 同时产出，分开传参只会让「文本与来源不匹配」成为可能。
    #[must_use]
    pub fn new(
        session_id: impl Into<String>,
        kind: SessionKind,
        agent_id: Option<String>,
        workspace: WorkspaceSession,
        cwd: impl Into<String>,
        title: (TitleSource, String),
    ) -> Self {
        let now = Utc::now();
        let (title_source, title) = title;
        Self {
            session_id: session_id.into(),
            kind,
            agent_id,
            workspace,
            cwd: cwd.into(),
            state: SessionState::Ready,
            title,
            title_source,
            started_at: now,
            updated_at: now,
            turn_count: 0,
        }
    }

    /// 覆盖初始状态（terminal：进程一旦创建成功就是 `Running`，不推断 Idle）。
    #[must_use]
    pub const fn with_state(mut self, state: SessionState) -> Self {
        self.state = state;
        self
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

    #[test]
    fn new_entry_starts_ready_with_zero_turns() {
        let entry = SessionEntry::new(
            "s1",
            SessionKind::Chat,
            Some("pi".into()),
            ws("p1", None),
            "/proj",
            (TitleSource::Prompt, "hello".into()),
        );
        assert_eq!(entry.state, SessionState::Ready);
        assert_eq!(entry.turn_count, 0);
        assert_eq!(entry.title, "hello");
        assert_eq!(entry.title_source, TitleSource::Prompt);
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
            (TitleSource::Placeholder, "Terminal".into()),
        )
        .with_state(SessionState::Running);
        assert_eq!(entry.state, SessionState::Running);
        assert_eq!(entry.kind, SessionKind::Terminal);
        assert_eq!(entry.agent_id, None);
    }
}
