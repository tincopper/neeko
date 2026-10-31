//! 团队域持久化：`team` / `team_member` / `team_task` / `team_event`（审计）。
//!
//! # 这一层**没有**业务判断
//!
//! 状态迁移的唯一入口是 [`crate::agent::team::manager::TeamManager`]。本文件只做
//! CRUD + 一次 schema 迁移，所以「谁能把任务改成 done」这类问题在这里找不到答案
//! —— 那是刻意的：两份判断迟早会分叉。
//!
//! # 两处**刻意**放在持久化边界的东西
//!
//! 1. [`clamp_summary`]：红线 4 的 4 KiB 硬上限。放在最外层写入点，任何调用方都绕不过
//!    （放在 manager 里就会漏掉「未来新增的第二个写入路径」）。
//! 2. 枚举 ↔ TEXT 的编码：库里存**人可读**的 snake_case（`in_progress`），
//!    而不是带引号的 JSON（`"in_progress"`）。design §1.2 把「`sqlite3` 可直接查」列为
//!    后端持有的收益之一，带引号的列会把这个收益吃掉。
//!
//! # 单元约定
//!
//! 表里所有时间都是 **epoch 毫秒**；只有 `team_task.lease_ttl` 是秒（给人看的口径）。

use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::path::{Path, PathBuf};

use crate::agent::team::types::{
    Artifact, MemberRole, MemberState, Team, TeamMember, TeamTask, TeamTaskState, Workspace,
};
use crate::common::db::DbPool;

/// `TeamTask.summary` 的硬上限（字节）。红线 4：进度摘要会进团队事件通道，
/// 而通道载荷没有第二个闸门。
pub const SUMMARY_MAX_BYTES: usize = 4096;

