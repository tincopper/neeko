//! 工作项域持久化：`work_item` / `work_item_run`（统一任务中心的 Local Provider）。
//!
//! # 这一层**没有**业务判断
//!
//! 阶段流转的合法性只有 [`crate::work_items::manager::WorkItemManager`] 一处判据。本文件
//! 只做 CRUD + 一次 schema 迁移，所以「能不能从 Backlog 直接到 Done」在这里找不到答案 ——
//! 那是刻意的：两份判断迟早会分叉，而分叉后的表现是「UI 允许、后端拒绝」。
//!
//! # 刻意放在持久化边界的东西
//!
//! [`insert_run`](WorkItemStore::insert_run) 仍会截断 `label`：写入路径不该有第二个绕过
//! 红线 4 上界的入口（manager 也截一次，两次都是幂等的）。
//!
//! # 单元约定
//!
//! 表里所有时间都是 **epoch 毫秒**（`INTEGER`）；枚举存**人可读**的 snake_case TEXT
//! （`running` / `p2`），数组存 JSON TEXT。带引号的 JSON（`"running"`）会把
//! 「`sqlite3` 能直接查」这条收益吃掉。

use anyhow::{Context, Result};
use rusqlite::{params, Connection};

use crate::common::db::DbPool;
use crate::work_items::types::{
    truncate_label, Priority, RunMode, RunRef, RunRefKind, RunSnapshot, RunState, WorkItem,
    WorkItemRun,
};

const SELECT_ITEM: &str = "SELECT id, project_id, title, body, stage, priority, labels, assignee, \
                           created_at, updated_at FROM work_item";
const SELECT_RUN: &str = "SELECT id, work_item_id, mode, ref_kind, ref_id, ref_sub, state, label, \
                          captured_at, created_at FROM work_item_run";

/// v17 -> v18：`work_item` / `work_item_run` + 索引。
///
/// 版本号进 / 事务回滚 / `user_version` 递增由 [`crate::common::db::migrations`] 的既有序列
/// 负责，这里**不写**自己的版本处理（写第二份就会分叉）。
///
/// `CREATE TABLE IF NOT EXISTS` 让本步骤在「半迁移后手工重放」时安全：序列表只会重跑未
/// 提交的步骤，但幂等的 DDL 让手工重放也不会炸（与 `agent::team::store::v13_to_v14`
/// 同一性质，判据 `work_items::store::tests::migration_step_is_idempotent`）。
///
/// # 为什么分两张表而不是一张
///
/// 一个工作项派生 0..N 次执行，两者生命周期独立（外部平台把工作项关掉了，run 可能还在
/// 跑；run 失败不影响工作项存在）。塞进同一行就得靠 JSON 数组存 N 条记录，而「按 run
/// 反查、按时间排序、单条改状态」全都会退化成全表扫 + 解析。
///
/// `ON DELETE CASCADE` 靠连接池 `with_init` 里的 `PRAGMA foreign_keys=ON` 生效（不是
/// 默认值），判据 `deleting_a_work_item_cascades_to_its_runs`。
pub fn v17_to_v18(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        -- 本地工作项：Tasks 面板的项目级 inbox。
        --
        -- `stage` 是自由文本而不是 CHECK 约束：阶段轨可配置（design §4.5），把 5 个阶段名
        -- 编译进 schema 等于让「自定义阶段」必须先做一次迁移。
        -- `priority` 可空 = 未设（'p0'..'p3' 是枚举的落库文本，见 types::Priority）。
        CREATE TABLE IF NOT EXISTS work_item (
            id          TEXT PRIMARY KEY,
            project_id  TEXT NOT NULL,
            title       TEXT NOT NULL,
            body        TEXT NOT NULL DEFAULT '',
            stage       TEXT NOT NULL,
            priority    TEXT,
            labels      TEXT NOT NULL DEFAULT '[]',
            assignee    TEXT,
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL
        );
        -- 索引列序 = 查询列序：列表恒按 (project_id, updated_at DESC)，反向索引对它无用。
        CREATE INDEX IF NOT EXISTS idx_work_item_project ON work_item(project_id, updated_at DESC);

        -- 执行记录：指针 + 轻量快照。真相源在执行域，本表只回答「派给了谁、当时什么状态」。
        CREATE TABLE IF NOT EXISTS work_item_run (
            id           TEXT PRIMARY KEY,
            work_item_id TEXT NOT NULL REFERENCES work_item(id) ON DELETE CASCADE,
            mode         TEXT NOT NULL,
            ref_kind     TEXT NOT NULL,
            ref_id       TEXT NOT NULL,
            ref_sub      TEXT,
            state        TEXT NOT NULL,
            label        TEXT NOT NULL DEFAULT '',
            captured_at  INTEGER NOT NULL,
            created_at   INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_work_item_run_item
            ON work_item_run(work_item_id, created_at DESC);
        ",
    )?;
    Ok(())
}

