//! Agent Chat — session persistence & recovery.
//!
//! Persists [`ResumeCursor`]s to a local SQLite database so that sessions survive
//! app restarts (P2 — session continuity). The store is a thin layer over
//! `rusqlite`, following the pattern in `library/store.rs`.
//!
//! # 一行 = 一条侧栏条目，不是「一个可恢复的进程」
//!
//! 表里存的是**侧栏列表条目**（身份 + 标题 + 可见性 + 时间 + 原生恢复参数）；运行时状态
//! 只有 `status` 一列，且启动恢复时一律投影成 `Stopped` —— 进程已经没了，任何非终止态
//! 都是假数据。行由 `live_sessions::cursor` 单向投影写入，反向投影也只发生在那里。
//!
//! # 私有迁移链（无 `user_version`）
//!
//! 本库与 `neeko.db` 的单一迁移链**无关**（见 `persistence-and-cache.md` §1）。扩列靠
//! `PRAGMA table_info` + `ALTER TABLE ADD COLUMN`，因此必须幂等：同一份库会被新版反复打开。

use rusqlite::Connection;
use std::collections::HashSet;
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

/// 会话种类（持久化词表）。
///
/// 与运行时 [`crate::live_sessions::entry::SessionKind`] 同名不同物：后者是视图/状态机的
/// 词汇，本枚举只回答「重启后这一行该恢复成哪种会话」。两者之间只有一条投影
/// （`live_sessions::cursor`），因此给视图加一种会话不会改到数据库语义。
#[derive(Clone, Copy, Debug, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PersistedSessionKind {
    /// Agent Chat 会话。
    Chat,
    /// 终端会话（本地 PTY / WSL / SSH）。
    Terminal,
}

/// 标题来源（持久化词表）。
///
/// 顺序与运行时 `TitleSource` 同构（`Placeholder < Prompt < Native < User`），但**不派生
/// `Ord`**：覆盖序是注册表的判据，库里只记「这个名字是谁起的」。
#[derive(Clone, Copy, Debug, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PersistedTitleSource {
    /// 占位（`Placeholder ⟺ 空标题`）。
    Placeholder,
    /// 首轮 prompt。
    Prompt,
    /// agent 原生标题。
    Native,
    /// 用户改名。
    User,
}

/// Recovery cursor — the minimal state needed to resume a session after restart.
///
/// 也是**侧栏列表**的持久化形状：侧栏重启后要恢复的是「哪些行存在」，不是「哪些进程还活着」。
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ResumeCursor {
    /// Neeko session identifier.
    pub session_id: String,
    /// Agent kind backing the session.
    pub agent_kind: AgentKind,
    /// Agent identifier (e.g. `deepseek-harness`). 纯 shell 终端的 agent 为空串。
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
    /// 会话种类（侧栏行重建时决定归属与图标）。
    pub kind: PersistedSessionKind,
    /// 所属项目 id —— 侧栏行恢复后靠它与 `worktree_path` 定位单元。
    pub project_id: String,
    /// linked worktree 的身份串；`None` = 主 checkout。
    pub worktree_path: Option<String>,
    /// 标题（空串 = 还没名字 ⇒ 不恢复、不列出）。
    pub title: String,
    /// 标题来源（`User` 改名必须活过重启，且不被自动来源覆盖）。
    pub title_source: PersistedTitleSource,
    /// 用户是否已经发过输入（= 侧栏该列出这一行）。
    pub has_user_input: bool,
    /// agent 侧原生会话 id（点击恢复时 `--resume` 的唯一入参）。
    pub native_session_id: Option<String>,
    /// 会话开始时刻（RFC3339）。复用 `created_at` 列，upsert 不改写它。
    pub started_at: String,
}

