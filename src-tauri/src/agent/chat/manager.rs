//! Agent Chat — session registry (live session routing).
//!
//! Maps `session_id` → request channel so the page→agent commands
//! (`agent_approve` / `agent_input` / `agent_stream_cancel`) can route to the
//! owning session without racing the event pump task. The pump owns the
//! session; the registry only carries a cloneable request sender.
//!
//! Also persists [`ResumeCursor`]s via the [`SessionStore`] so sessions survive
//! app restarts (P2 — session continuity).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tokio::sync::mpsc;

use crate::agent::chat::events::SessionRequest;
use crate::agent::chat::session_store::{ResumeCursor, SessionStatus, SessionStore};
use crate::common::error::AppError;

/// Handle to a live session's request path.
#[derive(Clone, Debug)]
pub struct SessionHandle {
    /// Agent identifier backing the session.
    pub agent_id: String,
    /// 会话的**执行地址**（worktree 维度）。同一项目的两个单元是两条会话：
    /// 它们的 cwd 不同，复用会把 turn 投进 cwd 错配的进程。
    ///
    /// 项目身份是它的一部分（`workspace.project_id`）—— 不再另存一份 `project_id`，
    /// 否则两处可分歧，而 `owns()` 只看得见其中一处。
    pub workspace: crate::common::git::WorkspaceSession,
    /// Page → agent request channel.
    pub request_tx: mpsc::Sender<SessionRequest>,
}

/// Registry of live agent chat sessions, keyed by session id.
pub struct AgentChatManager {
    sessions: Mutex<HashMap<String, SessionHandle>>,
    /// 当前对用户可见的 chat 会话（前端切换会话时上报；通知焦点抑制 R2.1 的事实来源）。
    /// `None` = 无可见 chat 会话 —— 保守语义「不可见」，聚焦与否由通知核心域裁决。
    visible_session: Mutex<Option<String>>,
    /// Session persistence backend (cursors + events).
    store: Arc<dyn SessionStore>,
}