/// v13 -> v14：`team` / `team_member` / `team_task` / `team_event` + 索引。
///
/// 版本号进 / 事务回滚 / `user_version` 递增由 [`crate::common::db::migrations`] 的
/// 既有序列负责，这里**不写**自己的版本处理（写第二份就会分叉）。
///
/// `CREATE TABLE IF NOT EXISTS` 让本步骤在「半迁移后重跑」时安全：
/// 序列表只会重跑未提交的步骤，但幂等的 DDL 让手工重放也不会炸。
pub fn v13_to_v14(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        -- 团队：一名队长 + N 名成员 + 一块任务板。
        CREATE TABLE IF NOT EXISTS team (
            id              TEXT PRIMARY KEY,
            name            TEXT NOT NULL,
            lead_session_id TEXT NOT NULL,
            lead_agent_id   TEXT NOT NULL,
            project_path    TEXT NOT NULL,
            created_at      INTEGER NOT NULL,
            closed_at       INTEGER,
            state           TEXT NOT NULL
        );

        -- 成员：能力声明（channel / result_channel / tier / …）逐个落列，
        -- 丢掉一个就等于让面板谎报能力（红线 14）。
        CREATE TABLE IF NOT EXISTS team_member (
            id              TEXT PRIMARY KEY,
            team_id         TEXT NOT NULL REFERENCES team(id) ON DELETE CASCADE,
            name            TEXT NOT NULL,
            role            TEXT NOT NULL,
            agent_id        TEXT NOT NULL,
            model           TEXT,
            session_id      TEXT,
            terminal_id     TEXT,
            workspace       TEXT NOT NULL,
            channel         TEXT NOT NULL,
            result_channel  TEXT NOT NULL,
            tier            TEXT NOT NULL,
            approval_policy TEXT NOT NULL,
            mcp_injection   TEXT NOT NULL,
            last_seq        INTEGER NOT NULL,
            state           TEXT NOT NULL,
            token_hash      TEXT NOT NULL,
            joined_at       INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_team_member_team ON team_member(team_id);
        CREATE INDEX IF NOT EXISTS idx_team_member_state ON team_member(team_id, state);

        -- 任务板：done 的唯一权威。summary 的 4 KiB 上限由 store 层截断（红线 4）。
        CREATE TABLE IF NOT EXISTS team_task (
            id                TEXT PRIMARY KEY,
            team_id           TEXT NOT NULL REFERENCES team(id) ON DELETE CASCADE,
            title             TEXT NOT NULL,
            body              TEXT NOT NULL,
            state             TEXT NOT NULL,
            owner             TEXT,
            workspace         TEXT NOT NULL,
            depends_on        TEXT NOT NULL,
            claimed_at        INTEGER,
            lease_ttl         INTEGER NOT NULL,
            summary           TEXT,
            summary_truncated INTEGER NOT NULL DEFAULT 0,
            artifacts         TEXT NOT NULL,
            reclaim_count     INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_team_task_team ON team_task(team_id, state);
        CREATE INDEX IF NOT EXISTS idx_team_task_state ON team_task(state);
        CREATE INDEX IF NOT EXISTS idx_team_task_owner ON team_task(owner);

        -- 审计：只追加。kind 是开集字符串（新增事件类别不该要求一次迁移）。
        CREATE TABLE IF NOT EXISTS team_event (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            team_id TEXT NOT NULL REFERENCES team(id) ON DELETE CASCADE,
            at      INTEGER NOT NULL,
            actor   TEXT NOT NULL,
            kind    TEXT NOT NULL,
            subject TEXT,
            detail  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_team_event_team ON team_event(team_id, id);
        ",
    )?;
    Ok(())
}

/// 把 `summary` 压到 [`SUMMARY_MAX_BYTES`]，返回 `(值, 是否截断)`。
///
/// 截断点必须落在 UTF-8 字符边界上，否则写入的是非法 UTF-8，读回来会是乱码或
/// 直接解码失败（中文摘要按 3 字节/字，`4096 / 3 = 1365` 个字的边界几乎必然落在字符中间）。
#[must_use]
pub fn clamp_summary(summary: &str) -> (String, bool) {
    if summary.len() <= SUMMARY_MAX_BYTES {
        return (summary.to_owned(), false);
    }
    let mut end = SUMMARY_MAX_BYTES;
    while end > 0 && !summary.is_char_boundary(end) {
        end -= 1;
    }
    (summary[..end].to_owned(), true)
}

/// 返回 `summary` 已按红线 4 收敛后的**任务副本**。
///
/// manager 用它同步内存态与库里那一行：只给 store 截断而内存留着原文，会让
/// 「板上显示的长度」与「重启后的长度」不一致 —— 那正是两份真相源。
#[must_use]
pub fn clamp_task_summary(task: &TeamTask) -> TeamTask {
    let mut out = task.clone();
    match &task.summary {
        Some(summary) => {
            let (clamped, truncated) = clamp_summary(summary);
            out.summary = Some(clamped);
            out.summary_truncated = truncated;
        }
        None => out.summary_truncated = false,
    }
    out
}

/// 团队域 SQLite facade。
///
/// 与其它域一样**共享** `neeko.db` 的连接池（一个数据库文件一个池），不自己开池。
pub struct TeamStore {
    pool: DbPool,
}

impl TeamStore {
    /// 包装共享池。
    ///
    /// **前置条件**：调用方必须已在这个池上跑过迁移链（`LibraryStore::with_pool`
    /// 通常就是那个入口）。否则每一条查询都会以 `no such table: team` 失败。
    #[must_use]
    pub const fn with_pool(pool: DbPool) -> Self {
        Self { pool }
    }

    /// 打开（或创建）一个团队库并跑完整迁移链。
    pub fn open(db_path: &Path) -> Result<Self> {
        let pool = crate::common::db::open_pool(db_path, 2)?;
        let mut conn = pool.get()?;
        crate::common::db::run_migrations(&mut conn)?;
        Ok(Self { pool })
    }

    /// 打开一个内存库并跑完整迁移链（测试夹具）。
    pub fn open_in_memory() -> Result<Self> {
        let pool = crate::common::db::open_memory_pool()?;
        let mut conn = pool.get()?;
        crate::common::db::run_migrations(&mut conn)?;
        Ok(Self { pool })
    }

    /// 共享池（供组合根证明注入的是同一个池）。
    #[must_use]
    pub const fn pool(&self) -> &DbPool {
        &self.pool
    }

    fn conn(&self) -> Result<r2d2::PooledConnection<r2d2_sqlite::SqliteConnectionManager>> {
        Ok(self.pool.get()?)
    }

    // ═══════════════════════════════════════════════════════════════════
    // team
    // ═══════════════════════════════════════════════════════════════════

    /// 插入或覆盖一个团队。
    pub fn upsert_team(&self, team: &Team) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO team (id, name, lead_session_id, lead_agent_id, project_path,
             created_at, closed_at, state)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                lead_session_id = excluded.lead_session_id,
                lead_agent_id = excluded.lead_agent_id,
                project_path = excluded.project_path,
                created_at = excluded.created_at,
                closed_at = excluded.closed_at,
                state = excluded.state",
            params![
                team.id,
                team.name,
                team.lead_session_id,
                team.lead_agent_id,
                path_text(&team.project_path)?,
                team.created_at,
                team.closed_at,
                text_of(&team.state, "team.state")?,
            ],
        )?;
        Ok(())
    }

    /// 按 id 读一个团队。
    pub fn get_team(&self, id: &str) -> Result<Option<Team>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, lead_session_id, lead_agent_id, project_path, created_at,
             closed_at, state FROM team WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], map_team_row)?;
        rows.next().transpose().map_err(Into::into)
    }

    /// 读全部团队（启动恢复用）。
    pub fn list_teams(&self) -> Result<Vec<Team>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, lead_session_id, lead_agent_id, project_path, created_at,
             closed_at, state FROM team ORDER BY created_at",
        )?;
        let rows = stmt.query_map([], map_team_row)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    // ═══════════════════════════════════════════════════════════════════
    // team_member
    // ═══════════════════════════════════════════════════════════════════

    /// 插入或覆盖一名成员。
    pub fn upsert_member(&self, member: &TeamMember) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO team_member (id, team_id, name, role, agent_id, model, session_id,
             terminal_id, workspace, channel, result_channel, tier, approval_policy,
             mcp_injection, last_seq, state, token_hash, joined_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                role = excluded.role,
                agent_id = excluded.agent_id,
                model = excluded.model,
                session_id = excluded.session_id,
                terminal_id = excluded.terminal_id,
                workspace = excluded.workspace,
                channel = excluded.channel,
                result_channel = excluded.result_channel,
                tier = excluded.tier,
                approval_policy = excluded.approval_policy,
                mcp_injection = excluded.mcp_injection,
                last_seq = excluded.last_seq,
                state = excluded.state,
                token_hash = excluded.token_hash,
                joined_at = excluded.joined_at",
            params![
                member.id,
                member.team_id,
                member.name,
                text_of(&member.role, "team_member.role")?,
                member.agent_id,
                member.model,
                member.session_id,
                member.terminal_id,
                text_of(&member.workspace, "team_member.workspace")?,
                text_of(&member.channel, "team_member.channel")?,
                text_of(&member.result_channel, "team_member.result_channel")?,
                text_of(&member.tier, "team_member.tier")?,
                text_of(&member.approval_policy, "team_member.approval_policy")?,
                text_of(&member.mcp_injection, "team_member.mcp_injection")?,
                i64::try_from(member.last_seq).context("last_seq exceeds i64")?,
                text_of(&member.state, "team_member.state")?,
                member.token_hash,
                member.joined_at,
            ],
        )?;
        Ok(())
    }

    /// 按 id 读一名成员。
    pub fn get_member(&self, id: &str) -> Result<Option<TeamMember>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(&format!("{SELECT_MEMBER} WHERE id = ?1"))?;
        let mut rows = stmt.query_map(params![id], map_member_row)?;
        rows.next().transpose().map_err(Into::into)
    }

    /// 读一个团队的全部成员。
    pub fn list_members(&self, team_id: &str) -> Result<Vec<TeamMember>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(&format!(
            "{SELECT_MEMBER} WHERE team_id = ?1 ORDER BY joined_at"
        ))?;
        let rows = stmt.query_map(params![team_id], map_member_row)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    // ═══════════════════════════════════════════════════════════════════
    // team_task
    // ═══════════════════════════════════════════════════════════════════

    /// 插入或覆盖一个任务。
    ///
    /// `summary` 在这里被压到 [`SUMMARY_MAX_BYTES`]（红线 4），截断结果回写到
    /// `summary_truncated` —— 注意它写的是**入参的副本**，调用方内存里的字符串不受影响。
    pub fn upsert_task(&self, task: &TeamTask) -> Result<()> {
        let task = &clamp_task_summary(task);
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO team_task (id, team_id, title, body, state, owner, workspace,
             depends_on, claimed_at, lease_ttl, summary, summary_truncated, artifacts,
             reclaim_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
             ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                body = excluded.body,
                state = excluded.state,
                owner = excluded.owner,
                workspace = excluded.workspace,
                depends_on = excluded.depends_on,
                claimed_at = excluded.claimed_at,
                lease_ttl = excluded.lease_ttl,
                summary = excluded.summary,
                summary_truncated = excluded.summary_truncated,
                artifacts = excluded.artifacts,
                reclaim_count = excluded.reclaim_count",
            params![
                task.id,
                task.team_id,
                task.title,
                task.body,
                text_of(&task.state, "team_task.state")?,
                task.owner,
                text_of(&task.workspace, "team_task.workspace")?,
                text_of(&task.depends_on, "team_task.depends_on")?,
                task.claimed_at,
                task.lease_ttl,
                task.summary,
                i64::from(task.summary_truncated),
                text_of(&task.artifacts, "team_task.artifacts")?,
                i64::from(task.reclaim_count),
            ],
        )?;
        Ok(())
    }

    /// 按 id 读一个任务。
    pub fn get_task(&self, id: &str) -> Result<Option<TeamTask>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(&format!("{SELECT_TASK} WHERE id = ?1"))?;
        let mut rows = stmt.query_map(params![id], map_task_row)?;
        rows.next().transpose().map_err(Into::into)
    }

    /// 读一个团队的全部任务（按 id 稳定排序，便于断言）。
    pub fn list_tasks(&self, team_id: &str) -> Result<Vec<TeamTask>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(&format!("{SELECT_TASK} WHERE team_id = ?1 ORDER BY id"))?;
        let rows = stmt.query_map(params![team_id], map_task_row)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    // ═══════════════════════════════════════════════════════════════════
    // team_event（审计日志，只追加）
    // ═══════════════════════════════════════════════════════════════════

    /// 追加一条审计记录，返回其自增 id。
    pub fn append_event(&self, event: &TeamEventRecord) -> Result<i64> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO team_event (team_id, at, actor, kind, subject, detail)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                event.team_id,
                event.at,
                event.actor,
                event.kind,
                event.subject,
                event.detail,
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// 读一个团队的审计记录（按写入顺序）。
    pub fn list_events(&self, team_id: &str) -> Result<Vec<TeamEventRecord>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, team_id, at, actor, kind, subject, detail
             FROM team_event WHERE team_id = ?1 ORDER BY id",
        )?;
        let rows = stmt.query_map(params![team_id], |row| {
            Ok(TeamEventRecord {
                id: row.get(0)?,
                team_id: row.get(1)?,
                at: row.get(2)?,
                actor: row.get(3)?,
                kind: row.get(4)?,
                subject: row.get(5)?,
                detail: row.get(6)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }
}

/// 一条审计记录（`team_event` 行）。
///
/// `kind` 是开集字符串而不是枚举：审计是调试与合规的载体，将来新增一种事件
/// 不应该要求一次迁移；关闭集在 [`crate::agent::team::manager`] 的常量里。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TeamEventRecord {
    /// 自增主键（`append_event` 之前为 `None` 风格：读出来才有值）。
    pub id: Option<i64>,
    /// 所属团队。
    pub team_id: String,
    /// 发生时间（epoch 毫秒）。
    pub at: i64,
    /// 触发者：成员 id 或 `"system"`。
    pub actor: String,
    /// 事件类别（`claim` / `force_done` / `reclaim` / `blocked` / `signal` …）。
    pub kind: String,
    /// 被操作对象（任务 id / 成员 id）。
    pub subject: Option<String>,
    /// 附加上下文（短文本或 JSON）。
    pub detail: Option<String>,
}

const SELECT_MEMBER: &str = "SELECT id, team_id, name, role, agent_id, model, session_id,
    terminal_id, workspace, channel, result_channel, tier, approval_policy, mcp_injection,
    last_seq, state, token_hash, joined_at FROM team_member";

const SELECT_TASK: &str = "SELECT id, team_id, title, body, state, owner, workspace,
    depends_on, claimed_at, lease_ttl, summary, summary_truncated, artifacts, reclaim_count
    FROM team_task";

fn map_team_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Team> {
    Ok(Team {
        id: row.get(0)?,
        name: row.get(1)?,
        lead_session_id: row.get(2)?,
        lead_agent_id: row.get(3)?,
        project_path: PathBuf::from(row.get::<_, String>(4)?),
        created_at: row.get(5)?,
        closed_at: row.get(6)?,
        state: column_json(row.get::<_, String>(7)?, "team.state")?,
    })
}

fn map_member_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TeamMember> {
    let last_seq: i64 = row.get(14)?;
    Ok(TeamMember {
        id: row.get(0)?,
        team_id: row.get(1)?,
        name: row.get(2)?,
        role: column_json::<MemberRole>(row.get::<_, String>(3)?, "team_member.role")?,
        agent_id: row.get(4)?,
        model: row.get(5)?,
        session_id: row.get(6)?,
        terminal_id: row.get(7)?,
        workspace: column_json::<Workspace>(row.get::<_, String>(8)?, "team_member.workspace")?,
        channel: column_json(row.get::<_, String>(9)?, "team_member.channel")?,
        result_channel: column_json(row.get::<_, String>(10)?, "team_member.result_channel")?,
        tier: column_json(row.get::<_, String>(11)?, "team_member.tier")?,
        approval_policy: column_json(row.get::<_, String>(12)?, "team_member.approval_policy")?,
        mcp_injection: column_json(row.get::<_, String>(13)?, "team_member.mcp_injection")?,
        last_seq: u64::try_from(last_seq)
            .map_err(|_| conversion_failure("team_member.last_seq", "negative seq"))?,
        state: column_json::<MemberState>(row.get::<_, String>(15)?, "team_member.state")?,
        token_hash: row.get(16)?,
        joined_at: row.get(17)?,
    })
}

fn map_task_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TeamTask> {
    let reclaim_count: i64 = row.get(13)?;
    Ok(TeamTask {
        id: row.get(0)?,
        team_id: row.get(1)?,
        title: row.get(2)?,
        body: row.get(3)?,
        state: column_json::<TeamTaskState>(row.get::<_, String>(4)?, "team_task.state")?,
        owner: row.get(5)?,
        workspace: column_json::<Workspace>(row.get::<_, String>(6)?, "team_task.workspace")?,
        depends_on: column_json(row.get::<_, String>(7)?, "team_task.depends_on")?,
        claimed_at: row.get(8)?,
        lease_ttl: row.get(9)?,
        summary: row.get(10)?,
        summary_truncated: row.get::<_, i64>(11)? != 0,
        artifacts: column_json::<Vec<Artifact>>(row.get::<_, String>(12)?, "team_task.artifacts")?,
        reclaim_count: u32::try_from(reclaim_count)
            .map_err(|_| conversion_failure("team_task.reclaim_count", "out of range"))?,
    })
}

/// 枚举/结构体 → 库里可读的 TEXT。
///
/// 无载荷变体存裸 snake_case（`in_progress`），带载荷变体存 JSON
/// （`{"worktree":{"path":"…"}}`）—— 两种都是同一份 serde 表示，不需要第二张映射表。
fn text_of<T: Serialize>(value: &T, column: &'static str) -> Result<String> {
    let encoded = serde_json::to_value(value).with_context(|| format!("encode {column}"))?;
    match encoded {
        serde_json::Value::String(text) => Ok(text),
        other => Ok(other.to_string()),
    }
}

fn value_of<T: DeserializeOwned>(text: &str, column: &'static str) -> Result<T> {
    let value = if text.starts_with('{') || text.starts_with('[') {
        serde_json::from_str(text).with_context(|| format!("decode {column}"))?
    } else {
        serde_json::Value::String(text.to_owned())
    };
    serde_json::from_value(value).with_context(|| format!("decode {column}"))
}

fn column_json<T: DeserializeOwned>(text: String, column: &'static str) -> rusqlite::Result<T> {
    value_of(&text, column).map_err(|err| conversion_failure(column, &err.to_string()))
}

fn conversion_failure(column: &'static str, reason: &str) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        format!("{column}: {reason}").into(),
    )
}