/// Persistence gateway for agent chat sessions.
///
/// # 两个消费者，两半接口
///
/// 同一个实现被两个域使用，写穿的**责任边界**因此必须显式：
///
/// | 半边 | 方法 | 消费者 |
/// | --- | --- | --- |
/// | agent 恢复游标 | `save_cursor` / `load_cursor` / `close_session` | `agent::chat` |
/// | 侧栏列表行 | `list_restorable` / `delete_cursor` | `live_sessions` |
///
/// `save_cursor` 是两域共用的**唯一**写入口（`live_sessions::cursor` 投影 → 这里）。
/// 拆两张表会更纯粹，但两个消费者本就各读自己的行，拆分收益只抵得过一次双写成本；
/// 当前规模（5 个方法）保持单 trait，靠本表与列所有权契约
/// （[`ResumeCursor::with_creation_fields_of`]）划界。
pub trait SessionStore: Send + Sync {
    /// Insert or update a session cursor (upsert by `session_id`).
    fn save_cursor(&self, cursor: &ResumeCursor) -> Result<(), AppError>;
    /// Load a single session cursor by id.
    fn load_cursor(&self, session_id: &str) -> Option<ResumeCursor>;
    /// 列出**可恢复为侧栏行**的会话。
    ///
    /// 判据只有一份：[`ResumeCursor::is_restorable`]。实现允许先做 SQL **粗筛**（性能），
    /// 但粗筛必须是该判据的**超集** —— 漏一行是「重启后会话消失」，多放一行只浪费一次投影，
    /// 代价不对称。顺序不由本方法保证（快照排序属视图层）。
    fn list_restorable(&self) -> Vec<ResumeCursor>;
    /// Mark a session as closed.
    fn close_session(&self, session_id: &str) -> Result<(), AppError>;
    /// 彻底删掉一行（会话注销 / 用户删除）。幂等。
    fn delete_cursor(&self, session_id: &str) -> Result<(), AppError>;
}

impl ResumeCursor {
    /// **读判据**（唯一一份）：「这一行能投影回侧栏吗」。
    ///
    /// 两个拒绝理由：没有单元（不知挂哪里）、`Placeholder` 却带标题（数据损坏，不猜）。
    /// 消费点：`into_entry` 与 `SessionStore::list_restorable`（含测试替身）—— 改判据只改这里。
    ///
    /// **标题可以为空**（第 35 轮修正）：可见性与命名是两件事。终端首条输入不再产生标题，
    /// 无 hook 的 CLI 永远等不到名字；把 `title != ''` 当读门会让这些会话重启后整条消失。
    /// 无名行由视图画成占位行，不由后端编一个假名字。
    ///
    /// 与之相对的**写判据**是 `has_user_input`（见 `live_sessions::cursor::from_entry`）：
    /// 行存在 = 用户确实动过这条会话；行可读 = 它能定位到单元。两个问题不同，
    /// 但不再是散落的四份实现。
    #[must_use]
    pub fn is_restorable(&self) -> bool {
        !self.project_id.is_empty() && !self.is_corrupt_placeholder()
    }

    /// 损坏行判据：`Placeholder` 来源却带着标题。
    ///
    /// 后端不变量是 `Placeholder ⟺ title == ""`（`title::admit` 对 `Placeholder` 恒返回
    /// `None`，`SessionEntry::has_real_title` 因此退化为非空判断）。违反它的行没有可信来源，
    /// 投影回去只会得到一条「没有来源的名字」—— 不猜。
    ///
    /// 注意 **`Placeholder` + 空标题是合法的**（第 35 轮起这是常态：已输入但还没有名字）。
    fn is_corrupt_placeholder(&self) -> bool {
        self.title_source == PersistedTitleSource::Placeholder && !self.title.is_empty()
    }

