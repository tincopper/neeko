//! 夹具：v1 三表 + v2 两表的 DDL 与行模型（形状对齐真机实测，勿用简化 JSON 代替）。

use crate::conversation::adapter::ParsedMeta;
use std::path::{Path, PathBuf};
use tempfile::TempDir;

pub(super) const V1_DDL: [&str; 3] = [
    "CREATE TABLE IF NOT EXISTS session (
         id TEXT PRIMARY KEY, parent_id TEXT, directory TEXT, title TEXT NOT NULL, model TEXT,
         time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, time_archived INTEGER,
         tokens_input INTEGER DEFAULT 0, tokens_output INTEGER DEFAULT 0,
         tokens_reasoning INTEGER DEFAULT 0)",
    "CREATE TABLE IF NOT EXISTS message (
         id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL,
         data TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS part (
         id TEXT PRIMARY KEY, message_id TEXT NOT NULL, time_created INTEGER NOT NULL,
         data TEXT NOT NULL)",
];

pub(super) const T0: i64 = 1_760_000_000_000;

pub(super) fn apply_v1_ddl(conn: &rusqlite::Connection) {
    for stmt in V1_DDL {
        conn.execute_batch(stmt).unwrap();
    }
}

/// 一条只存在于 v1 快照里的会话（v2 已不再列出它）。
pub(super) fn insert_legacy_session(conn: &rusqlite::Connection, id: &str) {
    conn.execute(
        "INSERT INTO session (id, parent_id, directory, title, model, time_created,
             time_updated, time_archived)
         VALUES (?1, NULL, '/proj', '旧快照会话', NULL, ?2, ?2, NULL)",
        rusqlite::params![id, T0],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO message (id, session_id, time_created, data)
         VALUES ('legacy_msg', ?1, ?2, '{\"role\":\"user\",\"model\":null}')",
        rusqlite::params![id, T0],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO part (id, message_id, time_created, data)
         VALUES ('legacy_part', 'legacy_msg', ?1, '{\"type\":\"text\",\"text\":\"快照正文\"}')",
        rusqlite::params![T0],
    )
    .unwrap();
}

/// 只有 v1 表的库（未升级的 opencode）。
pub(super) fn create_legacy_fixture(dir: &TempDir) -> std::path::PathBuf {
    let path = dir.path().join("opencode.db");
    let conn = rusqlite::Connection::open(&path).unwrap();
    apply_v1_ddl(&conn);
    insert_legacy_session(&conn, "ses_legacy_only");
    drop(conn);
    path
}

pub(super) fn create_v2_fixture(dir: &TempDir) -> std::path::PathBuf {
    let path = dir.path().join("opencode.db");
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch(
        "CREATE TABLE session_v2 (
             id TEXT PRIMARY KEY, parent_id TEXT, directory TEXT, title TEXT, model TEXT,
             time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL,
             time_archived INTEGER,
             tokens_input INTEGER, tokens_output INTEGER, tokens_reasoning INTEGER);
         CREATE TABLE session_message (
             id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL,
             seq INTEGER NOT NULL, time_created INTEGER NOT NULL, data TEXT NOT NULL);",
    )
    .unwrap();
    // v1 快照也在同一个文件里（迁移后不再写入）—— 分派必须只读 v2，且不得复活这里的孤儿
    apply_v1_ddl(&conn);
    insert_legacy_session(&conn, "ses_legacy_only");

    let model = r#"{"id":"glm-5","providerID":"opencode"}"#;
    // (id, parent, directory, title, updated, archived)
    for (id, parent, dir_path, title, updated, archived) in [
        ("ses_main", None, "/proj", Some("主会话"), T0 + 300, None),
        (
            "ses_child",
            Some("ses_main"),
            "/proj",
            Some("子会话"),
            T0 + 900,
            None,
        ),
        (
            "ses_arch",
            None,
            "/proj",
            Some("归档会话"),
            T0 + 900,
            Some(T0 + 950),
        ),
        (
            "ses_other",
            None,
            "/other",
            Some("别的项目"),
            T0 + 100,
            None,
        ),
        ("ses_untitled", None, "/proj", None, T0 + 200, None),
        (
            "ses_nested",
            None,
            "/proj/sub",
            Some("嵌套目录"),
            T0 + 50,
            None,
        ),
    ] {
        conn.execute(
            "INSERT INTO session_v2 (id, parent_id, directory, title, model, time_created,
                 time_updated, time_archived, tokens_input, tokens_output, tokens_reasoning)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, 0, 0)",
            rusqlite::params![id, parent, dir_path, title, model, T0, updated, archived],
        )
        .unwrap();
    }

    // 主会话：user / assistant(thinking+text+tool) / assistant(error tool) /
    // system / compaction / assistant(空 content) / user
    let rows = [
        (
            0,
            "user",
            r#"{"text":"用户提问","time":{"created":1760000000000}}"#,
        ),
        (
            1,
            "assistant",
            r#"{"time":{"created":1760000000100},"model":{"id":"glm-5","providerID":"opencode"},"content":[{"type":"reasoning","text":"先分析"},{"type":"text","text":"我来执行"},{"type":"tool","id":"call_1","name":"bash","state":{"status":"completed","input":{"command":"ls"},"content":[{"type":"text","text":"file-a\nfile-b"}]}}]}"#,
        ),
        (
            2,
            "assistant",
            r#"{"time":{"created":1760000000200},"content":[{"type":"tool","id":"call_2","name":"edit","state":{"status":"error","input":{"filePath":"/a.rs"},"error":"no such file"}}]}"#,
        ),
        (
            3,
            "system",
            r#"{"text":"系统提示","time":{"created":1760000000300}}"#,
        ),
        (4, "compaction", r#"{"summary":"压缩摘要","status":"ok"}"#),
        (
            5,
            "assistant",
            r#"{"time":{"created":1760000000400},"content":[]}"#,
        ),
        (
            6,
            "user",
            r#"{"text":"继续","time":{"created":1760000000500}}"#,
        ),
    ];
    for (seq, kind, data) in rows {
        conn.execute(
            "INSERT INTO session_message (id, session_id, type, seq, time_created, data)
             VALUES (?1, 'ses_main', ?2, ?3, ?4, ?5)",
            rusqlite::params![format!("msg_{seq}"), kind, seq, T0 + seq, data],
        )
        .unwrap();
    }
    conn.execute(
        "INSERT INTO session_message (id, session_id, type, seq, time_created, data)
         VALUES ('msg_u0', 'ses_untitled', 'user', 0, ?1, ?2)",
        rusqlite::params![
            T0,
            r#"{"text":"标题只能靠这条","time":{"created":1760000000000}}"#
        ],
    )
    .unwrap();
    // 子会话也有正文，但它不该出现在列表里
    conn.execute(
        "INSERT INTO session_message (id, session_id, type, seq, time_created, data)
         VALUES ('msg_c0', 'ses_child', 'user', 0, ?1, '{\"text\":\"子任务\"}')",
        rusqlite::params![T0],
    )
    .unwrap();

    drop(conn);
    path
}

pub(super) fn open(path: &Path) -> rusqlite::Connection {
    rusqlite::Connection::open(path).unwrap()
}

pub(super) fn ids(metas: &[(ParsedMeta, PathBuf)]) -> Vec<String> {
    metas
        .iter()
        .map(|(m, _)| m.native_session_id.clone())
        .collect()
}

// ── 分派（`read_db` / adapter 入口）必须有用例 ────────────────────────────
// 只测 `detect` 不够：把 `read_db` 的两个 match 臂写反，detect 用例仍会全绿。
