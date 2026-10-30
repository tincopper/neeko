//! 布局分派：`read_db` 与 adapter 入口（`parse_meta` / `parse_messages`）必须跟着判定走。

use super::super::super::common::SYNTHETIC_SEP;
use super::fixtures::*;
use crate::conversation::adapter::AgentSessionAdapter;
use crate::conversation::adapters::opencode::store::Store;
use crate::conversation::adapters::opencode::{read_db, store, OpenCodeAdapter};
use std::path::PathBuf;
use tempfile::TempDir;

#[test]
fn dispatch_reads_legacy_layout_when_only_v1_tables_exist() {
    let dir = TempDir::new().unwrap();
    let path = create_legacy_fixture(&dir);
    let (_, store) = store::open_detected(&path).unwrap();
    assert_eq!(store, Store::V1);

    let metas = read_db(&path, None).unwrap();

    assert_eq!(ids(&metas), vec!["ses_legacy_only"]);
    assert_eq!(metas[0].0.message_count, 1);
}

#[test]
fn dispatch_reads_v2_layout_and_hides_the_legacy_snapshot() {
    let dir = TempDir::new().unwrap();
    let path = create_v2_fixture(&dir);
    let (_, store) = store::open_detected(&path).unwrap();
    assert_eq!(store, Store::V2, "两套布局共存时必须判 v2");

    let metas = read_db(&path, None).unwrap();

    assert_eq!(
        ids(&metas),
        vec!["ses_main", "ses_untitled", "ses_other", "ses_nested"],
        "只读 v2：v1 快照里的孤儿会话不得进入列表"
    );
}

#[test]
fn adapter_parse_meta_follows_the_detected_layout() {
    let dir = TempDir::new().unwrap();
    let path = create_v2_fixture(&dir);
    let adapter = OpenCodeAdapter;

    let meta = adapter
        .parse_meta(&PathBuf::from(format!(
            "{}{SYNTHETIC_SEP}ses_main",
            path.display()
        )))
        .unwrap();
    assert_eq!(meta.title.as_deref(), Some("主会话"));
    assert_eq!(meta.message_count, 5);

    // 快照里的会话在 v2 上是「查不到」，不能悄悄降级去读快照
    let snapshot = adapter.parse_meta(&PathBuf::from(format!(
        "{}{SYNTHETIC_SEP}ses_legacy_only",
        path.display()
    )));
    assert!(snapshot.is_err(), "v2 布局下不应从 v1 快照读会话");
}

#[test]
fn adapter_parse_messages_follows_the_detected_layout() {
    let dir = TempDir::new().unwrap();

    let v2_path = create_v2_fixture(&dir);
    let adapter = OpenCodeAdapter;
    let v2_messages = adapter
        .parse_messages(&PathBuf::from(format!(
            "{}{SYNTHETIC_SEP}ses_main",
            v2_path.display()
        )))
        .unwrap();
    assert_eq!(v2_messages.len(), 5);
    assert_eq!(v2_messages[0].content, "用户提问");

    let legacy_dir = TempDir::new().unwrap();
    let legacy_path = create_legacy_fixture(&legacy_dir);
    let legacy_messages = adapter
        .parse_messages(&PathBuf::from(format!(
            "{}{SYNTHETIC_SEP}ses_legacy_only",
            legacy_path.display()
        )))
        .unwrap();
    assert_eq!(legacy_messages.len(), 1);
    assert_eq!(legacy_messages[0].content, "快照正文");
}