    /// 用 `existing` 的**创建期定格字段**覆盖自己的投影默认值。
    ///
    /// 创建期字段（`model` / `runtime_mode` / `started_at`）由 `build_resume_cursor` 写入，
    /// 投影（`live_sessions::cursor::from_entry`）对它们一无所知（空串 / `auto`）—— 整体
    /// 覆盖会把用户选的 `confirm` 模式静默改写回 `auto`，且只在下次启动后可见。
    ///
    /// 字段清单**只写在这里**：写穿路径（`Registry::write_cursor`）调本方法，
    /// SQL 的 upsert 用同一份清单（`model` / `runtime_mode` / `created_at` 不在 UPDATE 列里），
    /// 纯函数与 SQL 两条路径由 `creation_fields_survive_both_write_paths` 钉住，
    /// 注册表侧的合并由 `persist_keeps_fields_the_registry_does_not_know` 钉住。
    #[must_use]
    pub fn with_creation_fields_of(mut self, existing: &Self) -> Self {
        self.model.clone_from(&existing.model);
        self.runtime_mode.clone_from(&existing.runtime_mode);
        self.started_at.clone_from(&existing.started_at);
        self
    }
}

/// `session_cursors` 的**唯一**列清单（两个读取方法共用；列顺序即
/// [`row_to_cursor`] 的下标）。新增列时只改 `SELECT` 列表就会静默错位：两处共用一份
/// 字符串就是为了让错位不可能出现。
const CURSOR_COLUMNS: &str = "session_id, agent_kind, agent_id, cwd, model, \
     runtime_mode, turn_count, status, last_activity, kind, project_id, worktree_path, \
     title, title_source, has_user_input, native_session_id, created_at";

/// 需要幂等补上的列（`(列名, 声明)`）。列名与声明都是**静态字符串** ——
/// 不来自任何运行时输入，因此拼进 `ALTER TABLE` 是安全的。
const ADDED_COLUMNS: [(&str, &str); 7] = [
    ("kind", "TEXT NOT NULL DEFAULT ''"),
    ("project_id", "TEXT NOT NULL DEFAULT ''"),
    ("worktree_path", "TEXT"),
    ("title", "TEXT NOT NULL DEFAULT ''"),
    ("title_source", "TEXT NOT NULL DEFAULT ''"),
    ("has_user_input", "INTEGER NOT NULL DEFAULT 0"),
    ("native_session_id", "TEXT"),
];

