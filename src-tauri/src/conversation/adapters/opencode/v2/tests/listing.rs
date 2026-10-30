//! 列表 / 项目过滤 / 预览 / 标题兜底素材（都走 `parse_db`）。

use super::super::*;
use super::fixtures::*;
use tempfile::TempDir;

#[test]
fn lists_top_level_unarchived_sessions_newest_first() {
    let dir = TempDir::new().unwrap();
    let path = create_v2_fixture(&dir);
    let conn = open(&path);

    let metas = parse_db(&conn, &path, None).unwrap();

    assert_eq!(
        ids(&metas),
        vec!["ses_main", "ses_untitled", "ses_other", "ses_nested"],
        "子会话 / 归档必须排除，按 time_updated 倒序"
    );
}

#[test]
fn filters_by_project_directory_and_nested_prefix() {
    let dir = TempDir::new().unwrap();
    let path = create_v2_fixture(&dir);
    let conn = open(&path);

    let metas = parse_db(&conn, &path, Some("/proj")).unwrap();

    assert_eq!(ids(&metas), vec!["ses_main", "ses_untitled", "ses_nested"]);
}

#[test]
fn parses_model_and_timestamps() {
    let dir = TempDir::new().unwrap();
    let path = create_v2_fixture(&dir);
    let conn = open(&path);

    let metas = parse_db(&conn, &path, None).unwrap();
    let main = metas
        .iter()
        .find(|(m, _)| m.native_session_id == "ses_main")
        .map(|(m, _)| m)
        .unwrap();

    assert_eq!(main.model.as_deref(), Some("glm-5"));
    assert_eq!(main.title.as_deref(), Some("主会话"));
    assert_eq!(main.project_path.as_deref(), Some("/proj"));
    assert_eq!(main.updated_at, T0 + 300);
    assert_eq!(main.started_at, T0);
}

#[test]
fn untitled_session_falls_back_to_first_user_message() {
    let dir = TempDir::new().unwrap();
    let path = create_v2_fixture(&dir);
    let conn = open(&path);

    let metas = parse_db(&conn, &path, None).unwrap();
    let untitled = metas
        .iter()
        .find(|(m, _)| m.native_session_id == "ses_untitled")
        .map(|(m, _)| m)
        .unwrap();

    assert!(untitled.title.is_none());
    assert_eq!(
        untitled.first_user_message.as_deref(),
        Some("标题只能靠这条")
    );
}

#[test]
fn preview_uses_text_items_only() {
    let dir = TempDir::new().unwrap();
    let path = create_v2_fixture(&dir);
    let conn = open(&path);

    let metas = parse_db(&conn, &path, None).unwrap();
    let main = metas
        .iter()
        .find(|(m, _)| m.native_session_id == "ses_main")
        .map(|(m, _)| m)
        .unwrap();

    let preview_text = main
        .recent_messages
        .iter()
        .map(|(_, text)| text.as_str())
        .collect::<Vec<_>>()
        .join("|");
    assert!(preview_text.contains("用户提问"), "got {preview_text}");
    assert!(preview_text.contains("我来执行"), "got {preview_text}");
    assert!(preview_text.contains("继续"), "got {preview_text}");
    assert!(
        !preview_text.contains("先分析"),
        "thinking 不进预览: {preview_text}"
    );
    assert!(
        !preview_text.contains("file-a"),
        "工具输出不进预览: {preview_text}"
    );
    assert!(
        !preview_text.contains("系统提示"),
        "system 行不进预览: {preview_text}"
    );
}

