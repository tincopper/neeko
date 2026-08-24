//! Agent Chat — session persistence & recovery.
//!
//! Persists [`ResumeCursor`]s and streamed events to a local SQLite database so
//! that sessions survive app restarts (P2 — session continuity). The store is
//! a thin layer over `rusqlite`, following the pattern in `library/store.rs`.

use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

use crate::agent::chat::adapter::AgentKind;
use crate::common::db;
use crate::AppError;

/// Session lifecycle status (persisted form of the live session state).
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub enum SessionStatus {
    /// Session ready for new turns.
    Ready,
    /// Session actively processing a turn.
    Running,
    /// Session awaiting user approval.
    AwaitingApproval,
    /// Session closed (no longer active).
    Closed,
}

/// Recovery cursor — the minimal state needed to resume a session after restart.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ResumeCursor {
    /// Neeko session identifier.
    pub session_id: String,
    /// Agent kind backing the session.
    pub agent_kind: AgentKind,
    /// Agent identifier (e.g. `deepseek-harness`).
    pub agent_id: String,
    /// Working directory the session is bound to.
    pub cwd: String,
    /// Model selection for the session.
    pub model: String,
    /// Runtime mode (`auto` | `confirm`).
    pub runtime_mode: String,
    /// Number of completed turns.
    pub turn_count: u32,
    /// Current session status.
    pub status: SessionStatus,
    /// ISO8601 timestamp of last activity.
    pub last_activity: String,
}

/// Persistence gateway for agent chat sessions.
pub trait SessionStore: Send + Sync {
    /// Insert or update a session cursor (upsert by `session_id`).
    fn save_cursor(&self, cursor: &ResumeCursor) -> Result<(), AppError>;
    /// Load a single session cursor by id.
    fn load_cursor(&self, session_id: &str) -> Option<ResumeCursor>;
    /// List all non-closed sessions, most recent first.
    fn list_active(&self) -> Vec<ResumeCursor>;
    /// Mark a session as closed.
    fn close_session(&self, session_id: &str) -> Result<(), AppError>;
}

/// SQLite-backed session store.
pub struct SqliteSessionStore {
    conn: Mutex<Connection>,
}