/// 路径 → TEXT。非 UTF-8 路径**显式报错**而不是 `to_string_lossy`：
/// 静默改掉一个字节会让「worktree 路径」指向别处。
fn path_text(path: &Path) -> Result<String> {
    path.to_str()
        .map(ToOwned::to_owned)
        .with_context(|| format!("path is not valid UTF-8: {}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::team::types::{
        AdmissionTier, ApprovalPolicy, ArtifactKind, McpInjection, ResultChannel, TeamState,
        WorkerChannel,
    };

    fn store() -> TeamStore {
        TeamStore::open_in_memory().unwrap()
    }

    /// 带一个团队的库：成员的 `team_member.team_id` 有外键，孤儿行会被 SQLite 拒。
    fn seeded_store() -> TeamStore {
        let store = store();
        store.upsert_team(&sample_team()).unwrap();
        store
    }

    fn sample_team() -> Team {
        Team {
            id: "tm_1".into(),
            name: "Team One".into(),
            lead_session_id: "sess-lead".into(),
            lead_agent_id: "claude".into(),
            // 红线 13：夹具路径由 CARGO_MANIFEST_DIR 推导，不硬编码 POSIX 绝对路径。
            project_path: PathBuf::from(env!("CARGO_MANIFEST_DIR")),
            created_at: 1_700_000_000_000,
            closed_at: None,
            state: TeamState::Active,
        }
    }

    /// 一行**每列都偏离默认值**的成员（round-trip 用）。
    ///
    /// 故意**不**用 [`crate::agent::team::fixtures::fixture_member`]：仓库层的契约是
    /// "每一列都能原样往返"，用默认值打底的夹具会让“某列根本没写进库”这类 bug 变绿。
    /// 其余测试文件一律用共享夹具（那里关心的是行为，不是列）。
    fn sample_member() -> TeamMember {
        TeamMember {
            id: "w1@tm_1".into(),
            team_id: "tm_1".into(),
            name: "w1".into(),
            role: MemberRole::Worker,
            agent_id: "claude".into(),
            model: Some("sonnet".into()),
            session_id: None,
            terminal_id: Some("term-1".into()),
            workspace: Workspace::Worktree {
                path: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("wt-w1"),
            },
            channel: WorkerChannel::Mcp,
            result_channel: ResultChannel::Sentinel,
            tier: AdmissionTier::B,
            approval_policy: ApprovalPolicy::Queue,
            mcp_injection: McpInjection::Argv,
            last_seq: 7,
            state: MemberState::Running,
            token_hash: "sha256:abc".into(),
            joined_at: 1_700_000_000_001,
        }
    }

    fn sample_task() -> TeamTask {
        TeamTask {
            id: "t1".into(),
            team_id: "tm_1".into(),
            title: "Do the thing".into(),
            body: "long prompt".into(),
            state: TeamTaskState::InProgress,
            owner: Some("w1@tm_1".into()),
            workspace: Workspace::Shared,
            depends_on: vec!["t0".into()],
            claimed_at: Some(1_700_000_000_002),
            lease_ttl: 1800,
            summary: Some("halfway".into()),
            summary_truncated: false,
            artifacts: vec![Artifact {
                kind: ArtifactKind::Commit,
                value: "deadbeef".into(),
            }],
            reclaim_count: 2,
        }
    }

    /// schema 迁移必须挂在既有版本链上：全新库跑完整链后 `user_version == LATEST_VERSION`
    /// 且四张表 + 索引都在（不新建连接池、不自己管版本号）。
    #[test]
    fn migration_chain_creates_team_tables_at_latest_version() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::common::db::run_migrations(&mut conn).unwrap();

        let version: u32 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, crate::common::db::LATEST_VERSION);
        assert_eq!(version, 14);

        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index')")
            .unwrap();
        let names: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        for needed in [
            "team",
            "team_member",
            "team_task",
            "team_event",
            "idx_team_member_team",
            "idx_team_member_state",
            "idx_team_task_team",
            "idx_team_task_state",
            "idx_team_task_owner",
            "idx_team_event_team",
        ] {
            assert!(names.contains(&needed.to_string()), "missing {needed}");
        }
    }

    /// 幂等：迁移步骤重放不得炸（版本链只会重跑未提交步骤，但手工重放是真实操作）。
    #[test]
    fn migration_step_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        v13_to_v14(&conn).unwrap();
        v13_to_v14(&conn).unwrap();
    }

    /// 团队读写往返（含 `PathBuf` 列）。
    #[test]
    fn team_round_trips() {
        let store = store();
        let team = sample_team();
        store.upsert_team(&team).unwrap();

        assert_eq!(store.get_team("tm_1").unwrap(), Some(team));
        assert_eq!(store.get_team("nope").unwrap(), None);
        assert_eq!(store.list_teams().unwrap().len(), 1);
    }

    /// 外键保护：孤儿成员/任务行必须被拒 —— 团队关掉后留下的悬空行会让
    /// 面板显示「幽灵成员」，而那时已经无法判断它属于谁。
    #[test]
    fn orphan_member_and_task_rows_are_rejected() {
        let store = store();
        assert!(store.upsert_member(&sample_member()).is_err());
        assert!(store.upsert_task(&sample_task()).is_err());
    }

    /// 红线 14 / design §4.4：能力声明字段（channel / result_channel / tier /
    /// approval_policy / mcp_injection）必须逐个存活 —— 丢一个等于让面板谎报能力。
    #[test]
    fn member_keeps_every_capability_column() {
        let store = seeded_store();
        let member = sample_member();
        store.upsert_member(&member).unwrap();

        let read = store.get_member("w1@tm_1").unwrap().unwrap();
        assert_eq!(read, member);
        assert_ne!(read.channel, WorkerChannel::Pty);
        assert_ne!(read.result_channel, ResultChannel::Mcp);
        assert_eq!(store.list_members("tm_1").unwrap().len(), 1);
    }

    /// 任务读写往返：workspace（带数据的变体）、依赖、产物引用都要原样回来。
    #[test]
    fn task_round_trips_workspace_dependencies_and_artifacts() {
        let store = seeded_store();
        let task = sample_task();
        store.upsert_task(&task).unwrap();

        assert_eq!(store.get_task("t1").unwrap(), Some(task));
        assert_eq!(store.get_task("t404").unwrap(), None);

        let mut worktree_task = sample_task();
        worktree_task.id = "t2".into();
        worktree_task.workspace = Workspace::Worktree {
            path: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("wt"),
        };
        store.upsert_task(&worktree_task).unwrap();
        assert_eq!(
            store.get_task("t2").unwrap().unwrap().workspace,
            worktree_task.workspace
        );
        assert_eq!(store.list_tasks("tm_1").unwrap().len(), 2);
    }

    /// 红线 4：`summary` > 4 KiB 必须在写入时截断并打标。
    #[test]
    fn summary_over_4k_is_truncated_and_flagged() {
        let store = seeded_store();
        let mut task = sample_task();
        task.summary = Some("x".repeat(SUMMARY_MAX_BYTES * 2));
        store.upsert_task(&task).unwrap();

        let read = store.get_task("t1").unwrap().unwrap();
        let summary = read.summary.as_deref().unwrap();
        assert_eq!(summary.len(), SUMMARY_MAX_BYTES);
        assert!(read.summary_truncated, "truncation must be recorded");
        assert!(!summary.contains('X'));
    }

    /// 边界：正好 4 KiB 不算截断（否则「恰好装得下」的摘要会被误标）。
    #[test]
    fn summary_exactly_at_limit_is_not_flagged() {
        let store = seeded_store();
        let mut task = sample_task();
        task.summary = Some("y".repeat(SUMMARY_MAX_BYTES));
        store.upsert_task(&task).unwrap();

        let read = store.get_task("t1").unwrap().unwrap();
        assert_eq!(read.summary.as_ref().unwrap().len(), SUMMARY_MAX_BYTES);
        assert!(!read.summary_truncated);
    }

    /// 截断点必须落在 UTF-8 字符边界：中文 3 字节/字，4096 字节的边界必然落在字符中间。
    #[test]
    fn truncation_does_not_split_a_multibyte_character() {
        let summary = "中".repeat(2000); // 6000 字节
        let (clamped, truncated) = clamp_summary(&summary);
        assert!(truncated);
        assert!(clamped.len() <= SUMMARY_MAX_BYTES);
        assert!(clamped.chars().all(|c| c == '中'), "a character was split");
        assert!(!clamped.is_empty());
    }

    /// design §1.2 把「`sqlite3` 可直接查」当作后端持有的收益：枚举列必须是可读的
    /// snake_case，不是带引号的 JSON。带引号的列会让这条收益归零。
    #[test]
    fn enum_columns_are_readable_snake_case_in_the_database() {
        let store = seeded_store();
        store.upsert_task(&sample_task()).unwrap();
        store.upsert_member(&sample_member()).unwrap();

        let conn = store.conn().unwrap();
        let state: String = conn
            .query_row("SELECT state FROM team_task WHERE id = 't1'", [], |row| {
                row.get(0)
            })
            .unwrap();
        let member_state: String = conn
            .query_row(
                "SELECT state FROM team_member WHERE id = 'w1@tm_1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(state, "in_progress");
        assert_eq!(member_state, "running");
        // 带数据的变体是 JSON（同一份 serde 表示，不需要第二张映射表）。
        let workspace: String = conn
            .query_row(
                "SELECT workspace FROM team_member WHERE id = 'w1@tm_1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(workspace.starts_with("{\"worktree\""), "{workspace}");
    }

    /// 审计日志只追加、按写入顺序读回 —— 它是「谁把任务判死了」的唯一证据。
    #[test]
    fn audit_log_is_append_only_and_ordered() {
        let store = seeded_store();
        let mut first = TeamEventRecord {
            id: None,
            team_id: "tm_1".into(),
            at: 10,
            actor: "lead@tm_1".into(),
            kind: "claim".into(),
            subject: Some("t1".into()),
            detail: None,
        };
        store.append_event(&first).unwrap();
        first.kind = "force_done".into();
        first.at = 20;
        store.append_event(&first).unwrap();

        let events = store.list_events("tm_1").unwrap();
        assert_eq!(
            events.iter().map(|e| e.kind.as_str()).collect::<Vec<_>>(),
            vec!["claim", "force_done"]
        );
        assert!(events[0].id.unwrap() < events[1].id.unwrap());
        assert!(store.list_events("other").unwrap().is_empty());
    }

    /// 同 id 覆盖写：状态与摘要都要更新（这是 task_update 的落库路径）。
    #[test]
    fn upsert_task_overwrites_existing_row() {
        let store = seeded_store();
        let mut task = sample_task();
        store.upsert_task(&task).unwrap();

        task.state = TeamTaskState::Done;
        task.summary = Some("finished".into());
        store.upsert_task(&task).unwrap();

        let read = store.get_task("t1").unwrap().unwrap();
        assert_eq!(read.state, TeamTaskState::Done);
        assert_eq!(read.summary.as_deref(), Some("finished"));
        assert_eq!(store.list_tasks("tm_1").unwrap().len(), 1);
    }

    /// 文件库重开后数据仍在（崩溃恢复的最基本形态），也顺带覆盖 `TeamStore::open`。
    /// 红线 13：库路径来自 `tempdir()`，不硬编码。
    #[test]
    fn file_backed_store_survives_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("neeko.db");

        let task = sample_task();
        {
            let store = TeamStore::open(&db).unwrap();
            store.upsert_team(&sample_team()).unwrap();
            store.upsert_task(&task).unwrap();
        }

        let reopened = TeamStore::open(&db).unwrap();
        assert_eq!(reopened.get_task("t1").unwrap(), Some(task));
        assert_eq!(reopened.get_team("tm_1").unwrap(), Some(sample_team()));
    }
}