/// 一行 → `ResumeCursor`（`load_cursor` / `list_restorable` 共用）。
///
/// 缺失/无法识别的枚举值一律降到最保守的一档：旧行扩列后 `kind` / `title_source`
/// 都是空串，解析失败不应让整次启动的恢复列表变空（它们已因 `project_id` 空而被过滤）。
fn row_to_cursor(row: &rusqlite::Row<'_>) -> rusqlite::Result<ResumeCursor> {
    let agent_kind_raw: String = row.get(1)?;
    let status_raw: String = row.get(7)?;
    let kind_raw: String = row.get(9)?;
    let title_source_raw: String = row.get(13)?;
    Ok(ResumeCursor {
        session_id: row.get(0)?,
        agent_kind: serde_json::from_str(&agent_kind_raw).unwrap_or(AgentKind::Custom),
        agent_id: row.get(2)?,
        cwd: row.get(3)?,
        model: row.get(4)?,
        runtime_mode: row.get(5)?,
        turn_count: row.get(6)?,
        status: serde_json::from_str(&status_raw).unwrap_or(SessionStatus::Ready),
        last_activity: row.get(8)?,
        kind: serde_json::from_str(&kind_raw).unwrap_or(PersistedSessionKind::Chat),
        project_id: row.get(10)?,
        worktree_path: row.get(11)?,
        title: row.get(12)?,
        title_source: serde_json::from_str(&title_source_raw)
            .unwrap_or(PersistedTitleSource::Placeholder),
        has_user_input: row.get::<_, i64>(14)? != 0,
        native_session_id: row.get(15)?,
        started_at: row.get(16)?,
    })
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
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                kind TEXT NOT NULL DEFAULT '',
                project_id TEXT NOT NULL DEFAULT '',
                worktree_path TEXT,
                title TEXT NOT NULL DEFAULT '',
                title_source TEXT NOT NULL DEFAULT '',
                has_user_input INTEGER NOT NULL DEFAULT 0,
                native_session_id TEXT
            );",
        )
        .map_err(AppError::from)?;
        Self::add_missing_columns(conn)
    }

    /// 幂等补列：`CREATE TABLE IF NOT EXISTS` 对已存在的表是 no-op，所以存量库靠这里升级。
    ///
    /// 不加 `user_version` 门禁（本库的迁移链是私有的、按列存在性判据）—— 门禁一旦
    /// 与 `neeko.db` 的链混用就会把两个库的版本号绑在一起，那正是 §1 明确禁止的。
    fn add_missing_columns(conn: &Connection) -> Result<(), AppError> {
        let mut existing = Self::column_names(conn)?;
        for (column, declaration) in ADDED_COLUMNS {
            if existing.contains(column) {
                continue;
            }
            match conn.execute_batch(&format!(
                "ALTER TABLE session_cursors ADD COLUMN {column} {declaration}"
            )) {
                Ok(()) => {
                    existing.insert(column.to_string());
                }
                // 「判存在 + ALTER」两步不是原子的：另一个实例（`open -n`，本仓无单实例
                // 插件）可能刚补上同一列。此时报错会让整个 store 降级成内存态（功能静默
                // 失效），所以重新确认一次：列已存在就当「已补过」。
                Err(e) => {
                    if !Self::column_names(conn)?.contains(column) {
                        return Err(e.into());
                    }
                }
            }
        }
        Ok(())
    }

    /// `session_cursors` 当前列名（幂等扩列的判据）。
    fn column_names(conn: &Connection) -> Result<HashSet<String>, AppError> {
        let mut stmt = conn
            .prepare("PRAGMA table_info(session_cursors)")
            .map_err(AppError::from)?;
        let names = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(AppError::from)?;
        names
            .collect::<rusqlite::Result<HashSet<String>>>()
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
        let kind_json = serde_json::to_string(&cursor.kind).map_err(AppError::from)?;
        let title_source_json =
            serde_json::to_string(&cursor.title_source).map_err(AppError::from)?;
        conn.execute(
            // `model` / `runtime_mode` / `created_at` 刻意**不在** UPDATE 列表里：它们由
            // 创建期定格（用户选的 `confirm` 模式不能被一次状态写穿改写回 `auto`，
            // `started_at` 是「开始」时刻，不是「最后写入」时刻）。
            "INSERT INTO session_cursors
                (session_id, agent_kind, agent_id, cwd, model,
                 runtime_mode, turn_count, status, last_activity,
                 kind, project_id, worktree_path, title, title_source,
                 has_user_input, native_session_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
             ON CONFLICT(session_id) DO UPDATE SET
                turn_count = excluded.turn_count,
                status = excluded.status,
                last_activity = excluded.last_activity,
                kind = excluded.kind,
                project_id = excluded.project_id,
                worktree_path = excluded.worktree_path,
                title = excluded.title,
                title_source = excluded.title_source,
                has_user_input = excluded.has_user_input,
                native_session_id = excluded.native_session_id",
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
                kind_json,
                cursor.project_id,
                cursor.worktree_path,
                cursor.title,
                title_source_json,
                cursor.has_user_input,
                cursor.native_session_id,
                cursor.started_at,
            ],
        )
        .map_err(AppError::from)?;
        Ok(())
    }

    fn load_cursor(&self, session_id: &str) -> Option<ResumeCursor> {
        let conn = self.lock().ok()?;
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {CURSOR_COLUMNS} FROM session_cursors WHERE session_id = ?1"
            ))
            .ok()?;
        stmt.query_row(rusqlite::params![session_id], row_to_cursor)
            .ok()
    }

    fn list_restorable(&self) -> Vec<ResumeCursor> {
        let conn = match self.lock() {
            Ok(c) => c,
            Err(_) => return Vec::new(),
        };
        // SQL 只做**粗筛**（必须是 `is_restorable` 的超集）：「`Placeholder` 却带标题」
        // 这类损坏过得了这里，由下面那份判据挡。顺序交给视图层，SQL 不排。
        // 粗筛不要求 `title != ''`：无名但已输入的行也必须能回来（第 35 轮，可见性≠命名）。
        let mut stmt = match conn.prepare(&format!(
            "SELECT {CURSOR_COLUMNS} FROM session_cursors \
             WHERE project_id != ''"
        )) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        let rows = stmt.query_map([], row_to_cursor).ok();
        rows.into_iter()
            .flatten()
            .filter_map(|r| r.ok())
            .filter(ResumeCursor::is_restorable)
            .collect()
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

    fn delete_cursor(&self, session_id: &str) -> Result<(), AppError> {
        let conn = self.lock()?;
        conn.execute(
            "DELETE FROM session_cursors WHERE session_id = ?1",
            rusqlite::params![session_id],
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
            agent_kind: AgentKind::Custom,
            agent_id: "opencode".into(),
            cwd: "/tmp/project".into(),
            model: "default".into(),
            runtime_mode: "auto".into(),
            turn_count: 0,
            status: SessionStatus::Ready,
            last_activity: "2025-01-01T00:00:00Z".into(),
            kind: PersistedSessionKind::Terminal,
            project_id: "p1".into(),
            worktree_path: Some("/tmp/project-wt".into()),
            title: "修复登录竞态".into(),
            title_source: PersistedTitleSource::Prompt,
            has_user_input: true,
            native_session_id: Some("native-42".into()),
            started_at: "2024-12-31T23:00:00+00:00".into(),
        }
    }

    /// 侧栏列表持久化的新字段必须逐项往返（重启后侧栏行靠它们定位单元 + 显示标题）。
    #[test]
    fn sidebar_fields_round_trip() {
        let store = SqliteSessionStore::open_in_memory().unwrap();
        store.save_cursor(&make_cursor("s1")).unwrap();

        let loaded = store.load_cursor("s1").expect("cursor must load back");
        assert_eq!(loaded.kind, PersistedSessionKind::Terminal);
        assert_eq!(loaded.project_id, "p1");
        assert_eq!(loaded.worktree_path.as_deref(), Some("/tmp/project-wt"));
        assert_eq!(loaded.title, "修复登录竞态");
        assert_eq!(loaded.title_source, PersistedTitleSource::Prompt);
        assert!(loaded.has_user_input);
        assert_eq!(loaded.native_session_id.as_deref(), Some("native-42"));
        assert_eq!(loaded.started_at, "2024-12-31T23:00:00+00:00");
    }

    /// 既有不变量：`model` / `runtime_mode` 由创建期决定，写穿不得改写；
    /// `started_at` 是**开始**时刻，upsert 也不得改写。标题与状态必须更新。
    #[test]
    fn upsert_preserves_creation_fields_and_updates_the_sidebar_ones() {
        let store = SqliteSessionStore::open_in_memory().unwrap();
        let mut cursor = make_cursor("s1");
        store.save_cursor(&cursor).unwrap();

        cursor.model = "other-model".into();
        cursor.runtime_mode = "confirm".into();
        cursor.started_at = "2030-01-01T00:00:00+00:00".into();
        cursor.title = "用户改的名字".into();
        cursor.title_source = PersistedTitleSource::User;
        cursor.status = SessionStatus::Running;
        store.save_cursor(&cursor).unwrap();

        let loaded = store.load_cursor("s1").unwrap();
        assert_eq!(loaded.model, "default", "model 不被写穿覆盖");
        assert_eq!(
            loaded.runtime_mode, "auto",
            "用户选的运行时模式不得被一次写穿改写回默认值"
        );
        assert_eq!(loaded.started_at, "2024-12-31T23:00:00+00:00");
        assert_eq!(loaded.title, "用户改的名字");
        assert_eq!(loaded.title_source, PersistedTitleSource::User);
        assert_eq!(loaded.status, SessionStatus::Running);
    }

    /// 读判据**只拒绝两种行**（谓词是唯一一份，必须穷举）：无单元 / 损坏。
    ///
    /// **无名不是拒绝理由**（第 35 轮）：可见性与命名是两件事。终端首条输入不再给每个
    /// 会话命名，无 hook 的 CLI 永远等不到名字；若继续把 `title != ''` 当读门，重启后
    /// 那些会话整条消失。
    #[test]
    fn is_restorable_rejects_orphan_or_corrupt_rows() {
        let good = make_cursor("good");
        assert!(good.is_restorable(), "夹具本身就是可恢复的形状");

        let mut unnamed = make_cursor("unnamed");
        unnamed.title = String::new();
        unnamed.title_source = PersistedTitleSource::Placeholder;
        assert!(
            unnamed.is_restorable(),
            "无名但有单元 ⇒ 仍要回填（侧栏自己解释占位）"
        );

        let mut orphan = make_cursor("orphan");
        orphan.project_id = String::new();
        assert!(!orphan.is_restorable(), "没有单元 ⇒ 不知挂哪里");

        let mut corrupt = make_cursor("corrupt");
        corrupt.title_source = PersistedTitleSource::Placeholder;
        assert!(
            !corrupt.is_restorable(),
            "Placeholder 却带标题 ⇒ 数据损坏，不猜"
        );
    }

    /// 可恢复的行 = 能定位单元（`project_id` 非空）且不是损坏行；**标题可以空**。
    #[test]
    fn list_restorable_requires_a_unit_and_skips_corrupt_rows() {
        let store = SqliteSessionStore::open_in_memory().unwrap();
        store.save_cursor(&make_cursor("named")).unwrap();

        let mut unnamed = make_cursor("unnamed");
        unnamed.title = String::new();
        unnamed.title_source = PersistedTitleSource::Placeholder;
        store.save_cursor(&unnamed).unwrap();

        let mut orphan = make_cursor("orphan");
        orphan.project_id = String::new();
        store.save_cursor(&orphan).unwrap();

        let ids: Vec<String> = store
            .list_restorable()
            .into_iter()
            .map(|c| c.session_id)
            .collect();
        assert_eq!(ids, vec!["named".to_string(), "unnamed".to_string()]);
    }

    /// 「可恢复」的判据只有一份（[`ResumeCursor::is_restorable`]）：SQL 的 `WHERE` 只是粗筛，
    /// 必须比它更宽松。数据损坏的行（`Placeholder` 却带标题）能过粗筛，但**不得**被返回 ——
    /// 否则侧栏会显示一个「没有来源的名字」，而 `into_entry` 又会把它挡掉（写读两套判据）。
    #[test]
    fn list_restorable_applies_the_rust_gate_on_top_of_the_sql_prefilter() {
        let store = SqliteSessionStore::open_in_memory().unwrap();
        store.save_cursor(&make_cursor("named")).unwrap();

        let mut corrupt = make_cursor("corrupt");
        corrupt.title_source = PersistedTitleSource::Placeholder; // 有标题却没有来源
        store.save_cursor(&corrupt).unwrap();

        let ids: Vec<String> = store
            .list_restorable()
            .into_iter()
            .map(|c| c.session_id)
            .collect();
        assert_eq!(ids, vec!["named".to_string()], "粗筛放过、判据必须挡住");
    }

    #[test]
    fn delete_cursor_removes_the_row_and_is_idempotent() {
        let store = SqliteSessionStore::open_in_memory().unwrap();
        store.save_cursor(&make_cursor("s1")).unwrap();

        store.delete_cursor("s1").unwrap();
        assert!(store.load_cursor("s1").is_none());
        assert!(store.list_restorable().is_empty());
        store.delete_cursor("s1").expect("删除不存在的行不是错误");
    }

    /// 旧 schema（无新列）就地扩列：旧行不崩、缺列取默认值、且不被恢复
    /// （`project_id` 空 = 无法定位单元）。重复打开必须幂等。
    #[test]
    fn old_schema_is_upgraded_in_place_and_legacy_rows_are_not_restorable() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("agent_sessions.db");
        {
            let conn = db::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE session_cursors (
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
                );
                INSERT INTO session_cursors
                    (session_id, agent_kind, agent_id, cwd, model, runtime_mode,
                     turn_count, status, last_activity, created_at)
                VALUES ('legacy', '\"Custom\"', 'pi', '/old', 'm', 'auto',
                        2, '\"Ready\"', '2025-01-01T00:00:00+00:00',
                        '2025-01-01 00:00:00');",
            )
            .unwrap();
        }

        let store = SqliteSessionStore::open(&path).expect("旧库必须能就地升级");
        // 幂等：第二次打开不再重复 ALTER（重复补列会报 duplicate column name）。
        drop(SqliteSessionStore::open(&path).expect("扩列必须幂等"));

        let legacy = store.load_cursor("legacy").expect("旧行仍可读");
        assert_eq!(legacy.title, "", "旧行缺列取默认值");
        assert_eq!(legacy.project_id, "");
        assert_eq!(legacy.kind, PersistedSessionKind::Chat, "旧行缺省 = chat");
        assert_eq!(legacy.title_source, PersistedTitleSource::Placeholder);
        assert!(!legacy.has_user_input);
        assert_eq!(
            legacy.started_at, "2025-01-01 00:00:00",
            "created_at 复用为 started_at"
        );
        assert!(
            store.list_restorable().is_empty(),
            "无法定位单元的旧行不恢复"
        );

        // 扩列后新列可写：否则 save_cursor 会报 "no such column"。
        store.save_cursor(&make_cursor("fresh")).unwrap();
        assert_eq!(store.load_cursor("fresh").unwrap().title, "修复登录竞态");
        assert_eq!(store.list_restorable().len(), 1);
    }

    #[test]
    fn save_then_load_round_trip() {
        let store = SqliteSessionStore::open_in_memory().unwrap();
        let cursor = make_cursor("s1");
        store.save_cursor(&cursor).unwrap();

        let loaded = store.load_cursor("s1").unwrap();
        assert_eq!(loaded.session_id, "s1");
        assert_eq!(loaded.agent_kind, AgentKind::Custom);
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
    }

    /// 列所有权契约（`ResumeCursor::with_creation_fields_of`）必须在**两条写路径**上都成立：
    /// 投影合并（纯函数）与 SQL upsert（UPDATE 列不含创建期字段）。
    /// 两处共用一份字段清单的代价就是「只改一处」会静默回退用户设置。
    #[test]
    fn creation_fields_survive_both_write_paths() {
        let store = SqliteSessionStore::open_in_memory().unwrap();
        let mut created = make_cursor("s1");
        created.model = "opus".into();
        created.runtime_mode = "confirm".into();
        created.started_at = "2024-12-31T23:00:00+00:00".into();
        store.save_cursor(&created).unwrap();

        // 投影出来的 cursor 对创建期字段一无所知（与 `from_entry` 同形）。
        let mut projected = created.clone();
        projected.model = String::new();
        projected.runtime_mode = "auto".into();
        projected.started_at = "2030-01-01T00:00:00+00:00".into();
        projected.title = "新标题".into();

        // 路径 1：纯函数（`Registry::write_cursor` 在写盘前调它）。
        let merged = projected.clone().with_creation_fields_of(&created);
        assert_eq!(merged.model, "opus");
        assert_eq!(merged.runtime_mode, "confirm");
        assert_eq!(merged.started_at, "2024-12-31T23:00:00+00:00");
        assert_eq!(merged.title, "新标题", "非创建期字段以投影为准");

        // 路径 2：SQL upsert（不知情地整体覆盖也不得改写创建期字段）。
        store.save_cursor(&projected).unwrap();
        let loaded = store.load_cursor("s1").unwrap();
        assert_eq!(loaded.model, "opus", "SQL 层必须保留 model");
        assert_eq!(
            loaded.runtime_mode, "confirm",
            "SQL 层必须保留 runtime_mode"
        );
        assert_eq!(loaded.started_at, "2024-12-31T23:00:00+00:00");
        assert_eq!(loaded.title, "新标题");
    }

    #[test]
    fn load_missing_returns_none() {
        let store = SqliteSessionStore::open_in_memory().unwrap();
        assert!(store.load_cursor("nope").is_none());
    }
}
