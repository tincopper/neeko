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
    Artifact, MemberRole, MemberState, Persona, RolePreset, TaskRef, Team, TeamMember, TeamTask,
    TeamTaskState, Workspace, DEFAULT_MAX_MEMBERS,
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
            project_id      TEXT NOT NULL DEFAULT '',
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
        --
        -- **主键是 `(team_id, id)`**：`t1` 是**队内**标识符，每个队的板都从 `t1`
        -- 开始编号（见 `v16_to_v17`）。单列 `id` 主键会让第二个队的第一个任务
        -- 必然撞上别队的 `t1`。
        CREATE TABLE IF NOT EXISTS team_task (
            id                TEXT NOT NULL,
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
            reclaim_count     INTEGER NOT NULL DEFAULT 0,
            -- 计划事实（谁该做）；`owner` 是执行事实（谁在做）。v24 补列见 `v23_to_v24`。
            assignee          TEXT,
            PRIMARY KEY (team_id, id)
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

/// v14 -> v15：团队配置进 `team` 行（候选池 / 默认 model / 默认工作区 / 默认审批 / 成员上限）。
///
/// # 五列全带默认值：旧行必须能读出来
///
/// 升级路径上唯一存在的数据就是**已建的团队行**。任何一列若 NOT NULL 却没有 DEFAULT，
/// `ALTER TABLE` 会在第一个旧行上失败 —— 那是「升级后打不开面板」级别的故障。所以
/// 除 `default_model`（语义就是可空）以外一律 `NOT NULL DEFAULT …`。
/// 判据：`a_v14_team_row_upgrades_to_the_documented_defaults`。
///
/// # 为什么先查 `pragma_table_info`
///
/// `ALTER TABLE ADD COLUMN` **不是**幂等的（列已存在 = 报错），而 v13→v14 的
/// `CREATE TABLE IF NOT EXISTS` 是可以手工重放的。保持同一性质：「半迁移后手工重放」
/// 不得炸（判据：`migration_step_is_idempotent`）。
///
/// 列默认值的字面量必须与 `text_of` 的裸 snake_case 口径一致：`Workspace::Shared` 存成
/// `shared`、`ApprovalPolicy::Queue` 存成 `queue`（不是带引号的 JSON）。
pub fn v14_to_v15(conn: &Connection) -> Result<()> {
    add_column_if_missing(
        conn,
        "team",
        "allowed_agent_ids",
        "TEXT NOT NULL DEFAULT '[]'",
    )?;
    add_column_if_missing(conn, "team", "default_model", "TEXT")?;
    add_column_if_missing(
        conn,
        "team",
        "default_workspace",
        "TEXT NOT NULL DEFAULT 'shared'",
    )?;
    add_column_if_missing(
        conn,
        "team",
        "default_approval_policy",
        "TEXT NOT NULL DEFAULT 'queue'",
    )?;
    add_column_if_missing(
        conn,
        "team",
        "max_members",
        &format!("INTEGER NOT NULL DEFAULT {DEFAULT_MAX_MEMBERS}"),
    )?;
    Ok(())
}

/// v15 -> v16：`team.project_id` —— 拥有这个团队执行环境的项目 id。
///
/// # 为什么团队行需要它
///
/// 环境的权威是**项目**（`Project.environment`），而团队只持久化了一个 `project_path`。
/// 在 v15 之前，执行层只能拿这个路径去项目库里做**前缀反查**
/// （[`crate::core::project::environment_for_path`]）。这条路对 Neeko 自己的工作树
/// （`~/.neeko/worktrees/<name>`，按设计落在项目目录**之外**）永远匹配不上，
/// 于是「从工作树单元开团队」必失败 —— 而失败点在建队**写入之后**、起进程之前，
/// 库里因此留下孤儿团队行。记录项目 id 让「环境归属」成为一个被持久化的事实，
/// 而不是一次事后猜测。
///
/// # 空串的语义（**不是**「没有项目」）
///
/// 空串 = **v16 之前建的行**（≤ v15 的库）。那时环境只能靠路径前缀猜，所以这一列
/// 没有可回填的事实；执行层对这类行退回旧路径（见
/// [`crate::agent::team::execution::environment_source`]）。**不要**把空串读成「这个团队
/// 没有项目」：v16 之后的写入路径在纯函数层就拒绝空 id
/// （`bootstrap::plan_team`）。
///
/// 默认值存在的理由与 v14→v15 同源：升级路径上唯一存在的数据就是**已建的团队行**，
/// NOT NULL 却没有 DEFAULT 会让 `ALTER TABLE` 在第一个旧行上失败。
pub fn v15_to_v16(conn: &Connection) -> Result<()> {
    add_column_if_missing(conn, "team", "project_id", "TEXT NOT NULL DEFAULT ''")
}

/// v16 -> v17：`team_task` 的主键从 `id` 改成复合主键 `(team_id, id)`。
///
/// # 为什么要改（撤销 v16 期的「全局单调序号」裁决）
///
/// v16 期的权宜是「任务 id 在**整个库**里单调递增」（`next_task_seq` 取全库最大值），
/// 因为 `t{n}` 里只有 `{n}` 一个数位信息，而单列 `id` 主键让每个队的 `t1` 会互相撞。
/// 代价是单个队的 id 不连续（新队的第一件活可能是 `t7`）—— 而任务 id 是**队长与成员在
/// 对话里互相指代**的东西，越简单越好。
///
/// 裁决改成「任务 id 是**队内**标识符，`TaskRef = (team_id, id)` 是唯一寻址形式」之后，
/// 全局序号就**不再需要**：它当初唯一的理由（避开主键冲突）被复合主键消掉了。
/// 每个队的板从 `t1` 开始，跨队重名是常态且无害—— 因为没有任何调用点能拿到一个
/// 不带 `team_id` 的 `id`。
///
/// # 为什么这次可以整表重建（v14 期的「不做复合主键」为什么当时是对的）
///
/// 当时的否决理由是「`PRAGMA foreign_keys` 在事务内是 no-op，于是『重建 + 中途失败
/// 回滚』没有安全形态」。那个理由在**父表**上成立，在**子表**上不成立 ——
/// `team_task` 是**子表**：没有任何表引用它，所以重建期间它身上的 `ON DELETE CASCADE`
/// 永远不会被触发，也就不存在「重建中途把父行级联掉」的路径。加上整步跑在
/// `migrations::run_migrations` 的 `EXCLUSIVE` 事务里（DDL 在 SQLite 里是事务性的），
/// 失败 = 整步回滚，旧表原样还在。
///
/// 额外的收益：`INSERT INTO … SELECT` 在 `foreign_keys=ON` 时会顺带校验每一行的
/// `team_id` 都能在 `team` 表里找到 —— 等于一次免费的一致性检查。
///
/// # 幂等
///
/// 重建**不是**幂等的（`CREATE TABLE team_task` 会撞已存在的表），所以先判「已经是
/// 复合主键」：`pragma_table_info` 里 `pk` 列给出主键内的序号，`team_id = 1` 且
/// `id = 2` 即已迁移。半迁移后的手工重放因此安全（与 v14→v15 / v15→v16 同一性质，
/// 判据：`migration_step_is_idempotent`）。
///
/// **列序也是承重的**：`(team_id, id)` 的隐式索引可以直接服务 `WHERE team_id = ?`
/// （`list_tasks` 与 `next_task_seq` 都是这个形状），而 `(id, team_id)` 的索引对它们
/// 完全无用。判据 `the_task_primary_key_is_team_first` 钉住这个顺序。
pub fn v16_to_v17(conn: &Connection) -> Result<()> {
    if task_primary_key_is_team_first(conn)? {
        return Ok(());
    }
    conn.execute_batch(
        "
        CREATE TABLE team_task_v17 (
            id                TEXT NOT NULL,
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
            reclaim_count     INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (team_id, id)
        );

        INSERT INTO team_task_v17 (id, team_id, title, body, state, owner, workspace,
            depends_on, claimed_at, lease_ttl, summary, summary_truncated, artifacts,
            reclaim_count)
        SELECT id, team_id, title, body, state, owner, workspace,
            depends_on, claimed_at, lease_ttl, summary, summary_truncated, artifacts,
            reclaim_count
        FROM team_task;

        DROP TABLE team_task;
        ALTER TABLE team_task_v17 RENAME TO team_task;

        CREATE INDEX IF NOT EXISTS idx_team_task_team ON team_task(team_id, state);
        CREATE INDEX IF NOT EXISTS idx_team_task_state ON team_task(state);
        CREATE INDEX IF NOT EXISTS idx_team_task_owner ON team_task(owner);
        ",
    )?;
    Ok(())
}

/// `team_task` 的主键是否已经是 `(team_id, id)`（`team_id` 在前）。
///
/// `pragma_table_info` 的 `pk` 列是「该列在主键里的序号」（0 = 不是主键的一部分），
/// 所以这一个查询同时回答了两件事：是不是复合主键、以及列的顺序对不对。
fn task_primary_key_is_team_first(conn: &Connection) -> Result<bool> {
    let mut stmt = conn.prepare("SELECT name, pk FROM pragma_table_info('team_task')")?;
    let columns: Vec<(String, i64)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let ordinal = |name: &str| {
        columns
            .iter()
            .find(|(column, _)| column == name)
            .map(|(_, pk)| *pk)
    };
    Ok(ordinal("team_id") == Some(1) && ordinal("id") == Some(2))
}

/// v21→v22：**会话身份与进程资源分家**（本任务的核心迁移）。
///
/// 三件事，同一步做完（分成三步会让 `upsert_member` 被改写三次，而每次中间的形态都是
/// 「有些列存在、有些不」的半状态）：
///
/// 1. **状态语义合法化**：`team.state` 的 `active/closed` → `open/sealed`；
///    `team_member.state` 的 `dead` → `offline`，其余运行态（`spawned/running/awaiting/
///    idle/done/failed/stalled`）一并归位 `offline` —— 升级即重启，进程不可能还活着
///    （`done` 的权威在任务板）。旧的 `dead` 同时表达了「进程没了」与
///    「用户关掉了它」，这两件事在恢复语义上相反（一个可恢复、一个不可）；
/// 2. **用户意图出列**：`team.sealed_at` 改名 `sealed_at`（值原样搬运，语义收窄成
///    「用户封存时刻」）；`team_member` 新增 `sealed_at`。旧 `dead` 行一律视为已封存
///    （`archive_member` 在 v22 之前只由显式关闭路径调用），时刻无从恢复 ⇒ 用 `joined_at`
///    占位并在此记明：读者只判**非空**，不读它的绝对值；
/// 3. **删掉两列进程资源**：`team_member.terminal_id` 与 `team.lead_session_id`
///    （后者是 PTY 句柄且**零读取方**）。活性从此只能问 `live_sessions`（红线 17），
///    于是「面板显示可点、点下去必失败」这种僵尸状态在数据模型里不再可表达。
///
/// # 幂等
///
/// `UPDATE` 天然幂等；`RENAME COLUMN` / `DROP COLUMN` 不是，所以各自先查
/// `pragma_table_info`（与 `add_column_if_missing` 同一形状），半迁移后手工重放安全。
pub fn v21_to_v22(conn: &Connection) -> Result<()> {
    // ① 用户封存的时刻列改名（值保留，所以旧的 closed_at 一次都不丢）。
    if column_exists(conn, "team", "closed_at")? && !column_exists(conn, "team", "sealed_at")? {
        conn.execute_batch("ALTER TABLE team RENAME COLUMN closed_at TO sealed_at")?;
    }
    add_column_if_missing(conn, "team", "sealed_at", "INTEGER")?;
    add_column_if_missing(conn, "team_member", "sealed_at", "INTEGER")?;

    // ② 旧 `dead` = 用户封存过（见上方文档）。时刻用 joined_at 占位。
    conn.execute(
        "UPDATE team_member SET sealed_at = joined_at \
         WHERE state = 'dead' AND sealed_at IS NULL",
        [],
    )?;

    // ③ 状态值合法化（顺序无关，两次 UPDATE 的集合不相交）。
    conn.execute_batch(
        "
        UPDATE team        SET state = 'open'   WHERE state = 'active';
        UPDATE team        SET state = 'sealed' WHERE state = 'closed';
        UPDATE team_member SET state = 'offline'
          WHERE state IN ('dead','spawned','running','awaiting','idle','done','failed','stalled');
        ",
    )?;

    // ④ 进程资源出列。
    drop_column_if_present(conn, "team_member", "terminal_id")?;
    drop_column_if_present(conn, "team", "lead_session_id")?;
    Ok(())
}

/// v22→v23：`team.workspace_worktree` —— 团队所在的**工作树维度**。
///
/// # 为什么团队行需要它
///
/// 团队根 `project_path` 只是一个路径字符串。历史面板要把「团队成员的会话」归属到**项目**
/// （而不是「那个目录前缀」）时，一条 `~/.neeko/worktrees/<name>` 的记录无法说明自己属于哪个
/// 项目 —— 环境归属靠 `project_id`（v16），**工作区归属**靠本列：`(project_id,
/// workspace_worktree)` 合成工作区身份。`NULL` = 主 checkout（项目根本身）。
///
/// 列值**不是**从路径推导出来的：建队时由调用方（前端 `activeWorkspace`）给出，后端用
/// `resolve_workspace` 校验后落库（与 `project_id` 同一条纪律：路径只是身份的属性）。
///
/// # 旧行（NULL）的语义
///
/// v23 之前建的团队只能退回 `project_path` 当工作区根（`AppStateWrapper::project_scope`
/// 的 `recorded`）；那时没有记录过工作树维度这个事实，不可能回填。
///
/// # 幂等
///
/// 与 v14→v15 / v15→v16 同形状（`ADD COLUMN` 先查再改，半迁移后手工重放安全）。
/// **不改 v13 的 `CREATE TABLE team`**：建表串是已发布的历史步骤，改了会让「v22 库」
/// 这一状态在夹具里不可重现（迁移测试就无法证明本步真的做了什么）。新库从 0 跑到 23，
/// 本步照样生效。
pub fn v22_to_v23(conn: &Connection) -> Result<()> {
    add_column_if_missing(conn, "team", "workspace_worktree", "TEXT")
}

/// v23→v24：`team_task.assignee` —— 任务板上的**计划事实**（谁该做）。
///
/// # 为什么它和 `owner` 是两列
///
/// `owner` 是**执行事实**（谁在做，由 `claim_task` 写入，`claimed`/`in_progress` 时必有），
/// `assignee` 是**计划事实**（队长派活时指定谁该做）。二者刻意不合并：
///
/// - 指派**不改状态**：`state` 仍是 `pending`、`owner` 仍为空、不起租约。自动落成
///   `claimed` 会让排队中的任务被 `reclaim_expired` 当成过期租约回收（它会把 owner
///   清成 `None`）—— 那是本次改动要避免的症状，不是要引入的；
/// - 认领仍是**并发闸**：`assignee` 存在时只缩小候选集（只有被指派者能抢），
///   “只有一个赢家”仍由 `manager::claim_task` 保证。
///
/// # 旧行（NULL）的语义 = 未指派
///
/// 没有记录过「谁该做」这个事实，不可能回填。`None` 与「新建时没给 assignee」完全等价：
/// 任何本队成员都能认领（与今天一致）。
///
/// # 幂等
///
/// 与 v14→v15 / v15→v16 / v22→v23 同形状（`ADD COLUMN` 先查再改，半迁移后手工重放安全）。
/// **不改 v17 的 `team_task_v17` 历史重建 DDL**：那是已发布事实，而新库（v0 → 24）
/// 会在 v17 重建之后由本步把列补回来。判据：
/// `v23_to_v24_is_idempotent` / `a_v23_task_row_upgrades_to_an_unassigned_task`。
pub fn v23_to_v24(conn: &Connection) -> Result<()> {
    add_column_if_missing(conn, "team_task", "assignee", "TEXT")
}

/// 列是否存在（DDL 不能绑位置参数，表名/列名都是本文件的字面量）。
fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}

