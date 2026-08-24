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
    /// Project the session is bound to.
    pub project_id: String,
    /// Page → agent request channel.
    pub request_tx: mpsc::Sender<SessionRequest>,
}

/// Registry of live agent chat sessions, keyed by session id.
pub struct AgentChatManager {
    sessions: Mutex<HashMap<String, SessionHandle>>,
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
                store: Arc::new(
                    crate::agent::chat::session_store::SqliteSessionStore::open_in_memory()
                        .unwrap_or_else(|e| panic!("in-memory store fallback: {e}")),
                ),
            }
        }
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
    pub fn owns(&self, session_id: &str, agent_id: &str, project_id: &str) -> bool {
        self.get(session_id)
            .map(|h| h.agent_id == agent_id && h.project_id == project_id)
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
            project_id: project_id.into(),
            request_tx: tx,
        }
    }

    #[test]
    fn owns_true_when_agent_and_project_match() {
        let m = manager();
        m.register("s1".into(), handle("opencode", "p1"), None);
        assert!(m.owns("s1", "opencode", "p1"));
    }

    #[test]
    fn owns_false_when_agent_mismatch() {
        let m = manager();
        m.register("s1".into(), handle("opencode", "p1"), None);
        // 切到 mockAgent 后不得复用 opencode 的会话 —— 用户报的「切换不生效，
        // 还是旧模型」根因就是旧会话被继续。
        assert!(!m.owns("s1", "mockAgent", "p1"));
    }

    #[test]
    fn owns_false_when_project_mismatch() {
        let m = manager();
        m.register("s1".into(), handle("opencode", "p1"), None);
        assert!(!m.owns("s1", "opencode", "p2"));
    }

    #[test]
    fn owns_false_when_session_missing_or_unregistered() {
        let m = manager();
        m.register("s1".into(), handle("opencode", "p1"), None);
        m.unregister("s1");
        assert!(!m.owns("s1", "opencode", "p1"));
        assert!(!m.owns("missing", "opencode", "p1"));
    }
}
