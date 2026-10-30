//! v1 库夹具与「经分派读 v1」的辅助入口。

use super::super::store;
use super::super::store::Store;
use super::super::v1::parse_opencode_db;
use crate::conversation::adapter::ParsedMeta;
use std::path::{Path, PathBuf};
use tempfile::TempDir;

pub(super) fn create_opencode_fixture(dir: &TempDir) -> PathBuf {
    let db_path = dir.path().join("opencode.db");
    let conn = rusqlite::Connection::open(&db_path).expect("Failed to create DB");

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS session (
            id TEXT PRIMARY KEY,
            title TEXT,
            directory TEXT,
            time_created INTEGER,
            time_updated INTEGER,
            model TEXT,
            tokens_input INTEGER DEFAULT 0,
            tokens_output INTEGER DEFAULT 0,
            tokens_reasoning INTEGER DEFAULT 0,
            parent_id TEXT,
            time_archived INTEGER
        );
        CREATE TABLE IF NOT EXISTS message (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            time_created INTEGER,
            time_updated INTEGER,
            data TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS part (
            id TEXT PRIMARY KEY,
            message_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            time_created INTEGER,
            time_updated INTEGER,
            data TEXT NOT NULL
        );

        -- Session 1: active, with messages
        INSERT INTO session (id, title, directory, time_created, time_updated, model)
        VALUES ('ses-001', 'Fix UI bug', '/projects/test', 1736935200000, 1736938800000,
                '{\"id\":\"claude-sonnet-4-5\"}');

        INSERT INTO message (id, session_id, time_created, data)
        VALUES ('m1', 'ses-001', 1736935201000,
                '{\"role\":\"user\",\"summary\":{\"title\":\"UI bug report\",\"body\":\"The button is broken\"}}');
        INSERT INTO part (id, message_id, session_id, time_created, data)
        VALUES ('p1', 'm1', 'ses-001', 1736935201000,
                '{\"type\":\"text\",\"text\":\"The button is not rendering correctly\"}');

        INSERT INTO message (id, session_id, time_created, data)
        VALUES ('m2', 'ses-001', 1736935202000,
                '{\"role\":\"assistant\",\"model\":{\"id\":\"claude-sonnet-4-5\"}}');
        INSERT INTO part (id, message_id, session_id, time_created, data)
        VALUES ('p2', 'm2', 'ses-001', 1736935202000,
                '{\"type\":\"text\",\"text\":\"Let me check the CSS. It seems like there is a z-index conflict.\"}');

        INSERT INTO message (id, session_id, time_created, data)
        VALUES ('m3', 'ses-001', 1736935203000,
                '{\"role\":\"user\"}');
        INSERT INTO part (id, message_id, session_id, time_created, data)
        VALUES ('p3', 'm3', 'ses-001', 1736935203000,
                '{\"type\":\"text\",\"text\":\"How do I fix the z-index?\"}');

        -- Session 2: archived (should be excluded)
        INSERT INTO session (id, title, directory, time_created, time_updated, time_archived)
        VALUES ('ses-archived', 'Archived session', '/projects/test', 1736935200000, 1736938800000, 1736940000000);

        -- Session 3: child session (should be excluded)
        INSERT INTO session (id, title, directory, time_created, time_updated, parent_id)
        VALUES ('ses-child', 'Child session', '/projects/test', 1736935200000, 1736938800000, 'ses-001');
        "
    ).expect("Failed to insert fixture data");

    db_path
}

/// v1 读取器接收已打开的连接（分派在 `store::open_detected`）；测试统一经此打开，
/// 顺带断言夹具确实被判定为 v1 布局。
pub(super) fn parse_v1(
    db_path: &Path,
    project_path: Option<&str>,
) -> anyhow::Result<Vec<(ParsedMeta, PathBuf)>> {
    let (conn, store) = store::open_detected(db_path).expect("open fixture db");
    assert_eq!(store, Store::V1, "v1 夹具必须被判定为 v1 布局");
    parse_opencode_db(&conn, db_path, project_path)
}
