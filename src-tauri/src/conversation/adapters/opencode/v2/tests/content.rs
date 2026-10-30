//! 计数同源（§4.6.3）、块映射、单会话 meta。

use super::super::*;
use super::fixtures::*;
use tempfile::TempDir;

/// §4.6.3 的硬契约：列表徽标与正文条数必须是同一口径。
#[test]
fn message_count_matches_parsed_message_count() {
    let dir = TempDir::new().unwrap();
    let path = create_v2_fixture(&dir);
    let conn = open(&path);

    for (meta, _) in parse_db(&conn, &path, None).unwrap() {
        let parsed = parse_messages(&conn, &meta.native_session_id).unwrap();
        assert_eq!(
            meta.message_count,
            u32::try_from(parsed.len()).unwrap(),
            "会话 {} 的徽标与正文条数不一致",
            meta.native_session_id
        );
    }
}

#[test]
fn counts_only_conversation_turns() {
    let dir = TempDir::new().unwrap();
    let path = create_v2_fixture(&dir);
    let conn = open(&path);

    let metas = parse_db(&conn, &path, None).unwrap();
    let main = metas
        .iter()
        .find(|(m, _)| m.native_session_id == "ses_main")
        .map(|(m, _)| m)
        .unwrap();

    // user, assistant, assistant, assistant(空 content), user —— system/compaction 不算
    assert_eq!(main.message_count, 5);
}

#[test]
fn parses_messages_in_seq_order_and_skips_metadata_rows() {
    let dir = TempDir::new().unwrap();
    let path = create_v2_fixture(&dir);
    let conn = open(&path);

    let messages = parse_messages(&conn, "ses_main").unwrap();

    assert_eq!(messages.len(), 5);
    assert_eq!(
        messages.iter().map(|m| m.role.as_str()).collect::<Vec<_>>(),
        vec!["user", "assistant", "assistant", "assistant", "user"]
    );
    assert_eq!(messages[0].content, "用户提问");
    assert_eq!(messages[4].content, "继续");
    // 空 content 的 assistant 仍是回合（与计数同源），只是没有块
    assert!(messages[3].blocks.is_empty());
}

#[test]
fn maps_content_items_to_text_thinking_and_tool_blocks() {
    let dir = TempDir::new().unwrap();
    let path = create_v2_fixture(&dir);
    let conn = open(&path);

    let messages = parse_messages(&conn, "ses_main").unwrap();
    let assistant = &messages[1];

    assert_eq!(assistant.content, "我来执行", "扁平文本只含 text 项");
    assert!(
        assistant
            .blocks
            .iter()
            .any(|b| matches!(b, MessageBlock::Thinking { thinking } if thinking == "先分析")),
        "reasoning 必须映射为 Thinking，got {:?}",
        assistant.blocks
    );
    assert!(assistant
        .blocks
        .iter()
        .any(|b| matches!(b, MessageBlock::Text { text } if text == "我来执行")));
    let call_id = assistant
        .blocks
        .iter()
        .find_map(|b| match b {
            MessageBlock::ToolUse { id, name, .. } if name == "bash" => Some(id.clone()),
            _ => None,
        })
        .expect("completed tool 必须产生 ToolUse");
    assert_eq!(call_id, "call_1");
    assert!(
        assistant.blocks.iter().any(|b| matches!(
            b,
            MessageBlock::ToolResult { tool_use_id, content, is_error }
                if tool_use_id == "call_1" && content == "file-a\nfile-b" && !*is_error
        )),
        "completed tool 的 state.content[].text 必须拼成 ToolResult，got {:?}",
        assistant.blocks
    );
    assert_eq!(assistant.model.as_deref(), Some("glm-5"));
}

#[test]
fn maps_failed_tool_to_error_result() {
    let dir = TempDir::new().unwrap();
    let path = create_v2_fixture(&dir);
    let conn = open(&path);

    let messages = parse_messages(&conn, "ses_main").unwrap();
    let failed = &messages[2];

    assert!(
        failed.blocks.iter().any(|b| matches!(
            b,
            MessageBlock::ToolResult { tool_use_id, content, is_error }
                if tool_use_id == "call_2" && content == "no such file" && *is_error
        )),
        "error 状态的 state.error 必须变成 is_error 的 ToolResult，got {:?}",
        failed.blocks
    );
}

#[test]
fn parse_session_meta_agrees_with_list() {
    let dir = TempDir::new().unwrap();
    let path = create_v2_fixture(&dir);
    let conn = open(&path);

    let meta = parse_session_meta(&conn, "ses_main").unwrap();
    let listed = parse_db(&conn, &path, None)
        .unwrap()
        .into_iter()
        .find(|(m, _)| m.native_session_id == "ses_main")
        .map(|(m, _)| m)
        .unwrap();

    assert_eq!(meta.message_count, listed.message_count);
    assert_eq!(meta.title, listed.title);
    assert_eq!(meta.model, listed.model);
}

#[test]
fn missing_session_is_an_error() {
    let dir = TempDir::new().unwrap();
    let path = create_v2_fixture(&dir);
    let conn = open(&path);

    assert!(parse_session_meta(&conn, "ses_nope").is_err());
}

#[test]
fn synthetic_path_keeps_db_and_session_id() {
    let dir = TempDir::new().unwrap();
    let path = create_v2_fixture(&dir);
    let conn = open(&path);

    let metas = parse_db(&conn, &path, None).unwrap();
    let (_, synthetic) = &metas[0];

    assert_eq!(
        synthetic.to_string_lossy(),
        format!("{}{}{}", path.display(), SYNTHETIC_SEP, "ses_main")
    );
}