impl Default for AgentChatManager {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentChatManager {
    /// Create an empty registry with the given session store.
    #[must_use]
    pub fn with_store(store: Arc<dyn SessionStore>) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            visible_session: Mutex::new(None),
            store,
        }
    }

    /// Create an empty registry without persistence (for tests / backwards compat).
    #[must_use]
    pub fn new() -> Self {
        // In tests without a real store, use an in-memory fallback.
        #[cfg(test)]
        {
            Self {
                sessions: Mutex::new(HashMap::new()),
                visible_session: Mutex::new(None),
                store: Arc::new(
                    crate::agent::chat::session_store::SqliteSessionStore::open_in_memory()
                        .expect("in-memory store"),
                ),
            }
        }
        #[cfg(not(test))]
        {
            Self {
                sessions: Mutex::new(HashMap::new()),
                visible_session: Mutex::new(None),
                store: Arc::new(
                    crate::agent::chat::session_store::SqliteSessionStore::open_in_memory()
                        .unwrap_or_else(|e| panic!("in-memory store fallback: {e}")),
                ),
            }
        }
    }

    /// 上报当前对用户可见的 chat 会话（`None` = 当前看的不 chat 会话）。
    /// 薄命令 `agent_chat_set_visible` 的唯一落点。
    pub fn set_visible_session(&self, session_id: Option<String>) {
        *self
            .visible_session
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = session_id;
    }

    /// 当前可见的 chat 会话 id（通知焦点抑制读取；克隆返回，不持锁跨调用）。
    #[must_use]
    pub fn visible_session(&self) -> Option<String> {
        self.visible_session
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    /// Register a session under `session_id` and persist its cursor.
    pub fn register(
        &self,
        session_id: String,
        handle: SessionHandle,
        cursor: Option<ResumeCursor>,
    ) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.insert(session_id, handle);
        }
        // Best-effort persistence: log but don't crash the session if the store fails.
        if let Some(cursor) = cursor {
            if let Err(e) = self.store.save_cursor(&cursor) {
                log::warn!("Failed to persist session cursor: {e}");
            }
        }
    }

    /// Register a session without persisting a cursor (backwards compat).
    pub fn register_light(&self, session_id: String, handle: SessionHandle) {
        self.register(session_id, handle, None);
    }

    /// Unregister a finished / cancelled session and mark it closed.
    pub fn unregister(&self, session_id: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(session_id);
        }
        if let Err(e) = self.store.close_session(session_id) {
            log::warn!("Failed to close session in store: {e}");
        }
    }

    /// Look up a session handle by id.
    pub fn get(&self, session_id: &str) -> Option<SessionHandle> {
        self.sessions
            .lock()
            .ok()
            .and_then(|m| m.get(session_id).cloned())
    }

    /// Whether `session_id` is a live session owned by `agent_id` and bound to
    /// `project_id`.
    ///
    /// `agent_stream` uses this as the gate for reusing an existing session:
    /// a session is only reusable when both the agent and the project match —
    /// otherwise continuing it would route the new agent's prompt (and its
    /// model) into the old agent's session.
    #[must_use]
    pub fn owns(
        &self,
        session_id: &str,
        agent_id: &str,
        workspace: &crate::common::git::WorkspaceSession,
    ) -> bool {
        self.get(session_id)
            .map(|h| h.agent_id == agent_id && &h.workspace == workspace)
            .unwrap_or(false)
    }

    /// Route a page → agent request to the session's request channel.
    pub async fn send(&self, session_id: &str, req: SessionRequest) -> Result<(), AppError> {
        let handle = self.get(session_id).ok_or_else(|| {
            AppError::NotFound(format!("agent chat session not found: {session_id}"))
        })?;
        handle
            .request_tx
            .send(req)
            .await
            .map_err(|e| AppError::Unknown(format!("agent chat request channel closed: {e}")))
    }

    /// List all active (non-closed) sessions from the store.
    pub fn list_active(&self) -> Vec<ResumeCursor> {
        self.store.list_active()
    }

    /// Update a session's status in the store.
    pub fn update_status(&self, session_id: &str, status: SessionStatus) -> Result<(), AppError> {
        let mut cursor = self
            .store
            .load_cursor(session_id)
            .ok_or_else(|| AppError::NotFound(format!("session cursor not found: {session_id}")))?;
        cursor.status = status;
        cursor.last_activity = chrono::Utc::now().to_rfc3339();
        self.store.save_cursor(&cursor)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manager() -> AgentChatManager {
        AgentChatManager::new()
    }

    fn handle(agent_id: &str, project_id: &str) -> SessionHandle {
        let (tx, _rx) = mpsc::channel(8);
        SessionHandle {
            agent_id: agent_id.into(),
            workspace: ws(project_id, None),
            request_tx: tx,
        }
    }

    fn ws(project_id: &str, worktree_path: Option<&str>) -> crate::common::git::WorkspaceSession {
        crate::common::git::WorkspaceSession::of(project_id, worktree_path.map(str::to_string))
    }

    #[test]
    fn owns_true_when_agent_and_project_match() {
        let m = manager();
        m.register("s1".into(), handle("opencode", "p1"), None);
        assert!(m.owns("s1", "opencode", &ws("p1", None)));
    }

    #[test]
    fn owns_false_when_agent_mismatch() {
        let m = manager();
        m.register("s1".into(), handle("opencode", "p1"), None);
        // 切到 mockAgent 后不得复用 opencode 的会话 —— 用户报的「切换不生效，
        // 还是旧模型」根因就是旧会话被继续。
        assert!(!m.owns("s1", "mockAgent", &ws("p1", None)));
    }

    #[test]
    fn owns_false_when_project_mismatch() {
        let m = manager();
        m.register("s1".into(), handle("opencode", "p1"), None);
        assert!(!m.owns("s1", "opencode", &ws("p2", None)));
    }

    /// 同一项目的**两个工作区单元是两条会话**：cwd 不同，复用会把 turn 投进错配进程。
    #[test]
    fn owns_false_when_worktree_unit_differs() {
        let m = manager();
        m.register("s1".into(), handle("opencode", "p1"), None);
        assert!(m.owns("s1", "opencode", &ws("p1", None)));
        assert!(
            !m.owns("s1", "opencode", &ws("p1", Some("/tmp/p1-wt"))),
            "主仓会话不得被 worktree 单元复用"
        );

        m.register(
            "s2".into(),
            SessionHandle {
                agent_id: "opencode".into(),
                workspace: ws("p1", Some("/tmp/p1-wt")),
                request_tx: mpsc::channel(8).0,
            },
            None,
        );
        assert!(m.owns("s2", "opencode", &ws("p1", Some("/tmp/p1-wt"))));
        assert!(!m.owns("s2", "opencode", &ws("p1", None)));
    }

    #[test]
    fn owns_false_when_session_missing_or_unregistered() {
        let m = manager();
        m.register("s1".into(), handle("opencode", "p1"), None);
        m.unregister("s1");
        assert!(!m.owns("s1", "opencode", &ws("p1", None)));
        assert!(!m.owns("missing", "opencode", &ws("p1", None)));
    }

    /// 可见会话槽（通知焦点抑制 R2.1 事实源）：set/get 往返、None 清空。
    #[test]
    fn visible_session_roundtrip_and_clear() {
        let m = manager();
        assert_eq!(m.visible_session(), None);
        m.set_visible_session(Some("s1".into()));
        assert_eq!(m.visible_session().as_deref(), Some("s1"));
        m.set_visible_session(None);
        assert_eq!(m.visible_session(), None);
    }
}