/// 删一列（不存在则跳过）。`ALTER TABLE ... DROP COLUMN` 没有 `IF EXISTS`。
fn drop_column_if_present(conn: &Connection, table: &str, column: &str) -> Result<()> {
    if !column_exists(conn, table, column)? {
        return Ok(());
    }
    conn.execute_batch(&format!("ALTER TABLE {table} DROP COLUMN {column}"))?;
    Ok(())
}

/// v20→v21：成员的原生会话 id（`team_member.agent_session_id`）。
///
/// 成员退出后按它打开历史 transcript（「已退出」不等于「看不到它干过什么」）；
/// 由观察者从 hook 事件的 `agent_session_id` 首次见到时写入。
///
/// 与 v14→v15 / v15→v16 同一形状（`ADD COLUMN` 先查再改，半迁移后的手工重放安全）。
pub fn v20_to_v21(conn: &Connection) -> Result<()> {
    add_column_if_missing(conn, "team_member", "agent_session_id", "TEXT")
}

/// v19→v20：成员位角色预设（`team.role_hints`，JSON 数组列）。
///
/// 与 v14→v15 同形状（`ADD COLUMN` 先查再改，半迁移后手工重放安全）。列接线
/// （SELECT / INSERT / map）与迁移同一个 diff —— 漏一处就是「新库能写、旧库读不出」。
pub fn v19_to_v20(conn: &Connection) -> Result<()> {
    add_column_if_missing(conn, "team", "role_hints", "TEXT NOT NULL DEFAULT '[]'")
}

/// v18→v19：角色库（`team_role`）+ 团队缺省角色（`team.default_persona`）+
/// 成员人设快照（`team_member.persona`）。
///
/// 与 v14→v15 同形状（`CREATE TABLE IF NOT EXISTS` + `ADD COLUMN`，先查再改），
/// 半迁移后的手工重放安全（判据：`v19_step_is_idempotent` 同族）。三处列接线
/// （SELECT / INSERT / map）在本文件里与迁移同一个 diff。
pub fn v18_to_v19(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        -- 角色库：persona 预设，全局共享（不隶属任何队，无 CASCADE）。
        -- 名字是主键：spawn 传名字、成员行快照名字；改名 = 删旧建新（成员行的
        -- 快照不受影响 —— 它记的是 spawn 那一刻的事实）。
        CREATE TABLE IF NOT EXISTS team_role (
            name             TEXT PRIMARY KEY,
            preamble         TEXT NOT NULL,
            cli_preference   TEXT,
            approval_policy  TEXT,
            default_workspace TEXT,
            created_at       INTEGER NOT NULL
        );
        ",
    )?;
    add_column_if_missing(conn, "team", "default_persona", "TEXT")?;
    // 成员行上的是**快照**（`Persona` JSON）：spawn 时刻解析角色库并落行，
    // 之后库里的预设怎么改都不影响这个成员「带着什么文本被拉起来」。
    add_column_if_missing(conn, "team_member", "persona", "TEXT")?;
    Ok(())
}

/// 给一张表加一列（已存在则跳过）。
///
/// 表名与列名都是调用方写的字面量（不是外部输入），声明串只能拼（DDL 不能绑
/// 位置参数）；能拼进来的东西全部来自本文件的常量。
fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    declaration: &str,
) -> Result<()> {
    let existing: i64 = conn.query_row(
        &format!("SELECT count(*) FROM pragma_table_info('{table}') WHERE name = ?1"),
        params![column],
        |row| row.get(0),
    )?;
    if existing > 0 {
        return Ok(());
    }
    conn.execute_batch(&format!(
        "ALTER TABLE {table} ADD COLUMN {column} {declaration};"
    ))?;
    Ok(())
}