/// 预览窗口必须能跨过「无文本回合」：v1 把 `part.type='text'` 压进 SQL 再 LIMIT，
/// 所以稳定拿满 5 条；v2 只在 Rust 侧过滤，窗口太小会让预览变短甚至变空。
#[test]
fn preview_window_reaches_past_tool_only_turns() {
    let dir = TempDir::new().unwrap();
    let path = create_v2_fixture(&dir);
    let conn = open(&path);

    // 8 个只含工具的 assistant 回合盖在两条旧文本回合之上
    conn.execute(
        "INSERT INTO session_v2 (id, parent_id, directory, title, model, time_created,
             time_updated, time_archived, tokens_input, tokens_output, tokens_reasoning)
         VALUES ('ses_tools', NULL, '/proj', '工具洪水', NULL, ?1, ?1, NULL, 0, 0, 0)",
        rusqlite::params![T0],
    )
    .unwrap();
    let mut seq = 0;
    for text in ["早期提问A", "早期提问B"] {
        conn.execute(
            "INSERT INTO session_message (id, session_id, type, seq, time_created, data)
             VALUES (?1, 'ses_tools', 'user', ?2, ?3, ?4)",
            rusqlite::params![
                format!("tools_msg_{seq}"),
                seq,
                T0 + seq,
                format!(r#"{{"text":"{text}"}}"#)
            ],
        )
        .unwrap();
        seq += 1;
    }
    for _ in 0..8 {
        conn.execute(
            "INSERT INTO session_message (id, session_id, type, seq, time_created, data)
             VALUES (?1, 'ses_tools', 'assistant', ?2, ?3, ?4)",
            rusqlite::params![
                format!("tools_msg_{seq}"),
                seq,
                T0 + seq,
                r#"{"content":[{"type":"tool","id":"call_x","name":"bash","state":{"status":"completed","input":{},"content":[{"type":"text","text":"输出"}]}}]}"#
            ],
        )
        .unwrap();
        seq += 1;
    }

    let metas = parse_db(&conn, &path, Some("/proj")).unwrap();
    let session = metas
        .iter()
        .find(|(m, _)| m.native_session_id == "ses_tools")
        .map(|(m, _)| m)
        .unwrap();
    let preview = session
        .recent_messages
        .iter()
        .map(|(_, text)| text.as_str())
        .collect::<Vec<_>>();

    assert!(
        preview.contains(&"早期提问B"),
        "窗口必须越过 8 个工具回合才拿得到文本，got {preview:?}"
    );
    assert!(
        !preview.iter().any(|t| t.contains("输出")),
        "工具输出不进预览"
    );
}

/// P3 标题兜底要的是**首条**用户消息：它可能在预览窗口（最近 5 个回合）之外，
/// 从窗口里找会拿到 None（标题退化成 `opencode <id8>`）或拿到一条近期消息。
#[test]
fn first_user_message_comes_from_the_earliest_turn_not_the_preview_window() {
    let dir = TempDir::new().unwrap();
    let path = create_v2_fixture(&dir);
    let conn = open(&path);
    conn.execute(
        "INSERT INTO session_v2 (id, parent_id, directory, title, model, time_created,
             time_updated, time_archived, tokens_input, tokens_output, tokens_reasoning)
         VALUES ('ses_long', NULL, '/proj', NULL, NULL, ?1, ?1, NULL, 0, 0, 0)",
        rusqlite::params![T0],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO session_message (id, session_id, type, seq, time_created, data)
         VALUES ('long_0', 'ses_long', 'user', 0, ?1, '{\"text\":\"最早提问\"}')",
        rusqlite::params![T0],
    )
    .unwrap();
    for seq in 1..=6 {
        conn.execute(
            "INSERT INTO session_message (id, session_id, type, seq, time_created, data)
             VALUES (?1, 'ses_long', 'assistant', ?2, ?3, ?4)",
            rusqlite::params![
                format!("long_{seq}"),
                seq,
                T0 + seq,
                format!(r#"{{"content":[{{"type":"text","text":"回复{seq}"}}]}}"#)
            ],
        )
        .unwrap();
    }

    let metas = parse_db(&conn, &path, Some("/proj")).unwrap();
    let session = metas
        .iter()
        .find(|(m, _)| m.native_session_id == "ses_long")
        .map(|(m, _)| m)
        .unwrap();

    assert_eq!(
        session.first_user_message.as_deref(),
        Some("最早提问"),
        "首条用户消息必须在，即使它已滑出预览窗口"
    );
    assert!(
        !session
            .recent_messages
            .iter()
            .any(|(role, _)| role == "user"),
        "前提：预览窗口里确实没有 user 回合，got {:?}",
        session.recent_messages
    );
}
