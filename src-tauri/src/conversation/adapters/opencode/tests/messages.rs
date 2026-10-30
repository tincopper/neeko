//! v1 正文解析与块映射（`message` JOIN `part`，迁移前的布局）。

use super::super::common::extract_model_id_from_json;
use super::super::v1::extract_part_text;
use super::super::OpenCodeAdapter;
use super::fixture::*;
use crate::conversation::adapter::AgentSessionAdapter;
use crate::conversation::types::MessageBlock;
use std::path::PathBuf;
use tempfile::TempDir;

#[test]
fn should_parse_messages() {
    let dir = TempDir::new().unwrap();
    let db_path = create_opencode_fixture(&dir);
    let adapter = OpenCodeAdapter;

    let synthetic_path = PathBuf::from(format!("{}#ses-001", db_path.display()));
    let messages = adapter.parse_messages(&synthetic_path).unwrap();
    assert_eq!(messages.len(), 3);
    assert_eq!(messages[0].role, "user");
    assert!(messages[0].content.contains("button"));
    assert_eq!(messages[1].role, "assistant");
    assert!(messages[1].content.contains("z-index"));
    assert_eq!(messages[2].role, "user");
    assert!(messages[2].content.contains("z-index"));
}

#[test]
fn should_extract_model_id() {
    let json = r#"{"id":"claude-sonnet-4-5","providerID":"anthropic"}"#;
    assert_eq!(
        extract_model_id_from_json(json),
        Some("claude-sonnet-4-5".to_string())
    );

    let old_json = r#"{"modelID":"claude-sonnet-4-5"}"#;
    assert_eq!(
        extract_model_id_from_json(old_json),
        Some("claude-sonnet-4-5".to_string())
    );

    assert_eq!(extract_model_id_from_json("null"), None);
    assert_eq!(extract_model_id_from_json("{}"), None);
}

#[test]
fn should_extract_part_text() {
    let json = r#"{"type":"text","text":"Hello world"}"#;
    assert_eq!(extract_part_text(json), Some("Hello world".to_string()));

    let tool_json = r#"{"type":"tool_use","name":"bash"}"#;
    assert_eq!(extract_part_text(tool_json), None);
}

/// 真实 opencode 部件形状的 fixture（部件 JSON 逐字取自本地
/// `~/.local/share/opencode/opencode.db` 实测数据）。
///
/// 回归背景：旧实现只映射 Claude Code 约定的 `text`/`tool_use`/`tool_result`
/// 三种类型，opencode 实际的 `reasoning`/`tool`/`step-*`/`patch` 全部落入
/// `_ => {}` 被静默丢弃 —— 恢复会话后工具卡片与思考过程渲染成空白。
fn create_parts_fixture(dir: &TempDir) -> PathBuf {
    let db_path = dir.path().join("opencode-parts.db");
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
        INSERT INTO session (id, title, directory, time_created, time_updated)
        VALUES ('ses-parts', 'parts fixture', '/projects/test', 1736935200000, 1736938800000);

        INSERT INTO message (id, session_id, time_created, data)
        VALUES ('ma', 'ses-parts', 1736935202000, '{\"role\":\"assistant\"}');
        ",
    )
    .expect("Failed to insert parts fixture");

    // 部件按 time_created 升序插入，模拟一次真实回复的到达顺序。
    let parts: &[(&str, &str)] = &[
        ("pa1", r#"{"type":"step-start","snapshot":"307f33e0"}"#),
        (
            "pa2",
            r#"{"type":"reasoning","text":"先分析根因再动手。","time":{"start":1787368960000,"end":1787368970000}}"#,
        ),
        (
            "pa3",
            r#"{"type":"text","text":"开始执行。**红灯**：补 `exec_command` 用例：","time":{"start":1787368970223,"end":1787368979910}}"#,
        ),
        (
            "pa4",
            r#"{"type":"tool","callID":"call_edit1","tool":"edit","state":{"status":"completed","input":{"filePath":"/projects/test/src/lib.rs","oldString":"fn old() {}","newString":"fn new() {}"},"output":"+ fn new() {}\n- fn old() {}"}}"#,
        ),
        (
            "pa5",
            r#"{"type":"patch","hash":"f198039c","files":["/projects/test/src/lib.rs"]}"#,
        ),
        (
            "pa6",
            r#"{"type":"tool","callID":"call_bash1","tool":"bash","state":{"status":"error","input":{"command":"cargo test"},"error":"compile error"}}"#,
        ),
    ];
    for (i, (pid, data)) in parts.iter().enumerate() {
        conn.execute(
            "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
             VALUES (?1, 'ma', 'ses-parts', ?2, ?2, ?3)",
            rusqlite::params![
                pid,
                1736935202000 + i64::try_from(i).expect("part index fits i64"),
                data
            ],
        )
        .expect("insert part");
    }

    db_path
}

