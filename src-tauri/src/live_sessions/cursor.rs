//! `SessionEntry` → `ResumeCursor` 的**唯一**投影点（写穿持久化用）。
//!
//! 投影是单向的：运行时状态（5 个）→ 持久化词表（4 个），`Failed` / `Stopped` 都落
//! `Closed`（重启后要恢复的是「还活着的会话」，不是因为什么而结束的）。反向不存在 ——
//! 启动时从不把 cursor 还原成 live 条目。
//!
//! 位置说明：`impl ResumeCursor` 写在 `live_sessions` 里而不是 `agent/chat/session_store.rs`，
//! 是为了让「运行时词表 → 持久化词表」的映射与被映射的运行时词汇住在一起
//! （`session_store` 不需要认识 `SessionState`），依赖方向保持 `live_sessions → agent::chat`。

use crate::agent::chat::adapter::AgentKind;
use crate::agent::chat::session_store::{ResumeCursor, SessionStatus};
use crate::live_sessions::entry::{SessionEntry, SessionKind, SessionState};

impl From<SessionState> for SessionStatus {
    fn from(state: SessionState) -> Self {
        match state {
            SessionState::Ready => Self::Ready,
            SessionState::Running => Self::Running,
            SessionState::AwaitingApproval => Self::AwaitingApproval,
            // 运行时区分「失败」与「正常结束」，持久化不需要 —— 两者都已不在运行。
            SessionState::Failed | SessionState::Stopped => Self::Closed,
        }
    }
}

impl ResumeCursor {
    /// 从 live 条目投影出恢复游标；**不可持久化的条目返回 `None`**。
    ///
    /// `agent_sessions.db` 存的是 agent chat 会话（原生 resume 需要 `agent_kind` /
    /// `model` / `runtime_mode`）。终端会话的存续由 PTY 生命周期表述，写进 chat 表只会
    /// 造出「重启后能恢复一个终端」的假承诺；无 agent 的纯 shell 同理（拿不到 `agent_id`）。
    #[must_use]
    pub fn from_entry(entry: &SessionEntry) -> Option<Self> {
        let (SessionKind::Chat, Some(agent_id)) = (entry.kind, entry.agent_id.as_ref()) else {
            return None;
        };
        Some(Self {
            session_id: entry.session_id.clone(),
            agent_kind: AgentKind::from_agent_id(agent_id),
            agent_id: agent_id.clone(),
            cwd: entry.cwd.clone(),
            model: String::new(),
            runtime_mode: "auto".into(),
            turn_count: entry.turn_count,
            status: SessionStatus::from(entry.state),
            last_activity: entry.updated_at.to_rfc3339(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::git::WorkspaceSession;
    use crate::live_sessions::entry::TitleSource;

    fn entry(kind: SessionKind, agent_id: Option<&str>, state: SessionState) -> SessionEntry {
        SessionEntry::new(
            "s1",
            kind,
            agent_id.map(str::to_string),
            WorkspaceSession::of("p1", Some("/proj-wt".into())),
            "/proj-wt",
            (TitleSource::Prompt, "hello".into()),
        )
        .with_state(state)
    }

    /// chat 会话可持久化：cwd / 状态 / 回合数逐项投影。
    #[test]
    fn chat_entry_projects_into_a_resume_cursor() {
        let cursor =
            ResumeCursor::from_entry(&entry(SessionKind::Chat, Some("pi"), SessionState::Running))
                .expect("chat entry must be persistable");
        assert_eq!(cursor.session_id, "s1");
        assert_eq!(cursor.agent_id, "pi");
        assert_eq!(cursor.cwd, "/proj-wt");
        assert_eq!(cursor.status, SessionStatus::Running);
        assert_eq!(cursor.turn_count, 0);
    }

    /// 终端会话不落 chat 表（拿不到原生 resume，也不该伪装成可恢复的 chat）。
    #[test]
    fn terminal_entry_is_not_persistable_even_with_an_agent() {
        for agent in [None, Some("pi")] {
            assert!(
                ResumeCursor::from_entry(&entry(
                    SessionKind::Terminal,
                    agent,
                    SessionState::Running
                ))
                .is_none(),
                "terminal 会话不得写穿 agent_sessions.db"
            );
        }
    }

    /// 状态投影穷举：运行时 5 态 → 持久化 4 态。
    #[test]
    fn every_runtime_state_projects_to_a_persisted_status() {
        let cases = [
            (SessionState::Ready, SessionStatus::Ready),
            (SessionState::Running, SessionStatus::Running),
            (
                SessionState::AwaitingApproval,
                SessionStatus::AwaitingApproval,
            ),
            (SessionState::Failed, SessionStatus::Closed),
            (SessionState::Stopped, SessionStatus::Closed),
        ];
        for (runtime, persisted) in cases {
            assert_eq!(SessionStatus::from(runtime), persisted, "{runtime:?}");
        }
    }
}