/// 工作项域 SQLite facade。
///
/// 与其它域一样**共享** `neeko.db` 的连接池（一个数据库文件一个池），不自己开池。
pub struct WorkItemStore {
    pool: DbPool,
}

impl WorkItemStore {
    /// 包装共享池。
    ///
    /// **前置条件**：调用方必须已在这个池上跑过迁移链（`LibraryStore::with_pool` 通常
    /// 就是那个入口，`AppStateWrapper` 从它派生本 store）。否则每一条查询都会以
    /// `no such table: work_item` 失败。**不起池、不跑迁移**（`const fn` 的意义就在这：
    /// 读签名就知道它不碰 I/O）。
    #[must_use]
    pub const fn with_pool(pool: DbPool) -> Self {
        Self { pool }
    }

    /// 打开一个内存库并跑完整迁移链（测试夹具，同 `TeamStore::open_in_memory`）。
    pub fn open_in_memory() -> Result<Self> {
        let pool = crate::common::db::open_memory_pool()?;
        let mut conn = pool.get()?;
        crate::common::db::run_migrations(&mut conn)?;
        Ok(Self { pool })
    }

    /// 共享池（供组合根与测试证明注入的是同一个池）。
    #[must_use]
    pub const fn pool(&self) -> &DbPool {
        &self.pool
    }

    fn conn(&self) -> Result<r2d2::PooledConnection<r2d2_sqlite::SqliteConnectionManager>> {
        Ok(self.pool.get()?)
    }

    // ═══════════════════════════════════════════════════════════════════
    // work_item
    // ═══════════════════════════════════════════════════════════════════