#[test]
fn should_map_reasoning_part_to_thinking_block() {
    let dir = TempDir::new().unwrap();
    let db_path = create_parts_fixture(&dir);
    let adapter = OpenCodeAdapter;
    let synthetic_path = PathBuf::from(format!("{}#ses-parts", db_path.display()));

    let messages = adapter.parse_messages(&synthetic_path).unwrap();
    assert_eq!(messages.len(), 1);
    assert!(
        messages[0].blocks.iter().any(
            |b| matches!(b, MessageBlock::Thinking { thinking } if thinking == "先分析根因再动手。")
        ),
        "reasoning part must map to Thinking block, got {:?}",
        messages[0].blocks
    );
}

#[test]
fn should_map_tool_part_to_paired_use_and_result() {
    let dir = TempDir::new().unwrap();
    let db_path = create_parts_fixture(&dir);
    let adapter = OpenCodeAdapter;
    let synthetic_path = PathBuf::from(format!("{}#ses-parts", db_path.display()));

    let messages = adapter.parse_messages(&synthetic_path).unwrap();
    let blocks = &messages[0].blocks;

    // completed 工具 → ToolUse(callID/tool/state.input) + ToolResult(output) 成对出现
    let use_at = blocks
        .iter()
        .position(|b| matches!(b, MessageBlock::ToolUse { id, .. } if id == "call_edit1"))
        .expect("edit tool part must produce ToolUse with callID as id");
    match &blocks[use_at] {
        MessageBlock::ToolUse { name, input, .. } => {
            assert_eq!(name, "edit");
            assert_eq!(
                input.get("filePath").and_then(|v| v.as_str()),
                Some("/projects/test/src/lib.rs")
            );
        }
        other => panic!("expected ToolUse, got {other:?}"),
    }

    let result_at = blocks
        .iter()
        .position(|b| matches!(b, MessageBlock::ToolResult { tool_use_id, .. } if tool_use_id == "call_edit1"))
        .expect("completed tool part must synthesize ToolResult for pairing");
    match &blocks[result_at] {
        MessageBlock::ToolResult {
            content, is_error, ..
        } => {
            assert_eq!(content, "+ fn new() {}\n- fn old() {}");
            assert!(!is_error);
        }
        other => panic!("expected ToolResult, got {other:?}"),
    }
    // 配对块保持时序相邻（前端 WorkRows 卡片依赖该顺序）
    assert_eq!(result_at, use_at + 1);
}

#[test]
fn should_map_failed_tool_to_error_result() {
    let dir = TempDir::new().unwrap();
    let db_path = create_parts_fixture(&dir);
    let adapter = OpenCodeAdapter;
    let synthetic_path = PathBuf::from(format!("{}#ses-parts", db_path.display()));

    let messages = adapter.parse_messages(&synthetic_path).unwrap();
    assert!(
        messages[0].blocks.iter().any(|b| matches!(
            b,
            MessageBlock::ToolResult { tool_use_id, content, is_error }
                if tool_use_id == "call_bash1" && content == "compile error" && *is_error
        )),
        "error tool part must produce failed ToolResult, got {:?}",
        messages[0].blocks
    );
}

#[test]
fn should_ignore_step_and_patch_parts() {
    let dir = TempDir::new().unwrap();
    let db_path = create_parts_fixture(&dir);
    let adapter = OpenCodeAdapter;
    let synthetic_path = PathBuf::from(format!("{}#ses-parts", db_path.display()));

    let messages = adapter.parse_messages(&synthetic_path).unwrap();
    // step-start/step-finish/patch 是生命周期元数据，不产生内容块；
    // 总块数 = Thinking(1) + Text(1) + ToolUse(2) + ToolResult(2) = 6
    assert_eq!(messages[0].blocks.len(), 6, "{:?}", messages[0].blocks);
}
