//! opencode 存储布局判定：v1（`session`/`message`/`part`）与 v2（`session_v2`/`session_message`）。
//!
//! 为什么需要判定、以及判据为什么是「表在 **且** 有数据」而不是版本号，见
//! `.trellis/spec/backend/conversation-adapter.md` §4.3.3「opencode 双存储」与
//! `.trellis/tasks/10-30-opencode-v2-storage/design.md` §0。
//!
//! 一句话：v2 升级后旧表变成迁移快照（不再写入），两套表在同一文件里共存；判成 v2 而 v2 还空着
//! （迁移没跑完）会把历史整体隐藏，判成 v1 而 v2 已在用会把新历史隐藏并让删除后的行复活。
//! 两侧最坏情况都只能是「显示旧数据」。

use std::path::Path;

use anyhow::{Context, Result};
use rusqlite::{Connection, OpenFlags};

/// v2 布局必须同时存在的两张表。
const V2_TABLES: [&str; 2] = ["session_v2", "session_message"];

/// 会话存储布局。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Store {
    /// 迁移前 / 未升级：`session` + `message` + `part`。
    V1,
    /// opencode v2：`session_v2` + `session_message`（旧表只是迁移快照）。
    V2,
}

/// 只读打开一个 opencode 数据库（`query_only` 防止误写）。
fn open_read_only(db_path: &Path) -> Result<Connection> {
    let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .with_context(|| format!("Failed to open OpenCode DB: {}", db_path.display()))?;
    let _ = conn.execute_batch("PRAGMA query_only = ON");
    Ok(conn)
}

/// 打开数据库并判定布局（打开与判定绑在一起，避免同一文件被开两次）。
pub(super) fn open_detected(db_path: &Path) -> Result<(Connection, Store)> {
    let conn = open_read_only(db_path)?;
    let store = detect(&conn);
    Ok((conn, store))
}

/// 判定布局：`session_v2` 与 `session_message` 都存在**且有数据** → v2，否则 v1。
pub(super) fn detect(conn: &Connection) -> Store {
    let has_v2_tables = V2_TABLES.iter().all(|table| table_exists(conn, table));
    let store = if has_v2_tables && table_has_rows(conn, "session_v2") {
        Store::V2
    } else {
        Store::V1
    };
    // 判定结果落日志：将来出现 v3（表名变了但旧 v2 表还在）时，症状会是「静默显示冻结快照」，
    // 这条 debug 是唯一能区分「判错了」与「没数据」的痕迹。
    log::debug!("[opencode/store] layout={store:?} v2_tables={has_v2_tables}");
    store
}

fn table_exists(conn: &Connection, name: &str) -> bool {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1",
        [name],
        |_| Ok(true),
    )
    .unwrap_or(false)
}

/// 表名只来自 `V2_TABLES` 常量，不来自外部输入。
fn table_has_rows(conn: &Connection, name: &str) -> bool {
    conn.query_row(&format!("SELECT EXISTS(SELECT 1 FROM {name})"), [], |row| {
        row.get::<_, bool>(0)
    })
    .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn db_with(dir: &TempDir, name: &str, ddl: &[&str]) -> std::path::PathBuf {
        let path = dir.path().join(name);
        let conn = Connection::open(&path).expect("open fixture db");
        for stmt in ddl {
            conn.execute_batch(stmt).expect("apply fixture ddl");
        }
        drop(conn);
        path
    }

    const V1_DDL: [&str; 3] = [
        "CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT, time_archived INTEGER)",
        "CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT)",
        "CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, data TEXT)",
    ];

    const V2_DDL: [&str; 2] = [
        "CREATE TABLE session_v2 (id TEXT PRIMARY KEY, parent_id TEXT, time_archived INTEGER)",
        "CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, seq INTEGER, data TEXT)",
    ];

    #[test]
    fn detects_v2_when_v2_tables_have_rows() {
        let dir = TempDir::new().unwrap();
        let mut ddl: Vec<&str> = V1_DDL.to_vec();
        ddl.extend(V2_DDL);
        let path = db_with(&dir, "both.db", &ddl);
        let conn = Connection::open(&path).unwrap();
        conn.execute("INSERT INTO session_v2 (id) VALUES ('ses_a')", [])
            .unwrap();

        assert_eq!(detect(&conn), Store::V2);
    }

    /// 迁移没跑完（表建好了、还没数据）时必须留在 v1 —— 否则历史被整体隐藏。
    #[test]
    fn detects_v1_when_v2_tables_exist_but_are_empty() {
        let dir = TempDir::new().unwrap();
        let mut ddl: Vec<&str> = V1_DDL.to_vec();
        ddl.extend(V2_DDL);
        let path = db_with(&dir, "empty_v2.db", &ddl);
        let conn = Connection::open(&path).unwrap();
        conn.execute("INSERT INTO session (id) VALUES ('ses_a')", [])
            .unwrap();

        assert_eq!(detect(&conn), Store::V1);
    }

    /// 只建了 `session_v2`、没有 `session_message` 也算 v1（两表是同一套布局）。
    #[test]
    fn detects_v1_when_only_one_v2_table_exists() {
        let dir = TempDir::new().unwrap();
        let path = db_with(
            &dir,
            "half_v2.db",
            &["CREATE TABLE session_v2 (id TEXT PRIMARY KEY)"],
        );
        let conn = Connection::open(&path).unwrap();
        conn.execute("INSERT INTO session_v2 (id) VALUES ('ses_a')", [])
            .unwrap();

        assert_eq!(detect(&conn), Store::V1);
    }

    #[test]
    fn detects_v1_for_legacy_database() {
        let dir = TempDir::new().unwrap();
        let path = db_with(&dir, "v1.db", &V1_DDL);
        let conn = Connection::open(&path).unwrap();

        assert_eq!(detect(&conn), Store::V1);
    }
}