    /// 一个项目的工作项，**最近改过的在最前**。
    ///
    /// 次序键补了 `id`：同一毫秒内改过两行时，`updated_at DESC` 单独不构成全序，列表会
    /// 在两次调用之间抖动（React 的 key 不变、位置乱跳）。
    pub fn list(&self, project_id: &str) -> Result<Vec<WorkItem>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(&format!(
            "{SELECT_ITEM} WHERE project_id = ?1 ORDER BY updated_at DESC, id"
        ))?;
        let rows = stmt.query_map(params![project_id], map_item_row)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// 读一行；不存在返回 `Ok(None)`（`NotFound` 是 manager 的判断，不是这一层的）。
    pub fn get(&self, id: &str) -> Result<Option<WorkItem>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(&format!("{SELECT_ITEM} WHERE id = ?1"))?;
        let mut rows = stmt.query_map(params![id], map_item_row)?;
        let item = rows.next().transpose()?;
        Ok(item)
    }

    /// 插入一行（id 冲突即报错：id 是 uuid，冲突意味着生成逻辑坏了）。
    pub fn insert(&self, item: &WorkItem) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO work_item (id, project_id, title, body, stage, priority, labels,
             assignee, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                item.id,
                item.project_id,
                item.title,
                item.body,
                item.stage,
                item.priority.map(Priority::as_str),
                encode_labels(&item.labels)?,
                item.assignee,
                item.created_at,
                item.updated_at,
            ],
        )?;
        Ok(())
    }

    /// 整行覆盖，返回**是否命中了一行**。
    ///
    /// 布尔而不是 `()`：`UPDATE` 打到 0 行在 SQLite 里也是成功，静默丢掉一次写入是
    /// 最难查的一类缺陷（UI 保存了、重启后没了）。调用方据此回答 `NotFound`。
    /// `updated_at` 由 manager 负责推进 —— 本层不造时间。
    pub fn update(&self, item: &WorkItem) -> Result<bool> {
        let conn = self.conn()?;
        let hit = conn.execute(
            "UPDATE work_item SET project_id = ?2, title = ?3, body = ?4, stage = ?5,
             priority = ?6, labels = ?7, assignee = ?8, created_at = ?9, updated_at = ?10
             WHERE id = ?1",
            params![
                item.id,
                item.project_id,
                item.title,
                item.body,
                item.stage,
                item.priority.map(Priority::as_str),
                encode_labels(&item.labels)?,
                item.assignee,
                item.created_at,
                item.updated_at,
            ],
        )?;
        Ok(hit > 0)
    }

    /// 删一行，返回**是否真的删到了**。它的执行记录靠 `ON DELETE CASCADE` 一起消失。
    pub fn delete(&self, id: &str) -> Result<bool> {
        let conn = self.conn()?;
        let hit = conn.execute("DELETE FROM work_item WHERE id = ?1", params![id])?;
        Ok(hit > 0)
    }

    // ═══════════════════════════════════════════════════════════════════
    // work_item_run
    // ═══════════════════════════════════════════════════════════════════

    /// 一个工作项的执行记录，**最新一条在最前**（design §4.6 的排序）。
    pub fn list_runs(&self, work_item_id: &str) -> Result<Vec<WorkItemRun>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(&format!(
            "{SELECT_RUN} WHERE work_item_id = ?1 ORDER BY created_at DESC, id"
        ))?;
        let rows = stmt.query_map(params![work_item_id], map_run_row)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// 追加一条执行记录。
    ///
    /// 父行不存在时由外键拒绝（`PRAGMA foreign_keys=ON`）。第二个闸门是 `label` 截断：
    /// 快照文案的上界（红线 4）不该依赖「调用方记得截」。
    pub fn insert_run(&self, run: &WorkItemRun) -> Result<()> {
        let label = truncate_label(&run.snapshot.label);
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO work_item_run (id, work_item_id, mode, ref_kind, ref_id, ref_sub,
             state, label, captured_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                run.id,
                run.work_item_id,
                run.mode.as_str(),
                run.run_ref.kind.as_str(),
                run.run_ref.id,
                run.run_ref.sub,
                run.snapshot.state.as_str(),
                label,
                run.snapshot.captured_at,
                run.created_at,
            ],
        )?;
        Ok(())
    }
}

/// 标签列编码：JSON 数组（`['bug','p1']`），不是逗号拼接 —— 标签里出现逗号是合法的。
fn encode_labels(labels: &[String]) -> Result<String> {
    serde_json::to_string(labels).context("encode work_item.labels")
}