impl SqliteSessionStore {
    /// Open (or create) the session database at `db_path`.
    pub fn open(db_path: &Path) -> Result<Self, AppError> {
        let conn = db::open(db_path).map_err(AppError::from)?;
        Self::run_migrations(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Open an in-memory session store (for testing).
    pub fn open_in_memory() -> Result<Self, AppError> {
        let conn = db::open_in_memory().map_err(AppError::from)?;
        Self::run_migrations(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn run_migrations(conn: &Connection) -> Result<(), AppError> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS session_cursors (
                session_id TEXT PRIMARY KEY,
                agent_kind TEXT NOT NULL,
                agent_id TEXT NOT NULL,
                cwd TEXT NOT NULL,
                model TEXT NOT NULL,
                runtime_mode TEXT NOT NULL,
                turn_count INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'ready',
                last_activity TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );",
        )
        .map_err(AppError::from)
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Connection>, AppError> {
        self.conn
            .lock()
            .map_err(|e| AppError::Unknown(format!("session store lock poisoned: {e}")))
    }
}

impl SessionStore for SqliteSessionStore {
    fn save_cursor(&self, cursor: &ResumeCursor) -> Result<(), AppError> {
        let conn = self.lock()?;
        let agent_kind_json = serde_json::to_string(&cursor.agent_kind).map_err(AppError::from)?;
        let status_json = serde_json::to_string(&cursor.status).map_err(AppError::from)?;
        conn.execute(
            "INSERT INTO session_cursors
                (session_id, agent_kind, agent_id, cwd, model,
                 runtime_mode, turn_count, status, last_activity)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(session_id) DO UPDATE SET
                turn_count = excluded.turn_count,
                status = excluded.status,
                last_activity = excluded.last_activity",
            rusqlite::params![
                cursor.session_id,
                agent_kind_json,
                cursor.agent_id,
                cursor.cwd,
                cursor.model,
                cursor.runtime_mode,
                cursor.turn_count,
                status_json,
                cursor.last_activity,
            ],
        )
        .map_err(AppError::from)?;
        Ok(())
    }

    fn load_cursor(&self, session_id: &str) -> Option<ResumeCursor> {
        let conn = self.lock().ok()?;
        let mut stmt = conn
            .prepare(
                "SELECT session_id, agent_kind, agent_id, cwd, model,
                        runtime_mode, turn_count, status, last_activity
                 FROM session_cursors WHERE session_id = ?1",
            )
            .ok()?;
        stmt.query_row(rusqlite::params![session_id], |row| {
            let agent_kind_str: String = row.get(1)?;
            let status_str: String = row.get(7)?;
            Ok(ResumeCursor {
                session_id: row.get(0)?,
                agent_kind: serde_json::from_str(&agent_kind_str).unwrap_or(AgentKind::Custom),
                agent_id: row.get(2)?,
                cwd: row.get(3)?,
                model: row.get(4)?,
                runtime_mode: row.get(5)?,
                turn_count: row.get(6)?,
                status: serde_json::from_str(&status_str).unwrap_or(SessionStatus::Ready),
                last_activity: row.get(8)?,
            })
        })
        .ok()
    }

    fn list_active(&self) -> Vec<ResumeCursor> {
        let conn = match self.lock() {
            Ok(c) => c,
            Err(_) => return Vec::new(),
        };
        let mut stmt = match conn.prepare(
            "SELECT session_id, agent_kind, agent_id, cwd, model,
                    runtime_mode, turn_count, status, last_activity
             FROM session_cursors WHERE status != '\"Closed\"'
             ORDER BY last_activity DESC",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        let rows = stmt
            .query_map([], |row| {
                let agent_kind_str: String = row.get(1)?;
                let status_str: String = row.get(7)?;
                Ok(ResumeCursor {
                    session_id: row.get(0)?,
                    agent_kind: serde_json::from_str(&agent_kind_str).unwrap_or(AgentKind::Custom),
                    agent_id: row.get(2)?,
                    cwd: row.get(3)?,
                    model: row.get(4)?,
                    runtime_mode: row.get(5)?,
                    turn_count: row.get(6)?,
                    status: serde_json::from_str(&status_str).unwrap_or(SessionStatus::Ready),
                    last_activity: row.get(8)?,
                })
            })
            .ok();
        rows.into_iter().flatten().filter_map(|r| r.ok()).collect()
    }

    fn close_session(&self, session_id: &str) -> Result<(), AppError> {
        let conn = self.lock()?;
        // 与 save_cursor 一致：status 存 serde JSON 序列化形式（"Closed"），
        // 否则 load 时 from_str 反序列化失败会回退成 Ready（历史 bug）。
        let closed = serde_json::to_string(&SessionStatus::Closed)
            .map_err(|e| AppError::Storage(format!("serialize closed status: {e}")))?;
        conn.execute(
            "UPDATE session_cursors SET status = ?1 WHERE session_id = ?2",
            rusqlite::params![closed, session_id],
        )
        .map_err(AppError::from)?;
        Ok(())
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_cursor(id: &str) -> ResumeCursor {
        ResumeCursor {
            session_id: id.into(),
            agent_kind: AgentKind::DeepSeekHarness,
            agent_id: "deepseek-harness".into(),
            cwd: "/tmp/project".into(),
            model: "default".into(),
            runtime_mode: "auto".into(),
            turn_count: 0,
            status: SessionStatus::Ready,
            last_activity: "2025-01-01T00:00:00Z".into(),
        }
    }

    #[test]
    fn save_then_load_round_trip() {
        let store = SqliteSessionStore::open_in_memory().unwrap();
        let cursor = make_cursor("s1");
        store.save_cursor(&cursor).unwrap();

        let loaded = store.load_cursor("s1").unwrap();
        assert_eq!(loaded.session_id, "s1");
        assert_eq!(loaded.agent_kind, AgentKind::DeepSeekHarness);
        assert_eq!(loaded.status, SessionStatus::Ready);
    }

    #[test]
    fn save_is_upsert() {
        let store = SqliteSessionStore::open_in_memory().unwrap();
        let mut cursor = make_cursor("s1");
        store.save_cursor(&cursor).unwrap();

        cursor.turn_count = 3;
        cursor.status = SessionStatus::Running;
        store.save_cursor(&cursor).unwrap();

        let loaded = store.load_cursor("s1").unwrap();
        assert_eq!(loaded.turn_count, 3);
        assert_eq!(loaded.status, SessionStatus::Running);
        assert_eq!(store.list_active().len(), 1);
    }

    #[test]
    fn list_active_excludes_closed() {
        let store = SqliteSessionStore::open_in_memory().unwrap();
        store.save_cursor(&make_cursor("s1")).unwrap();
        store.save_cursor(&make_cursor("s2")).unwrap();
        store.close_session("s1").unwrap();

        let active = store.list_active();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].session_id, "s2");
    }

    #[test]
    fn load_missing_returns_none() {
        let store = SqliteSessionStore::open_in_memory().unwrap();
        assert!(store.load_cursor("nope").is_none());
    }
}