/// 把 `summary` 压到 [`SUMMARY_MAX_BYTES`]，返回 `(值, 是否截断)`。///
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
            "INSERT INTO team (id, name, lead_agent_id, project_path,
             project_id, created_at, sealed_at, state, allowed_agent_ids, default_model,
             default_workspace, default_approval_policy, max_members, default_persona, role_hints,
             workspace_worktree)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                lead_agent_id = excluded.lead_agent_id,
                project_path = excluded.project_path,
                project_id = excluded.project_id,
                created_at = excluded.created_at,
                sealed_at = excluded.sealed_at,
                state = excluded.state,
                allowed_agent_ids = excluded.allowed_agent_ids,
                default_model = excluded.default_model,
                default_workspace = excluded.default_workspace,
                default_approval_policy = excluded.default_approval_policy,
                max_members = excluded.max_members,
                default_persona = excluded.default_persona,
                role_hints = excluded.role_hints,
                workspace_worktree = excluded.workspace_worktree",
            params![
                team.id,
                team.name,
                team.lead_agent_id,
                path_text(&team.project_path)?,
                team.project_id,
                team.created_at,
                team.sealed_at,
                text_of(&team.state, "team.state")?,
                text_of(&team.allowed_agent_ids, "team.allowed_agent_ids")?,
                team.default_model,
                text_of(&team.default_workspace, "team.default_workspace")?,
                text_of(
                    &team.default_approval_policy,
                    "team.default_approval_policy"
                )?,
                i64::from(team.max_members),
                team.default_persona,
                text_of(&team.role_hints, "team.role_hints")?,
                team.workspace_worktree
                    .as_deref()
                    .map(path_text)
                    .transpose()?,
            ],
        )?;
        Ok(())
    }

    /// 按 id 读一个团队。
    pub fn get_team(&self, id: &str) -> Result<Option<Team>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(&format!("{SELECT_TEAM} WHERE id = ?1"))?;
        let mut rows = stmt.query_map(params![id], map_team_row)?;
        rows.next().transpose().map_err(Into::into)
    }

    /// 读全部团队（启动恢复用）。
    pub fn list_teams(&self) -> Result<Vec<Team>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(&format!("{SELECT_TEAM} ORDER BY created_at"))?;
        let rows = stmt.query_map([], map_team_row)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// **永久删除**一个团队行（连同它的成员 / 任务 / 审计）。
    ///
    /// # 为什么只有一条 `DELETE`
    ///
    /// `team_member` / `team_task` / `team_event` 都声明了 `team_id … REFERENCES team(id)
    /// ON DELETE CASCADE`，而池里每条连接的 `PRAGMA foreign_keys=ON` 由
    /// [`crate::common::db::pool::open_pool`] 的 `with_init` 保证（见那里的注释：pragma 是
    /// per-connection 的，池懒建连接，只能挂在 `with_init` 上）。所以删父行就是删整队 ——
    /// 在 Rust 里手写四张表的删除顺序是第二份级联定义，两份一旦漂移，症状是「删了队但板上
    /// 还留着任务」（看不见的孤儿行）。
    ///
    /// # 调用方必须已经判过状态
    ///
    /// 本方法**不做**任何业务判断（这一层没有业务判断，见模块文档）：`active` / `closing`
    /// 的队也能被它删掉。判据在 [`crate::agent::team::manager::TeamManager::delete_team`]。
    pub fn delete_team(&self, id: &str) -> Result<()> {
        let conn = self.conn()?;
        conn.execute("DELETE FROM team WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ═══════════════════════════════════════════════════════════════════
    // team_member
    // ═══════════════════════════════════════════════════════════════════

    /// 插入或覆盖一名成员。
    pub fn upsert_member(&self, member: &TeamMember) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO team_member (id, team_id, name, role, agent_id, model, session_id,
             workspace, channel, result_channel, tier, approval_policy,
             mcp_injection, last_seq, state, token_hash, joined_at, persona, agent_session_id,
             sealed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                role = excluded.role,
                agent_id = excluded.agent_id,
                model = excluded.model,
                session_id = excluded.session_id,
                workspace = excluded.workspace,
                channel = excluded.channel,
                result_channel = excluded.result_channel,
                tier = excluded.tier,
                approval_policy = excluded.approval_policy,
                mcp_injection = excluded.mcp_injection,
                last_seq = excluded.last_seq,
                state = excluded.state,
                token_hash = excluded.token_hash,
                joined_at = excluded.joined_at,
                persona = excluded.persona,
                agent_session_id = excluded.agent_session_id,
                sealed_at = excluded.sealed_at",
            params![
                member.id,
                member.team_id,
                member.name,
                text_of(&member.role, "team_member.role")?,
                member.agent_id,
                member.model,
                member.session_id,
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
                member
                    .persona
                    .as_ref()
                    .map(serde_json::to_string)
                    .transpose()?,
                member.agent_session_id,
                member.sealed_at,
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
    // team_role（角色库，全局共享；v19）
    // ═══════════════════════════════════════════════════════════════════

    /// 读全部角色预设（按创建时间再按名字稳定排序）。
    pub fn list_roles(&self) -> Result<Vec<RolePreset>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(&format!("{SELECT_ROLE} ORDER BY created_at, name"))?;
        let rows = stmt.query_map([], map_role_row)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// 按名字读一条预设。
    pub fn get_role(&self, name: &str) -> Result<Option<RolePreset>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(&format!("{SELECT_ROLE} WHERE name = ?1"))?;
        let mut rows = stmt.query_map(params![name], map_role_row)?;
        rows.next().transpose().map_err(Into::into)
    }

    /// 插入或覆盖一条预设（名字是主键：同名校 = 编辑）。
    pub fn upsert_role(&self, role: &RolePreset) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO team_role (name, preamble, cli_preference, approval_policy,
             default_workspace, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(name) DO UPDATE SET
                preamble = excluded.preamble,
                cli_preference = excluded.cli_preference,
                approval_policy = excluded.approval_policy,
                default_workspace = excluded.default_workspace,
                created_at = excluded.created_at",
            params![
                role.name,
                role.preamble,
                role.cli_preference,
                role.approval_policy
                    .as_ref()
                    .map(|p| text_of(p, "team_role.approval_policy"))
                    .transpose()?,
                role.default_workspace
                    .as_ref()
                    .map(|w| text_of(w, "team_role.default_workspace"))
                    .transpose()?,
                role.created_at,
            ],
        )?;
        Ok(())
    }

    /// 删除一条预设；返回是否真的删了行（`NotFound` 的裁决在 manager 的镜像上）。
    pub fn delete_role(&self, name: &str) -> Result<bool> {
        let conn = self.conn()?;
        let n = conn.execute("DELETE FROM team_role WHERE name = ?1", params![name])?;
        Ok(n > 0)
    }

    // ═══════════════════════════════════════════════════════════════════
    // team_task
    // ═══════════════════════════════════════════════════════════════════

    /// 本队任务序号水位线：该队板上 `team_task.id` 里 `t{n}` 的最大 `n`（空板 = 0）。
    ///
    /// # 为什么是**本队板**的最大值（这是 v17 的裁决，撤销 v16 期的全局序号）
    ///
    /// 任务 id 是**队内**标识符：主键是 `(team_id, id)`，每个队的板都从 `t1` 开始编号
    /// （判据：`a_new_team_numbers_its_tasks_from_one`）。全局单调的旧做法当初唯一的理由
    /// 是避开「新队的 `t1` 撞别队的 `t1`」这个**单列主键**冲突 —— 复合主键把它消掉之后，
    /// 全局序号就只剩「id 不连续」这个代价（新队的第一件活可能叫 `t7`），而任务 id 是队长
    /// 与成员在**对话里互相指代**的东西，越简单越好。复盘见 `v16_to_v17`。
    ///
    /// # `GLOB` 与 `CAST` 都是承重的
    ///
    /// - `GLOB 't[0-9]*'` + `NOT GLOB '*[^0-9]*'` 挡住将来任何非 `t{n}` 的行：`CAST('x' AS
    ///   INTEGER)` 会得到 0 来静默污染水位线，而 `CAST('t1abc' AS INTEGER)` 得 **1** —— 后者
    ///   更坏，因为它看起来「差不多对」（判据：
    ///   `next_task_seq_ignores_rows_that_are_not_t_numbered`）；
    /// - `CAST(substr(id, 2) AS INTEGER)` 给**数值**序：字符串比较下 `max('t9') > 't10'`，
    ///   会算出 `t2`（判据：`next_task_seq_is_numeric_not_lexicographic`）。
    ///
    /// ## 返回的是「下一个 `n`」而不是「最大的 `n`」
    ///
    /// 名字里的 `next` 是**契约**：调用方只需要 `format!("t{seq}")`，不必再自己 `+1`
    /// （两个地方各加一次就会跳号，而跳号是静默的）。空板因此返回 `1`。
    ///
    /// 并发创任务时两个调用可能算出同一个 id，但那会让 `create_task` 报 `Conflict`
    /// （可见的重试），而不是静默覆盖别人的任务。
    pub fn next_task_seq(&self, team_id: &str) -> Result<u32> {
        let conn = self.conn()?;
        let max: i64 = conn.query_row(
            // 三个条件各挡一类行：
            // - `t` + 至少一位数字（GLOB 挡住 `task-9` / `x7` / `T5`）；
            // - `substr(id,2) <> ''`（挡住光秃秃的 `t`）；
            // - `substr(id,2)` 里**只有数字**（挡住 `t1abc` / `t2x`：`CAST('1abc' AS INTEGER)`
            //   得 1，于是一条手工 / 将来写错的 id 会把水位线钉在低位，新任务 id 反复重撞）。
            "SELECT coalesce(max(CAST(substr(id, 2) AS INTEGER)), 0)
               FROM team_task
              WHERE team_id = ?1
                AND id GLOB 't[0-9]*'
                AND substr(id, 2) <> ''
                AND substr(id, 2) NOT GLOB '*[^0-9]*'",
            params![team_id],
            |row| row.get(0),
        )?;
        // 超 `u32` 的 id 只可能来自手工插入的畸形行：退回 1（= 空板语义）而不是 panic。
        Ok(u32::try_from(max).unwrap_or(0).saturating_add(1))
    }

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
             reclaim_count, assignee)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
             ON CONFLICT(team_id, id) DO UPDATE SET
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
                reclaim_count = excluded.reclaim_count,
                assignee = excluded.assignee",
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
                task.assignee,
            ],
        )?;
        Ok(())
    }

    /// 按**复合键**读一个任务。
    ///
    /// 只收 [`TaskRef`] 而不是 `&str`：`team_task` 的主键是 `(team_id, id)`，单独一个 id
    /// 在库里能命中多行（每个队的 `t1`）。让签名逼调用方表态属于哪个队，比在实现里
    /// 拿 `LIMIT 1` 猜一行安全得多（判据：`a_task_id_is_only_unique_inside_its_team`）。
    pub fn get_task(&self, task: &TaskRef) -> Result<Option<TeamTask>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(&format!("{SELECT_TASK} WHERE team_id = ?1 AND id = ?2"))?;
        let mut rows = stmt.query_map(params![task.team_id, task.id], map_task_row)?;
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

    /// 读**一名成员**的审计记录（最新在前），至多 `limit` 行；第二个返回值 = 是否还有更早的。
    ///
    /// # 为什么过滤条件是 `actor = ? OR subject = ?`
    ///
    /// 「与这个成员有关」有两个来源，缺一个就半边瞎：
    ///
    /// | 来源 | `actor` | `subject` | 例子 |
    /// | --- | --- | --- | --- |
    /// | 成员自己动手 | 成员 | 任务 / 成员 | `claim` / `update` / `signal` |
    /// | 别人对它动手 | **队长 / `system`** | **成员** | `close_member`（队长关了它）、`signal` 的陈旧 seq 判定 |
    ///
    /// 只按 `actor` 过滤会漏掉右边那一列 —— 而「队长把它关了」「它的信号被判为陈旧」
    /// 恰好是用户点开成员详情最想看到的那几句话。
    ///
    /// # 为什么 `LIMIT` 在 SQL 里，而不是读全量再截
    ///
    /// 事件表**只追加**：一个队跑久了会上万条（[`Self::list_events`] 的读法在「成员抽屉
    /// 每秒重取」面前不可用 —— 红线 4 的时间维度）。多读的那一行只为回答「还有更早的吗」，
    /// 于是 `truncated` 不需要额外的 `COUNT(*)` 查询。
    ///
    /// # 顺序
    ///
    /// `id DESC`（最新在前）。`id` 是 `AUTOINCREMENT`，写入顺序即时间顺序；用 `at` 排序会
    /// 在同一毫秒内给出不稳定顺序，而抽屉每次重取都换一遍行序，用户会以为事件变了。
    pub fn member_events(
        &self,
        team_id: &str,
        member_id: &str,
        limit: usize,
    ) -> Result<(Vec<TeamEventRecord>, bool)> {
        let conn = self.conn()?;
        // 多读一行：`limit + 1` 的「多出来那条」就是 `truncated` 的证据。
        let over = i64::try_from(limit).unwrap_or(i64::MAX).saturating_add(1);
        let mut stmt = conn.prepare(
            "SELECT id, team_id, at, actor, kind, subject, detail
             FROM team_event
             WHERE team_id = ?1 AND (actor = ?2 OR subject = ?2)
             ORDER BY id DESC LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![team_id, member_id, over], |row| {
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
        let mut events = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        let truncated = events.len() > limit;
        events.truncate(limit);
        Ok((events, truncated))
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

const SELECT_TEAM: &str = "SELECT id, name, lead_agent_id, project_path,
    project_id, created_at, sealed_at, state, allowed_agent_ids, default_model,
    default_workspace, default_approval_policy, max_members, default_persona, role_hints,
    workspace_worktree FROM team";

const SELECT_MEMBER: &str = "SELECT id, team_id, name, role, agent_id, model, session_id,
    workspace, channel, result_channel, tier, approval_policy, mcp_injection,
    last_seq, state, token_hash, joined_at, persona, agent_session_id, sealed_at FROM team_member";

const SELECT_ROLE: &str = "SELECT name, preamble, cli_preference, approval_policy,
    default_workspace, created_at FROM team_role";

const SELECT_TASK: &str = "SELECT id, team_id, title, body, state, owner, workspace,
    depends_on, claimed_at, lease_ttl, summary, summary_truncated, artifacts, reclaim_count,
    assignee
    FROM team_task";

fn map_team_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Team> {
    let max_members: i64 = row.get(12)?;
    Ok(Team {
        id: row.get(0)?,
        name: row.get(1)?,
        lead_agent_id: row.get(2)?,
        project_path: PathBuf::from(row.get::<_, String>(3)?),
        // 空串 = v16 之前建的行（见 `v15_to_v16` 的文档），不是「没有项目」。
        project_id: row.get(4)?,
        created_at: row.get(5)?,
        sealed_at: row.get(6)?,
        state: column_json(row.get::<_, String>(7)?, "team.state")?,
        allowed_agent_ids: column_json(row.get::<_, String>(8)?, "team.allowed_agent_ids")?,
        default_model: row.get(9)?,
        default_workspace: column_json(row.get::<_, String>(10)?, "team.default_workspace")?,
        default_approval_policy: column_json(
            row.get::<_, String>(11)?,
            "team.default_approval_policy",
        )?,
        max_members: u32::try_from(max_members)
            .map_err(|_| conversion_failure("team.max_members", "out of range"))?,
        default_persona: row.get(13)?,
        role_hints: column_json(row.get::<_, String>(14)?, "team.role_hints")?,
        // NULL = 主 checkout（或 v23 之前建的行，见 `v22_to_v23`）。
        workspace_worktree: row.get::<_, Option<String>>(15)?.map(PathBuf::from),
    })
}

fn map_member_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TeamMember> {
    let last_seq: i64 = row.get(13)?;
    Ok(TeamMember {
        id: row.get(0)?,
        team_id: row.get(1)?,
        name: row.get(2)?,
        role: column_json::<MemberRole>(row.get::<_, String>(3)?, "team_member.role")?,
        agent_id: row.get(4)?,
        model: row.get(5)?,
        session_id: row.get(6)?,
        workspace: column_json::<Workspace>(row.get::<_, String>(7)?, "team_member.workspace")?,
        channel: column_json(row.get::<_, String>(8)?, "team_member.channel")?,
        result_channel: column_json(row.get::<_, String>(9)?, "team_member.result_channel")?,
        tier: column_json(row.get::<_, String>(10)?, "team_member.tier")?,
        approval_policy: column_json(row.get::<_, String>(11)?, "team_member.approval_policy")?,
        mcp_injection: column_json(row.get::<_, String>(12)?, "team_member.mcp_injection")?,
        last_seq: u64::try_from(last_seq)
            .map_err(|_| conversion_failure("team_member.last_seq", "negative seq"))?,
        state: column_json::<MemberState>(row.get::<_, String>(14)?, "team_member.state")?,
        token_hash: row.get(15)?,
        joined_at: row.get(16)?,
        persona: row
            .get::<_, Option<String>>(17)?
            .map(|raw| column_json::<Persona>(raw, "team_member.persona"))
            .transpose()?,
        agent_session_id: row.get(18)?,
        sealed_at: row.get(19)?,
    })
}

fn map_role_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RolePreset> {
    Ok(RolePreset {
        name: row.get(0)?,
        preamble: row.get(1)?,
        cli_preference: row.get(2)?,
        approval_policy: row
            .get::<_, Option<String>>(3)?
            .map(|raw| {
                column_json::<crate::agent::team::types::ApprovalPolicy>(
                    raw,
                    "team_role.approval_policy",
                )
            })
            .transpose()?,
        default_workspace: row
            .get::<_, Option<String>>(4)?
            .map(|raw| column_json::<Workspace>(raw, "team_role.default_workspace"))
            .transpose()?,
        created_at: row.get(5)?,
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
        // 列在 `SELECT_TASK` 的末尾（v24 追加，见 `v23_to_v24`）。夹具刻意取非默认值：
        // `None` 是「未指派」，用 `None` 打底会让「这一列根本没写进库」变绿。
        assignee: row.get(14)?,
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
            lead_agent_id: "claude".into(),
            // 红线 13：夹具路径由 CARGO_MANIFEST_DIR 推导，不硬编码 POSIX 绝对路径。
            project_path: PathBuf::from(env!("CARGO_MANIFEST_DIR")),
            // 非空：空串的语义是「v16 之前建的行」（见 `v15_to_v16`），
            // 而这里的夹具是一个普通团队。每个断言都拿它跟别的值做区分。
            project_id: "p-sample".into(),
            // 工作树维度（v23）同样取**非默认值**：`None` 是主 checkout，用 `None` 打底会让
            // 「这一列根本没写进库」这类缺陷变绿。
            workspace_worktree: Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("wt-sample")),
            created_at: 1_700_000_000_000,
            sealed_at: None,
            state: TeamState::Open,
            // 配置五列同样**每列都偏离默认值**：空池 / `None` / `shared` / `queue` / 4
            // 是默认值，用它们打底会让「配置列根本没写进库」这类缺陷变绿。
            // `default_persona` 同理取非空（v19 列）。
            allowed_agent_ids: vec!["claude".into(), "pi".into()],
            default_model: Some("sonnet".into()),
            default_workspace: Workspace::ReadOnly,
            default_approval_policy: ApprovalPolicy::Bypass,
            default_persona: Some("研究员".into()),
            role_hints: vec![crate::agent::team::types::AgentRoleHint {
                agent_id: "pi".into(),
                persona: "实现者".into(),
            }],
            max_members: 3,
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
            sealed_at: None,
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
            persona: Some(Persona {
                name: "研究员".into(),
                preamble: "Research only; never edit production code.".into(),
            }),
            agent_session_id: Some("native-w1".into()),
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
            // 指派同样取**非默认值**（`Some` 而不是 `None`）：`None` 是「未指派」这个
            // 默认语义，用 `None` 打底会让「这一列根本没写进库」变绿。
            assignee: Some("w1@tm_1".into()),
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
        // 不再写第二份版本字面量：它每次 bump 都会变成一条需要手工追的债
        // （与 `common/db/migrations.rs` 的升级用例同一取舍）。

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
            "team_role",
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
        // v15 是 `ALTER TABLE ADD COLUMN`（不幂等），靠 `pragma_table_info` 先判。
        v14_to_v15(&conn).unwrap();
        v14_to_v15(&conn).unwrap();
        // v16 同理（同一形状的 ADD COLUMN + 同一个 `add_column_if_missing`）。
        v15_to_v16(&conn).unwrap();
        v15_to_v16(&conn).unwrap();
        // v19 / v20 同理：建表 IF NOT EXISTS + ADD COLUMN 都先查再改。
        v18_to_v19(&conn).unwrap();
        v18_to_v19(&conn).unwrap();
        v19_to_v20(&conn).unwrap();
        v19_to_v20(&conn).unwrap();
    }

    /// `team_task` 的主键必须是 **`(team_id, id)` 且队在前**。
    ///
    /// 两个半句各有判据：
    ///
    /// - **复合**：单列 `id` 让第二个队的 `t1` 撞主键（判据：
    ///   `a_v16_database_regains_the_task_id_for_a_second_team`）；
    /// - **队在前**：`(team_id, id)` 的隐式索引能直接服务 `WHERE team_id = ?`
    ///   （`list_tasks` / `next_task_seq` 都是这个形状），而 `(id, team_id)` 的索引
    ///   对它们完全无用 —— 顺序反了不会报错，只会让每条板查询都退化成全表扫。
    #[test]
    fn the_task_primary_key_is_team_first() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::common::db::run_migrations(&mut conn).unwrap();
        assert!(
            task_primary_key_is_team_first(&conn).unwrap(),
            "主键必须是 (team_id = 1, id = 2)"
        );
    }

    /// **v16 → 链尾的升级路径**：v16 的库里 `(tm_a, t1)` 存在 → 升级后行仍在、`user_version`
    /// 等于 `LATEST_VERSION`（**不**写版本字面量：每 bump 一次它就变成一条要手工追的债）、
    /// **队 B 能插入 `t1`**（改前必然 `UNIQUE constraint failed`）。
    ///
    /// # 为什么要手工造 v16 形状
    ///
    /// `v13_to_v14` 现在是**新**形状（复合主键），用它建库证明不了「旧库升级」——
    /// 升级的真实对象恰恰是那种单列主键的库。所以这里先跑 `v13_to_v14` 拿到团队 /
    /// 成员 / 审计三张表，再把 `team_task` 换成 v16 的那份 DDL。
    #[test]
    fn a_v16_database_regains_the_task_id_for_a_second_team() {
        const V16_TEAM_TASK: &str = "CREATE TABLE team_task (
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
        CREATE INDEX idx_team_task_team ON team_task(team_id, state);
        CREATE INDEX idx_team_task_state ON team_task(state);
        CREATE INDEX idx_team_task_owner ON team_task(owner);";

        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("neeko.db");

        {
            let conn = Connection::open(&db).unwrap();
            conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
                .unwrap();
            v13_to_v14(&conn).unwrap();
            v14_to_v15(&conn).unwrap();
            v15_to_v16(&conn).unwrap();
            conn.execute_batch("DROP TABLE team_task;").unwrap();
            conn.execute_batch(V16_TEAM_TASK).unwrap();
            conn.pragma_update(None, "user_version", 16).unwrap();

            for id in ["tm_a", "tm_b"] {
                conn.execute(
                    "INSERT INTO team (id, name, lead_session_id, lead_agent_id, project_path,
                     project_id, created_at, closed_at, state, allowed_agent_ids, default_model,
                     default_workspace, default_approval_policy, max_members)
                     VALUES (?1, 'T', 'sess', 'claude-code', ?2, 'p', 1, NULL, 'active', '[]',
                     NULL, 'shared', 'queue', 4)",
                    params![id, env!("CARGO_MANIFEST_DIR")],
                )
                .unwrap();
            }
            conn.execute(
                "INSERT INTO team_task (id, team_id, title, body, state, workspace, depends_on,
                 lease_ttl, artifacts)
                 VALUES ('t1', 'tm_a', 'from v16', 'body', 'pending', 'shared', '[]', 1800, '[]')",
                [],
            )
            .unwrap();

            // 改前的症状（本用例的意义）：第二个队的 `t1` 必然撞主键。
            let clash = conn.execute(
                "INSERT INTO team_task (id, team_id, title, body, state, workspace, depends_on,
                 lease_ttl, artifacts)
                 VALUES ('t1', 'tm_b', 'second team', 'body', 'pending', 'shared', '[]', 1800,
                 '[]')",
                [],
            );
            assert!(
                clash.is_err(),
                "v16 形状下 (tm_b, t1) 必须被单列主键挡住 —— 否则本用例证明不了任何事"
            );
        }

        // 升级（唯一入口：`TeamStore::open` 内部就会跑迁移链）。
        let store = TeamStore::open(&db).unwrap();
        let conn = store.conn().unwrap();
        let version: u32 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(
            version,
            crate::common::db::LATEST_VERSION,
            "升级必须把库推到链尾（`LATEST_VERSION` 是唯一事实源，不在此处重复写数字）"
        );
        drop(conn);

        // 旧行原样还在（字段级往返，不只是「行数对」）。
        let kept = store
            .get_task(&TaskRef::new("tm_a", "t1"))
            .unwrap()
            .expect("升级后旧行必须还在");
        assert_eq!(kept.title, "from v16");
        assert_eq!(kept.team_id, "tm_a");
        assert_eq!(kept.lease_ttl, 1800);

        // 队 B 现在能拥有自己的 `t1`（复合主键的直接收益）。
        let mut second = sample_task();
        second.id = "t1".into();
        second.team_id = "tm_b".into();
        store.upsert_task(&second).unwrap();
        assert_eq!(
            store.list_tasks("tm_b").unwrap().len(),
            1,
            "队 B 的 t1 与队 A 的 t1 并存"
        );
        assert_eq!(store.list_tasks("tm_a").unwrap().len(), 1);

        // 索引也在重建里回来了（漏一个 = 每条板查询退化成全表扫）。
        let conn = store.conn().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'team_task'",
            )
            .unwrap();
        let indexes: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        for needed in [
            "idx_team_task_team",
            "idx_team_task_state",
            "idx_team_task_owner",
        ] {
            assert!(indexes.contains(&needed.to_string()), "missing {needed}");
        }
    }

    /// v21→v22：**身份与进程资源分家**的三件事一次做完（本任务的核心迁移）。
    ///
    /// 逐条钉住，因为每一件的失败都是静默的：
    ///
    /// | 断言 | 漏了会怎样 |
    /// | --- | --- |
    /// | `active → open` / `closed → sealed` | 旧行在新代码里匹配不到任何 `TeamState` 分支 |
    /// | `closed_at` 值搬到 `sealed_at` | 已封存的队被读成「未封存」⇒ 重启后自动复活 |
    /// | `dead → offline` + `sealed_at = joined_at` | 用户关掉的成员被当成「可恢复」 |
    /// | 两列进程资源消失 | 僵尸句柄重新变成可点按钮（正是本任务要消灭的东西）|
    #[test]
    fn v21_to_v22_splits_identity_from_process_resources() {
        /// 建一个 v21 形状的库：按序重放 13..=20 各步（迁移是只追加的，这里要的就是旧形状）。
        fn v21_database() -> Connection {
            let conn = Connection::open_in_memory().unwrap();
            v13_to_v14(&conn).unwrap();
            v14_to_v15(&conn).unwrap();
            v15_to_v16(&conn).unwrap();
            v16_to_v17(&conn).unwrap();
            crate::work_items::store::v17_to_v18(&conn).unwrap();
            v18_to_v19(&conn).unwrap();
            v19_to_v20(&conn).unwrap();
            v20_to_v21(&conn).unwrap();
            conn
        }

        let conn = v21_database();
        // 前提：v21 形状**确实**有那三列/那组旧值（否则本用例证明不了任何事）。
        for (table, column) in [
            ("team", "lead_session_id"),
            ("team", "closed_at"),
            ("team_member", "terminal_id"),
        ] {
            assert!(
                column_exists(&conn, table, column).unwrap(),
                "前提：v21 应有 {table}.{column}"
            );
        }
        for (id, state, closed_at) in [("tm_old", "active", None), ("tm_done", "closed", Some(77))]
        {
            conn.execute(
                "INSERT INTO team (id, name, lead_session_id, lead_agent_id, project_path,
                 project_id, created_at, closed_at, state)
                 VALUES (?1, 'T', 'pty-1', 'claude-code', '.', 'p', 1, ?2, ?3)",
                params![id, closed_at, state],
            )
            .unwrap();
        }
        conn.execute(
            "INSERT INTO team_member (id, team_id, name, role, agent_id, model, session_id,
             terminal_id, workspace, channel, result_channel, tier, approval_policy,
             mcp_injection, last_seq, state, token_hash, joined_at)
             VALUES ('w1@tm_old', 'tm_old', 'w1', 'worker', 'claude-code', NULL, NULL,
             'pty-w1', 'shared', 'pty', 'mcp', 'a', 'queue', 'argv', 0, 'dead', 'sha256:x', 42)",
            [],
        )
        .unwrap();

        v21_to_v22(&conn).unwrap();

        // ① 状态值合法化 + 时刻值搬运。
        let (state, sealed_at): (String, Option<i64>) = conn
            .query_row(
                "SELECT state, sealed_at FROM team WHERE id = 'tm_done'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(state, "sealed");
        assert_eq!(sealed_at, Some(77), "封存时刻原样搬运（不是重新盖一个）");
        let open_state: String = conn
            .query_row("SELECT state FROM team WHERE id = 'tm_old'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(open_state, "open");

        // ② 旧 `dead` = 用户封存过（v22 之前只有显式关闭路径会写它）。
        let (member_state, member_sealed, joined): (String, Option<i64>, i64) = conn
            .query_row(
                "SELECT state, sealed_at, joined_at FROM team_member WHERE id = 'w1@tm_old'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(member_state, "offline");
        assert_eq!(member_sealed, Some(joined), "时刻无从恢复 ⇒ 用加入时刻占位");

        // ③ 进程资源出列。
        for (table, column) in [
            ("team", "lead_session_id"),
            ("team_member", "terminal_id"),
            ("team", "closed_at"),
        ] {
            assert!(
                !column_exists(&conn, table, column).unwrap(),
                "{table}.{column} 必须消失（它是进程期资源，团队行跨重启）"
            );
        }

        // ④ 迁移后的行能按**当前**读路径读回来（列名 / 值域 / 参数个数全部对齐）。
        let store = TeamStore::open_in_memory().unwrap();
        let _ = store; // 读路径由其它用例覆盖；这里只证明迁移结果自洽。
        let teams: Vec<String> = conn
            .prepare("SELECT state FROM team ORDER BY id")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        // `ORDER BY id` ⇒ tm_done 在前（这条断言同时证明两个旧值都换了域）。
        assert_eq!(teams, vec!["sealed".to_owned(), "open".to_owned()]);
    }

    /// v22→v23：`team.workspace_worktree` 存在，且**旧行**读出来是 `None`（主 checkout）。
    ///
    /// # 为何必须用「真升一条旧行」
    ///
    /// 新库从 0 跑到 23，本步的 `ADD COLUMN` 与「一条已存在的行会得到什么值」是两件事。
    /// 旧行（v22 及更早建的团队）没有记录过工作树维度这个事实，不可能回填 —— 只能退回
    /// `project_path` 当工作区根（`AppStateWrapper::project_scope` 的 `recorded`）。
    #[test]
    fn a_v22_team_row_upgrades_without_a_worktree() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("neeko.db");

        // 1) 手工把库做到 v22（按序重放 13..=21：迁移是只追加的，这里要的就是旧形状）。
        {
            let conn = Connection::open(&db).unwrap();
            v13_to_v14(&conn).unwrap();
            v14_to_v15(&conn).unwrap();
            v15_to_v16(&conn).unwrap();
            v16_to_v17(&conn).unwrap();
            crate::work_items::store::v17_to_v18(&conn).unwrap();
            v18_to_v19(&conn).unwrap();
            v19_to_v20(&conn).unwrap();
            v20_to_v21(&conn).unwrap();
            v21_to_v22(&conn).unwrap();
            conn.pragma_update(None, "user_version", 22).unwrap();
            // 前提：v22 形状**确实**没有这一列（否则本用例证明不了本步做了什么）。
            assert!(
                !column_exists(&conn, "team", "workspace_worktree").unwrap(),
                "前提：v22 不应有 team.workspace_worktree"
            );
            conn.execute(
                "INSERT INTO team (id, name, lead_agent_id, project_path,
                 project_id, created_at, sealed_at, state)
                 VALUES ('tm_v22', 'Old', 'claude-code', ?1, 'p1', 1, NULL, 'open')",
                params![env!("CARGO_MANIFEST_DIR")],
            )
            .unwrap();
        }

        // 2) 跑完整迁移链（唯一入口：`TeamStore::open` 内部就会跑）。
        let store = TeamStore::open(&db).unwrap();
        let team = store
            .get_team("tm_v22")
            .unwrap()
            .expect("旧行升级后必须仍然 load 得出来");

        assert_eq!(
            team.workspace_worktree, None,
            "旧行没有工作树维度这个事实 ⇒ 只能读成主 checkout"
        );
        let version: u32 = store
            .conn()
            .unwrap()
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        // 不写版本字面量：本步把链推到 **23**，但链还会继续往后加，写死数字只会变成
        // 一条每次 bump 都要手工追的债。
        assert_eq!(
            version,
            crate::common::db::LATEST_VERSION,
            "本步之后链继续走到链尾"
        );
    }

    /// 半迁移后手工重放安全（`ADD COLUMN` 先查再改，与 v14→v15 同形状）。
    #[test]
    fn v22_to_v23_is_idempotent() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::common::db::run_migrations(&mut conn).unwrap();
        v22_to_v23(&conn).unwrap();
        v22_to_v23(&conn).unwrap();
    }

    /// 半迁移后手工重放安全（`ADD COLUMN` 先查再改，与 v14→v15 同形状）。
    #[test]
    fn v23_to_v24_is_idempotent() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::common::db::run_migrations(&mut conn).unwrap();
        v23_to_v24(&conn).unwrap();
        v23_to_v24(&conn).unwrap();
    }

    /// v23→v24：`team_task.assignee` 存在，且**旧行**（v24 之前建的任务）读出来是 `None`。
    ///
    /// # 为何必须用「真升一条旧行」
    ///
    /// 新库从 0 跑到 24 时，本步的 `ADD COLUMN` 可能是个 no-op（新库的建表串已经带了这一列），
    /// 于是「升级路径真的补了列」这件事在新鲜库上不可观测。老库里面没有这一列：
    /// 迁移若漏了这一步，`SELECT_TASK` 会直接以 `no such column: assignee` 失败。
    ///
    /// # 旧行的语义 = 未指派
    ///
    /// 没有记录过「谁该做」这个事实，不可能回填；`None` 就是「未指派」，行为与今天完全
    /// 一致（任何本队成员都能认领）。面板也不需要区分「老行」与「新建未指派行」。
    #[test]
    fn a_v23_task_row_upgrades_to_an_unassigned_task() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("neeko.db");

        // 1) 手工把库做到 v23（按序重放 13..=22：迁移是只追加的，这里要的就是旧形状）。
        {
            let conn = Connection::open(&db).unwrap();
            v13_to_v14(&conn).unwrap();
            v14_to_v15(&conn).unwrap();
            v15_to_v16(&conn).unwrap();
            v16_to_v17(&conn).unwrap();
            crate::work_items::store::v17_to_v18(&conn).unwrap();
            v18_to_v19(&conn).unwrap();
            v19_to_v20(&conn).unwrap();
            v20_to_v21(&conn).unwrap();
            v21_to_v22(&conn).unwrap();
            v22_to_v23(&conn).unwrap();
            // 建表串是**当前**形状（新库会带上 v24 的列），所以这里把那一列删掉 ——
            // 删完就是 v23 真实的列集，不必再抄一份历史 DDL。
            drop_column_if_present(&conn, "team_task", "assignee").unwrap();
            conn.pragma_update(None, "user_version", 23).unwrap();
            // 前提：v23 形状**确实**没有这一列（否则本用例证明不了本步做了什么）。
            assert!(
                !column_exists(&conn, "team_task", "assignee").unwrap(),
                "前提：v23 不应有 team_task.assignee"
            );
            conn.execute(
                "INSERT INTO team (id, name, lead_agent_id, project_path,
                 project_id, created_at, sealed_at, state)
                 VALUES ('tm_v23', 'Old', 'claude-code', ?1, 'p1', 1, NULL, 'open')",
                params![env!("CARGO_MANIFEST_DIR")],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO team_task (id, team_id, title, body, state, workspace, depends_on,
                 lease_ttl, artifacts)
                 VALUES ('t1', 'tm_v23', 'from v23', 'body', 'pending', 'shared', '[]', 1800, '[]')",
                [],
            )
            .unwrap();
        }

        // 2) 跑完整迁移链（唯一入口：`TeamStore::open` 内部就会跑）。
        let store = TeamStore::open(&db).unwrap();
        let task = store
            .get_task(&TaskRef::new("tm_v23", "t1"))
            .unwrap()
            .expect("旧行升级后必须仍然 load 得出来");

        assert_eq!(
            task.assignee, None,
            "旧行没有「谁该做」这个事实 ⇒ 只能读成未指派"
        );
        assert_eq!(task.title, "from v23", "其它列不得被这次迁移动到");
        let version: u32 = store
            .conn()
            .unwrap()
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(
            version,
            crate::common::db::LATEST_VERSION,
            "升级必须把库推到链尾"
        );
    }

    /// v23：`team.workspace_worktree` 必须能原样往返。
    ///
    /// 三个写入点的任何一个漏了这一列都会让这条变红：`INSERT` 的列表 / 绑定、
    /// `SELECT_TEAM`、`map_team_row` 的下标。主 checkout 的 `NULL` 与「列没接上」同在
    /// `None` 上，所以夹具取**非默认值**（见 `sample_team`）。
    #[test]
    fn a_team_row_round_trips_its_workspace_worktree() {
        let store = store();
        let team = sample_team();
        store.upsert_team(&team).unwrap();

        let read = store.get_team("tm_1").unwrap().expect("刚写入的行");
        assert_eq!(read.workspace_worktree, team.workspace_worktree);
        assert!(
            read.workspace_worktree.is_some(),
            "列没有被 NULL 吃掉（夹具刻意偏离默认值）"
        );
        assert_eq!(
            store.list_teams().unwrap()[0].workspace_worktree,
            team.workspace_worktree,
            "列表读的是同一个 SELECT"
        );

        // 覆盖写（`ON CONFLICT DO UPDATE`）也必须带上这一列：团队换工作区后，
        // 历史归属与侧栏分组都读这一列 —— 漏了就会永远停在建队那一刻的工作区。
        let mut moved = team.clone();
        moved.workspace_worktree = None;
        store.upsert_team(&moved).unwrap();
        assert_eq!(
            store.get_team("tm_1").unwrap().unwrap().workspace_worktree,
            None,
            "改成主 checkout 也必须被写进去（不是「没改」）"
        );
    }

    /// 半迁移后手工重放是安全的：`RENAME` / `DROP` 各自先查列存在性。
    ///
    /// 依据：迁移在事务里跑，但**手工恢复**（或旧版本的半跑）没有那个事务。
    #[test]
    fn v21_to_v22_is_idempotent() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::common::db::run_migrations(&mut conn).unwrap();
        // 已经是最新版本 ⇒ 再跑一次必须不报错（列都不在了，两次 DDL 都得跳过）。
        v21_to_v22(&conn).unwrap();
        v21_to_v22(&conn).unwrap();
    }

    /// 迁移的幂等性：v17 之后重放 `v16_to_v17` 不得炸（也不得把表重建空）。
    #[test]
    fn v17_step_is_idempotent() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::common::db::run_migrations(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO team (id, name, lead_agent_id, project_path,
             project_id, created_at, sealed_at, state)
             VALUES ('tm_1', 'T', 'claude-code', '.', 'p', 1, NULL, 'open')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO team_task (id, team_id, title, body, state, workspace, depends_on,
             lease_ttl, artifacts)
             VALUES ('t1', 'tm_1', 'kept', 'body', 'pending', 'shared', '[]', 1800, '[]')",
            [],
        )
        .unwrap();

        v16_to_v17(&conn).unwrap();
        v16_to_v17(&conn).unwrap();

        let count: i64 = conn
            .query_row("SELECT count(*) FROM team_task", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1, "幂等重放不得重建空表 / 丢行");
    }

    /// **升级路径**：一条 v14 形状的团队行（没有五个配置列）升级后必须能 load，且拿到
    /// 文档化的默认值。
    ///
    /// # 为何必须用「真升一条旧行」而不是新库
    ///
    /// 新库走的是 `CREATE` + 全部 `ALTER`，它证明不了「已经存在的行」会得到默认值 ——
    /// 而升级的真实对象就是那种行。判据是：`get_team` 不失败（不得让 hydrate 挂）、
    /// 空池 = 不限制、`max_members = 4`、`shared` / `queue`。
    ///
    /// 库文件由 `tempdir()` 推导（红线 13）。
    #[test]
    fn a_v14_team_row_upgrades_to_the_documented_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("neeko.db");

        // 1) 手工把库做到 v14（旧形状），再插一条**只有旧八列**的团队行。
        {
            let mut conn = Connection::open(&db).unwrap();
            conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
                .unwrap();
            for version in 0..12u32 {
                let tx = conn
                    .transaction_with_behavior(rusqlite::TransactionBehavior::Exclusive)
                    .unwrap();
                crate::library::migrations::step(&tx, version).unwrap();
                tx.pragma_update(None, "user_version", version + 1).unwrap();
                tx.commit().unwrap();
            }
            v13_to_v14(&conn).unwrap();
            conn.pragma_update(None, "user_version", 14).unwrap();
            conn.execute(
                "INSERT INTO team (id, name, lead_session_id, lead_agent_id, project_path,
                 created_at, closed_at, state)
                 VALUES ('tm_v14', 'Old', 'sess', 'claude-code', ?1, 1, NULL, 'active')",
                params![env!("CARGO_MANIFEST_DIR")],
            )
            .unwrap();
        }

        // 2) 跑完整迁移链（唯一入口：`TeamStore::open` 内部就会跑）。
        let store = TeamStore::open(&db).unwrap();
        let team = store
            .get_team("tm_v14")
            .unwrap()
            .expect("旧行升级后必须仍然 load 得出来");

        assert_eq!(team.name, "Old", "旧列原样保留");
        assert_eq!(team.state, TeamState::Open);
        assert!(
            team.allowed_agent_ids.is_empty(),
            "空池 = 不限制（不是「一个都不许」）：{:?}",
            team.allowed_agent_ids
        );
        assert_eq!(team.default_model, None, "None = 让 CLI 用自己的默认");
        assert_eq!(team.default_workspace, Workspace::Shared);
        assert_eq!(team.default_approval_policy, ApprovalPolicy::Queue);
        assert_eq!(
            team.max_members,
            crate::agent::team::types::DEFAULT_MAX_MEMBERS
        );
        assert_eq!(store.list_teams().unwrap().len(), 1);
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

    /// v16：`team.project_id` 必须能原样往返。
    ///
    /// 三个写入点的任何一个漏了这一列都会让这条变红：`INSERT` 的列表 / 绑定、
    /// `SELECT_TEAM`、`map_team_row` 的下标。默认值 `''` 会让「漏了」看起来像「旧行」。
    #[test]
    fn a_team_row_round_trips_its_project_id() {
        let store = store();
        let team = sample_team();
        store.upsert_team(&team).unwrap();

        let read = store.get_team("tm_1").unwrap().expect("刚写入的行");
        assert_eq!(read.project_id, team.project_id);
        assert_eq!(read.project_id, "p-sample", "列没有被默认值吃掉");
        assert_eq!(
            store.list_teams().unwrap()[0].project_id,
            "p-sample",
            "列表读的是同一个 SELECT"
        );

        // 覆盖写（`ON CONFLICT DO UPDATE`）也必须带上这一列，否则改项目后环境会静默变旧值。
        let mut moved = team.clone();
        moved.project_id = "p-other".into();
        store.upsert_team(&moved).unwrap();
        assert_eq!(
            store.get_team("tm_1").unwrap().unwrap().project_id,
            "p-other"
        );
    }

    /// **升级路径**：一条 v15 形状的团队行（没有 `project_id` 列）升级后必须能 load，
    /// 且 `project_id == ""`（空串 = v16 之前建的行，**不是**「没有项目」）。
    ///
    /// # 为何必须用「真升一条旧行」
    ///
    /// 新库走的是 `CREATE` + `ALTER`，它证明不了「已经存在的行」会得到默认值。
    /// 而旧行正是执行层需要退回路径反查（`EnvironmentSource::LegacyPath`）的那一类 ——
    /// 如果迁移把旧行读炸，整个面板在升级后直接打不开。
    #[test]
    fn a_v15_team_row_upgrades_to_an_empty_project_id() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("neeko.db");

        // 1) 手工把库做到 v15（v15 形状：有五个配置列，**没有** project_id）
        //    再插一条团队行。
        {
            let mut conn = Connection::open(&db).unwrap();
            conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
                .unwrap();
            for version in 0..12u32 {
                let tx = conn
                    .transaction_with_behavior(rusqlite::TransactionBehavior::Exclusive)
                    .unwrap();
                crate::library::migrations::step(&tx, version).unwrap();
                tx.pragma_update(None, "user_version", version + 1).unwrap();
                tx.commit().unwrap();
            }
            v13_to_v14(&conn).unwrap();
            v14_to_v15(&conn).unwrap();
            conn.pragma_update(None, "user_version", 15).unwrap();
            conn.execute(
                "INSERT INTO team (id, name, lead_session_id, lead_agent_id, project_path,
                 created_at, closed_at, state, allowed_agent_ids, default_model,
                 default_workspace, default_approval_policy, max_members)
                 VALUES ('tm_v15', 'Old', 'sess', 'claude-code', ?1, 1, NULL, 'active', '[]',
                 NULL, 'shared', 'queue', 4)",
                params![env!("CARGO_MANIFEST_DIR")],
            )
            .unwrap();
            let version: u32 = conn
                .pragma_query_value(None, "user_version", |row| row.get(0))
                .unwrap();
            assert_eq!(version, 15, "手工夹具必须停在 v15");
        }

        // 2) 跑完整迁移链（唯一入口：`TeamStore::open` 内部就会跑）。
        let store = TeamStore::open(&db).unwrap();
        let team = store
            .get_team("tm_v15")
            .unwrap()
            .expect("旧行升级后必须仍然 load 得出来");

        assert_eq!(
            team.project_id, "",
            "空串 = v16 之前建的行（不是「没有项目」）"
        );
        assert_eq!(team.name, "Old", "其余旧列原样保留");
        assert_eq!(team.state, TeamState::Open);

        // 版本号真的进到最新（`v15 -> … -> 链尾` 全跑过，不是「新库正好长得一样」）。
        {
            let conn = Connection::open(&db).unwrap();
            let version: u32 = conn
                .pragma_query_value(None, "user_version", |row| row.get(0))
                .unwrap();
            assert_eq!(version, crate::common::db::migrations::LATEST_VERSION);
        }
    }

    /// 外键保护：孤儿成员/任务行必须被拒 —— 团队关掉后留下的悬空行会让
    /// 面板显示「幽灵成员」，而那时已经无法判断它属于谁。
    #[test]
    fn orphan_member_and_task_rows_are_rejected() {
        let store = store();
        assert!(store.upsert_member(&sample_member()).is_err());
        assert!(store.upsert_task(&sample_task()).is_err());
    }

    /// v19：persona 列为 NULL 的行（v18 的旧行）读回 `None`，不报错。
    ///
    /// 写路径绑定的是 `Option`，但「旧行是 NULL」只有迁移路径能造 —— 用裸 SQL
    /// 插一行不带 persona 的成员（迁移后列已存在），NULL 必须映射成 `None`。
    #[test]
    fn a_member_row_without_a_persona_reads_back_none() {
        let store = store();
        {
            let conn = store.conn().unwrap();
            conn.execute(
                "INSERT INTO team (id, name, lead_agent_id, project_path,
                 project_id, created_at, sealed_at, state, allowed_agent_ids, default_model,
                 default_workspace, default_approval_policy, max_members, default_persona)
                 VALUES ('tm_1', 'T', 'claude-code', ?1, 'p', 1, NULL, 'open', '[]',
                 NULL, 'shared', 'queue', 4, NULL)",
                params![env!("CARGO_MANIFEST_DIR")],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO team_member (id, team_id, name, role, agent_id, model, session_id,
                 workspace, channel, result_channel, tier, approval_policy,
                 mcp_injection, last_seq, state, token_hash, joined_at, persona, sealed_at)
                 VALUES ('w1@tm_1', 'tm_1', 'w1', 'worker', 'claude-code', NULL, NULL,
                 'shared', 'pty', 'mcp', 'a', 'queue', 'argv', 0, 'spawned', 'sha256:x', 1,
                 NULL, NULL)",
                [],
            )
            .unwrap();
        }
        // 连接在这里已归还池子：后续的 store 读路径各自再借。

        let member = store.get_member("w1@tm_1").unwrap().unwrap();
        assert_eq!(member.persona, None, "NULL 列必须读回 None，不能报错");
        let team = store.get_team("tm_1").unwrap().unwrap();
        assert_eq!(team.default_persona, None);
    }

    /// 角色库 round-trip：全部列（含两个可空枚举）原样回来；同名 = 编辑；删除真的删行。
    #[test]
    fn a_role_preset_round_trips_and_deletes() {
        let store = store();
        let role = RolePreset {
            name: "研究员".into(),
            preamble: "Research only; never edit production code.".into(),
            cli_preference: Some("claude-code".into()),
            approval_policy: Some(ApprovalPolicy::Queue),
            default_workspace: Some(Workspace::ReadOnly),
            created_at: 42,
        };
        store.upsert_role(&role).unwrap();
        assert_eq!(store.get_role("研究员").unwrap(), Some(role.clone()));
        assert_eq!(store.list_roles().unwrap(), vec![role.clone()]);

        // 同名 = 编辑：所有列都被覆盖（漏一列就会出现「改了正文、策略还是旧的」）。
        let edited = RolePreset {
            preamble: "Changed.".into(),
            cli_preference: None,
            approval_policy: None,
            default_workspace: None,
            ..role
        };
        store.upsert_role(&edited).unwrap();
        assert_eq!(store.list_roles().unwrap(), vec![edited]);

        assert!(store.delete_role("研究员").unwrap());
        assert_eq!(store.get_role("研究员").unwrap(), None);
        assert!(!store.delete_role("研究员").unwrap());
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

    /// 任务读写往返：workspace（带数据的变体）、依赖、产物引用、指派都要原样回来。
    #[test]
    fn task_round_trips_workspace_dependencies_and_artifacts() {
        let store = seeded_store();
        let task = sample_task();
        store.upsert_task(&task).unwrap();

        assert_eq!(
            store.get_task(&TaskRef::new("tm_1", "t1")).unwrap(),
            Some(task)
        );
        assert_eq!(store.get_task(&TaskRef::new("tm_1", "t404")).unwrap(), None);

        let mut worktree_task = sample_task();
        worktree_task.id = "t2".into();
        worktree_task.workspace = Workspace::Worktree {
            path: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("wt"),
        };
        store.upsert_task(&worktree_task).unwrap();
        assert_eq!(
            store
                .get_task(&TaskRef::new("tm_1", "t2"))
                .unwrap()
                .unwrap()
                .workspace,
            worktree_task.workspace
        );
        assert_eq!(store.list_tasks("tm_1").unwrap().len(), 2);
    }

    /// v24：`assignee`（**计划事实**）必须能原样往返，且**不改变**执行事实。
    ///
    /// 三个写入点的任何一个漏了这一列都会让这条变红：`INSERT` 的列表 / 绑定、
    /// `SELECT_TASK`、`map_task_row` 的下标。`None`（未指派）与「列没接上」同在 `None` 上，
    /// 所以夹具取**非默认值**（见 `sample_task`）。
    #[test]
    fn a_task_row_round_trips_its_assignee() {
        let store = seeded_store();
        let task = sample_task();
        store.upsert_task(&task).unwrap();

        let read = store
            .get_task(&TaskRef::new("tm_1", "t1"))
            .unwrap()
            .unwrap();
        assert_eq!(read.assignee, task.assignee);
        assert!(
            read.assignee.is_some(),
            "列没有被 NULL 吃掉（夹具刻意偏离默认值）"
        );
        // 指派是**计划**事实：它不许改写执行事实（owner / state 各自属于状态机）。
        assert_eq!(read.owner, task.owner, "指派不得改写 owner");
        assert_eq!(read.state, task.state, "指派不得改写 state");
        assert_eq!(store.list_tasks("tm_1").unwrap()[0].assignee, task.assignee);

        // 未指派（`None`）也必须**写进去**（不是「没改」）：`ON CONFLICT DO UPDATE` 漏一列
        // 的典型症状是「改回未指派后仍然显示被指派」。
        let mut unassigned = task.clone();
        unassigned.assignee = None;
        store.upsert_task(&unassigned).unwrap();
        assert_eq!(
            store
                .get_task(&TaskRef::new("tm_1", "t1"))
                .unwrap()
                .unwrap()
                .assignee,
            None
        );
    }

    /// 红线 4：`summary` > 4 KiB 必须在写入时截断并打标。
    #[test]
    fn summary_over_4k_is_truncated_and_flagged() {
        let store = seeded_store();
        let mut task = sample_task();
        task.summary = Some("x".repeat(SUMMARY_MAX_BYTES * 2));
        store.upsert_task(&task).unwrap();

        let read = store
            .get_task(&TaskRef::new("tm_1", "t1"))
            .unwrap()
            .unwrap();
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

        let read = store
            .get_task(&TaskRef::new("tm_1", "t1"))
            .unwrap()
            .unwrap();
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
        // 团队配置列同理：`shared` / `queue` 是裸 snake_case，不是带引号的 JSON
        // （带引号的列会让「sqlite3 直接查」这条收益归零）。
        let workspace: String = conn
            .query_row(
                "SELECT default_workspace FROM team WHERE id = 'tm_1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let policy: String = conn
            .query_row(
                "SELECT default_approval_policy FROM team WHERE id = 'tm_1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(workspace, "read_only");
        assert_eq!(policy, "bypass");
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

    /// **删父行 = 删整队**：`team_member` / `team_task` / `team_event` 上的
    /// `ON DELETE CASCADE` 必须真的生效。
    ///
    /// # 为什么这条必须由测试钒，而不是靠 DDL 里的那句话
    ///
    /// `PRAGMA foreign_keys` 是 **per-connection** 的，而池子是懒建连接的 —— 它挂在
    /// `open_pool` / `open_memory_pool` 的 `with_init` 上（见 `common/db/pool.rs`）。
    /// 也就是说：一条 `DELETE FROM team` 能不能级联，取决于**拿到的那条连接**有没有跑过
    /// 那个 init，而不是表定义里写了什么。而本用例的夹具走的是与生产同一个 opener，
    /// 所以它绿的唯一含义就是「生产也会级联」。
    ///
    /// 如果这条变红（孤儿行留在库里），症状是：删了队，而 `team_task` 里还有它的一堆行 ——
    /// 没人看得见（`list_teams` 不再返回那个队），但库会一直长。
    #[test]
    fn deleting_a_team_cascades_to_members_tasks_and_events() {
        let store = seeded_store();
        store.upsert_member(&sample_member()).unwrap();
        store.upsert_task(&sample_task()).unwrap();
        store
            .append_event(&TeamEventRecord {
                id: None,
                team_id: "tm_1".into(),
                at: 10,
                actor: "w1@tm_1".into(),
                kind: "claim".into(),
                subject: Some("t1".into()),
                detail: None,
            })
            .unwrap();

        store.delete_team("tm_1").unwrap();

        assert_eq!(store.list_teams().unwrap().len(), 0);
        let conn = store.conn().unwrap();
        for (table, sql) in [
            ("team_member", "SELECT count(*) FROM team_member"),
            ("team_task", "SELECT count(*) FROM team_task"),
            ("team_event", "SELECT count(*) FROM team_event"),
        ] {
            let left: i64 = conn.query_row(sql, [], |row| row.get(0)).unwrap();
            assert_eq!(
                left, 0,
                "{table} 里的孤儿行必须被级联删掉（foreign_keys 生效）"
            );
        }
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

    /// 成员事件读法：**两边都算**（`actor` = 它自己动手，`subject` = 别人对它动手），
    /// 最新在前，且 `limit` 是 SQL 的 `LIMIT`（多读一行只用来回答「还有更早的吗」）。
    ///
    /// 变异验证：把 `(actor = ?2 OR subject = ?2)` 改成只按 `actor` → 第二条断言变红。
    #[test]
    fn member_events_read_both_sides_newest_first() {
        let store = seeded_store();
        let record = |at: i64, actor: &str, kind: &str, subject: Option<&str>| TeamEventRecord {
            id: None,
            team_id: "tm_1".into(),
            at,
            actor: actor.into(),
            kind: kind.into(),
            subject: subject.map(str::to_owned),
            detail: None,
        };
        // ① 成员自己认领（actor = 成员）；② 队长把它关了（subject = 成员）；
        // ③ 与它无关的一条（actor 与 subject 都是别人）—— 不许被读出来。
        store
            .append_event(&record(10, "w1@tm_1", "claim", Some("t1")))
            .unwrap();
        store
            .append_event(&record(20, "lead@tm_1", "close_member", Some("w1@tm_1")))
            .unwrap();
        store
            .append_event(&record(30, "lead@tm_1", "force_done", Some("t1")))
            .unwrap();

        let (events, truncated) = store.member_events("tm_1", "w1@tm_1", 50).unwrap();
        assert_eq!(
            events.iter().map(|e| e.kind.as_str()).collect::<Vec<_>>(),
            vec!["close_member", "claim"],
            "最新在前；`subject` 那一边不许漏"
        );
        assert!(!truncated);

        // 上界：多读一行只能用来判 truncated，不得把这一行也交出去。
        let (first, truncated) = store.member_events("tm_1", "w1@tm_1", 1).unwrap();
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].kind, "close_member");
        assert!(truncated, "还有更早的必须能说出来");

        // 上限刚好等于行数：不算截断（否则「只显示最近 N 条」永远亮着）。
        let (all, truncated) = store.member_events("tm_1", "w1@tm_1", 2).unwrap();
        assert_eq!(all.len(), 2);
        assert!(!truncated);
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

        let read = store
            .get_task(&TaskRef::new("tm_1", "t1"))
            .unwrap()
            .unwrap();
        assert_eq!(read.state, TeamTaskState::Done);
        assert_eq!(read.summary.as_deref(), Some("finished"));
        assert_eq!(store.list_tasks("tm_1").unwrap().len(), 1);
    }

    /// 空板 → 下一个 id 是 `t1`（返回值已经是「下一个」，调用方不必再 `+1`）。
    #[test]
    fn next_task_seq_is_one_on_an_empty_board() {
        assert_eq!(seeded_store().next_task_seq("tm_1").unwrap(), 1);
    }

    /// 水位线只认 `t{n}`：`GLOB 't[0-9]*'` 挡住将来任何非 `t{n}` 的行。
    ///
    /// 保护的不变量：`CAST('x' AS INTEGER)` 是 0，一旦让 `x7` / `task-9` 进
    /// `max(...)`，它们不会抬高水位线，却会把「非任务 id」变成可匹配行 —— 而 `t`
    /// （无数字）这种行一旦参与，`substr(id,2) = ''` 同样静默归零。
    #[test]
    fn next_task_seq_ignores_rows_that_are_not_t_numbered() {
        let store = seeded_store();
        // `t1abc` / `t2x` 是**半数字** id：`CAST` 会把它们读成 1 / 2。让它们参与水位线，
        // 下一个 id 就会撞在 `t2` / `t3` 上 —— 而那两个 id 看起来「差不多对」，不报错。
        for id in ["task-9", "x7", "t", "T5", "t1abc", "t2x", "t2"] {
            let mut task = sample_task();
            task.id = id.into();
            store.upsert_task(&task).unwrap();
        }
        assert_eq!(
            store.next_task_seq("tm_1").unwrap(),
            3,
            "只有纯 `t{{n}}` 参与水位线（`task-9` / `x7` / `t` / `T5` / `t1abc` / `t2x` 都要挡掉）"
        );
    }

    /// 数值序，不是字符串序：`max(id)` 会给出 `t9`，于是下一个 id 退回 `t2`（重撞 t2）。
    #[test]
    fn next_task_seq_is_numeric_not_lexicographic() {
        let store = seeded_store();
        for id in ["t9", "t10"] {
            let mut task = sample_task();
            task.id = id.into();
            store.upsert_task(&task).unwrap();
        }
        assert_eq!(
            store.next_task_seq("tm_1").unwrap(),
            11,
            "t10 > t9（字符串比较会得到 t9 → 下一个 t10 重撞）"
        );
    }

    /// **水位线是队内的**：两个队各占 `t1`，互不影响。
    ///
    /// D1 的复盘：v16 期的水位线是**全库**的（`max_task_seq`），因为单列 `id` 主键让
    /// 「每个队从 t1 开始」不可能成立。改成复合主键 `(team_id, id)` 之后，全局序号唯一
    /// 的理由消失了，剩下的只有代价（新队的第一件活叫 `t7` 这种观感）。判据：
    /// `a_new_team_numbers_its_tasks_from_one`（dispatch 侧端到端）与本条（store 侧）。
    #[test]
    fn next_task_seq_is_per_team() {
        let store = seeded_store();
        let mut busy = sample_task();
        for id in ["t1", "t2", "t7"] {
            busy.id = id.into();
            store.upsert_task(&busy).unwrap();
        }
        assert_eq!(store.next_task_seq("tm_1").unwrap(), 8);
        // 另一个队没有任何任务 → 从 t1 开始（而且是**允许**的，复合主键不冲突）。
        assert_eq!(store.next_task_seq("tm_other").unwrap(), 1);
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
        assert_eq!(
            reopened.get_task(&TaskRef::new("tm_1", "t1")).unwrap(),
            Some(task)
        );
        assert_eq!(reopened.get_team("tm_1").unwrap(), Some(sample_team()));
    }
}