fn map_item_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkItem> {
    Ok(WorkItem {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        title: row.get("title")?,
        body: row.get("body")?,
        stage: row.get("stage")?,
        priority: decode_priority(row.get("priority")?)?,
        labels: decode_labels(&row.get::<_, String>("labels")?)?,
        assignee: row.get("assignee")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn map_run_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkItemRun> {
    let mode: String = row.get("mode")?;
    let kind: String = row.get("ref_kind")?;
    let state: String = row.get("state")?;
    Ok(WorkItemRun {
        id: row.get("id")?,
        work_item_id: row.get("work_item_id")?,
        mode: RunMode::try_from(mode.as_str())
            .map_err(|err| conversion_failure("mode", &err.to_string()))?,
        run_ref: RunRef {
            kind: RunRefKind::try_from(kind.as_str())
                .map_err(|err| conversion_failure("ref_kind", &err.to_string()))?,
            id: row.get("ref_id")?,
            sub: row.get("ref_sub")?,
        },
        snapshot: RunSnapshot {
            state: RunState::try_from(state.as_str())
                .map_err(|err| conversion_failure("state", &err.to_string()))?,
            label: row.get("label")?,
            captured_at: row.get("captured_at")?,
        },
        created_at: row.get("created_at")?,
    })
}

/// 优先级列 → 枚举。`NULL` = 未设；非法文本**报错**而不是读成「未设」——
/// 悄悄降级会让用户在下次保存时把脏值覆盖成缺省值，且没人知道发生过这件事。
fn decode_priority(text: Option<String>) -> rusqlite::Result<Option<Priority>> {
    text.map(|raw| {
        Priority::try_from(raw.as_str())
            .map_err(|err| conversion_failure("priority", &format!("{raw}: {err}")))
    })
    .transpose()
}

/// 标签列 → 字符串数组（同一套「脏值即报错」的判据）。
fn decode_labels(text: &str) -> rusqlite::Result<Vec<String>> {
    serde_json::from_str(text)
        .map_err(|err| conversion_failure("labels", &format!("{text}: {err}")))
}

/// 把解码失败归到**具体列**：`FromSqlConversionFailure` 的载荷会原样出现在错误消息里，
/// 而「哪一列坏了」是这类缺陷唯一有用的线索。
fn conversion_failure(column: &'static str, reason: &str) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        format!("{column}: {reason}").into(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> WorkItemStore {
        WorkItemStore::open_in_memory().unwrap()
    }

    /// 一行**每列都偏离缺省**的工作项：round-trip 用它对，缺省值打底会让「某列根本没写进
    /// 库」这类缺陷变绿（同 `agent/team/store.rs` 的夹具原则）。
    fn sample_item(id: &str, project: &str, updated_at: i64) -> WorkItem {
        WorkItem {
            id: id.to_owned(),
            project_id: project.to_owned(),
            title: format!("Title {id}"),
            body: "## body\n第二行".to_owned(),
            stage: "Review".to_owned(),
            priority: Some(Priority::P2),
            labels: vec!["bug".to_owned(), "ui".to_owned()],
            assignee: Some("tincopper".to_owned()),
            created_at: 1_700_000_000_000,
            updated_at,
        }
    }

    fn sample_run(id: &str, work_item_id: &str, created_at: i64) -> WorkItemRun {
        WorkItemRun {
            id: id.to_owned(),
            work_item_id: work_item_id.to_owned(),
            mode: RunMode::Single,
            run_ref: RunRef {
                kind: RunRefKind::Session,
                id: "sess-1".to_owned(),
                sub: None,
            },
            snapshot: RunSnapshot {
                state: RunState::Running,
                label: "空闲".to_owned(),
                captured_at: created_at,
            },
            created_at,
        }
    }

    /// 半迁移后的手工重放不会炸（`CREATE TABLE IF NOT EXISTS` 的意义）。
    #[test]
    fn migration_step_is_idempotent() {
        let store = store();
        // 内存池是 max_size(1) 的：连接必须在括号里 drop，否则下面那次 `list` 会
        // 卡在「等连接」上（不是死锁证明，只是夹具要求）。
        {
            let conn = store.pool().get().unwrap();
            v17_to_v18(&conn).expect("第二次执行必须成功（DDL 幂等）");
            v17_to_v18(&conn).expect("第三次同样");
        }
        assert_eq!(
            store.list("p1").unwrap(),
            Vec::new(),
            "重放只该碰 schema，不该碰数据"
        );
    }

    /// 每一列都能原样往返 —— 这条钉住「列写反 / 漏列」。
    #[test]
    fn insert_then_get_roundtrips_every_column() {
        let store = store();
        let item = sample_item("wi_1", "p1", 1_700_000_000_500);
        store.insert(&item).unwrap();

        assert_eq!(store.get("wi_1").unwrap(), Some(item));
    }

    /// 未设的优先级与空标签也要能往返（`NULL` 与 `'[]'` 的两种「空」）。
    #[test]
    fn null_priority_and_empty_labels_roundtrip() {
        let store = store();
        let mut item = sample_item("wi_1", "p1", 10);
        item.priority = None;
        item.labels = Vec::new();
        item.assignee = None;
        store.insert(&item).unwrap();

        let read = store.get("wi_1").unwrap().expect("must exist");
        assert_eq!(read.priority, None);
        assert!(read.labels.is_empty());
        assert_eq!(read.assignee, None);
    }

    /// 列表只给本项目，且按 `updated_at` 倒序（同一毫秒也要有确定次序）。
    #[test]
    fn list_returns_one_project_newest_first() {
        let store = store();
        store.insert(&sample_item("wi_old", "p1", 100)).unwrap();
        store.insert(&sample_item("wi_new", "p1", 300)).unwrap();
        store.insert(&sample_item("wi_mid", "p1", 200)).unwrap();
        store.insert(&sample_item("wi_other", "p2", 400)).unwrap();

        let ids: Vec<String> = store
            .list("p1")
            .unwrap()
            .into_iter()
            .map(|item| item.id)
            .collect();
        assert_eq!(ids, vec!["wi_new", "wi_mid", "wi_old"]);
    }

    /// 同一 `updated_at` 的两行仍有全序（否则列表在两次调用之间抖动）。
    #[test]
    fn list_breaks_updated_at_ties_by_id() {
        let store = store();
        store.insert(&sample_item("wi_b", "p1", 100)).unwrap();
        store.insert(&sample_item("wi_a", "p1", 100)).unwrap();

        let ids: Vec<String> = store
            .list("p1")
            .unwrap()
            .into_iter()
            .map(|item| item.id)
            .collect();
        assert_eq!(ids, vec!["wi_a", "wi_b"]);
    }

    /// 整行覆盖：改过的列读回来是新值，没改的列一个不丢。
    #[test]
    fn update_writes_the_whole_row() {
        let store = store();
        let mut item = sample_item("wi_1", "p1", 100);
        store.insert(&item).unwrap();

        item.title = "Renamed".to_owned();
        item.stage = "Done".to_owned();
        item.priority = None;
        item.labels = vec!["done".to_owned()];
        item.updated_at = 200;
        assert!(store.update(&item).unwrap(), "命中的行必须报 true");

        assert_eq!(store.get("wi_1").unwrap(), Some(item));
    }

    /// 打到不存在的行必须报 `false` —— 静默成功会让一次「保存」凭空消失。
    #[test]
    fn update_reports_whether_a_row_was_hit() {
        let store = store();
        assert!(!store.update(&sample_item("wi_missing", "p1", 1)).unwrap());
    }

    /// 删除同样如实报告命中。
    #[test]
    fn delete_reports_whether_a_row_was_hit() {
        let store = store();
        store.insert(&sample_item("wi_1", "p1", 1)).unwrap();
        assert!(store.delete("wi_1").unwrap());
        assert!(!store.delete("wi_1").unwrap(), "第二次必须报 false");
        assert_eq!(store.get("wi_1").unwrap(), None);
    }

    /// 删工作项 → 它的执行记录一并消失（`ON DELETE CASCADE` + 连接池里
    /// `PRAGMA foreign_keys=ON` 的联合判据；关掉 pragma 这条会红）。
    #[test]
    fn deleting_a_work_item_cascades_to_its_runs() {
        let store = store();
        store.insert(&sample_item("wi_1", "p1", 1)).unwrap();
        store.insert_run(&sample_run("run_1", "wi_1", 10)).unwrap();
        store.insert_run(&sample_run("run_2", "wi_1", 20)).unwrap();
        assert_eq!(store.list_runs("wi_1").unwrap().len(), 2);

        store.delete("wi_1").unwrap();

        assert!(
            store.list_runs("wi_1").unwrap().is_empty(),
            "父行没了，子行必须一起没（否则列表里留下指向空气的徽标）"
        );
    }

    /// 没有父行的执行记录写不进去（外键开着，存储层不给孤儿行机会）。
    #[test]
    fn insert_run_requires_an_existing_work_item() {
        let store = store();
        let err = store
            .insert_run(&sample_run("run_1", "wi_missing", 10))
            .expect_err("没有父行时必须失败");
        assert!(
            err.to_string().to_lowercase().contains("foreign key"),
            "错误应来自外键约束，实际：{err}"
        );
    }

    /// 执行记录按 `created_at` 倒序（最新一条在最上，design §4.6）。
    #[test]
    fn runs_are_listed_newest_first() {
        let store = store();
        store.insert(&sample_item("wi_1", "p1", 1)).unwrap();
        store
            .insert_run(&sample_run("run_old", "wi_1", 10))
            .unwrap();
        store
            .insert_run(&sample_run("run_new", "wi_1", 30))
            .unwrap();
        store
            .insert_run(&sample_run("run_mid", "wi_1", 20))
            .unwrap();

        let ids: Vec<String> = store
            .list_runs("wi_1")
            .unwrap()
            .into_iter()
            .map(|run| run.id)
            .collect();
        assert_eq!(ids, vec!["run_new", "run_mid", "run_old"]);
    }

    /// 指针三段（kind / id / sub）与快照三段都要能原样往返。
    #[test]
    fn run_pointer_and_snapshot_roundtrip() {
        let store = store();
        store.insert(&sample_item("wi_1", "p1", 1)).unwrap();
        let run = WorkItemRun {
            id: "run_1".to_owned(),
            work_item_id: "wi_1".to_owned(),
            mode: RunMode::Team,
            run_ref: RunRef {
                kind: RunRefKind::Team,
                id: "tm_1".to_owned(),
                sub: Some("t3".to_owned()),
            },
            snapshot: RunSnapshot {
                state: RunState::Unknown,
                label: "已不可查".to_owned(),
                captured_at: 99,
            },
            created_at: 100,
        };
        store.insert_run(&run).unwrap();

        assert_eq!(store.list_runs("wi_1").unwrap(), vec![run]);
    }

    /// store 层也截断 `label`：写入路径不该有第二个能绕过红线 4 上界的入口。
    #[test]
    fn insert_run_truncates_the_label_at_the_payload_bound() {
        let store = store();
        store.insert(&sample_item("wi_1", "p1", 1)).unwrap();
        let mut run = sample_run("run_1", "wi_1", 10);
        run.snapshot.label = "长".repeat(crate::work_items::types::RUN_LABEL_MAX_CHARS + 5);
        store.insert_run(&run).unwrap();

        let stored = store.list_runs("wi_1").unwrap().remove(0);
        assert_eq!(
            stored.snapshot.label.chars().count(),
            crate::work_items::types::RUN_LABEL_MAX_CHARS
        );
    }

    /// 库里出现非法枚举文本时读路径报错，且错误里点明是哪一列。
    #[test]
    fn unknown_enum_text_in_the_database_is_an_error() {
        let store = store();
        {
            let conn = store.pool().get().unwrap();
            conn.execute(
                "INSERT INTO work_item (id, project_id, title, body, stage, priority, labels,
                 assignee, created_at, updated_at)
                 VALUES ('wi_bad', 'p1', 'T', '', 'Backlog', 'p9', '[]', NULL, 1, 1)",
                [],
            )
            .unwrap();
        }
        let err = store.get("wi_bad").expect_err("非法 priority 必须报错");
        assert!(
            err.to_string().contains("priority") && err.to_string().contains("p9"),
            "错误里要能看出哪一列、哪个值，实际：{err}"
        );

        {
            let conn = store.pool().get().unwrap();
            conn.execute(
                "INSERT INTO work_item (id, project_id, title, body, stage, priority, labels,
                 assignee, created_at, updated_at)
                 VALUES ('wi_bad2', 'p1', 'T', '', 'Backlog', NULL, 'not json', NULL, 1, 1)",
                [],
            )
            .unwrap();
        }
        let err = store.get("wi_bad2").expect_err("非法 labels 必须报错");
        assert!(err.to_string().contains("labels"), "实际：{err}");
    }
}
