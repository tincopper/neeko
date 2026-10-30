//! opencode **v2** 存储读取：`session_v2` + `session_message`。
//!
//! v1（`session`/`message`/`part`）仍由 `opencode.rs` 读取；本模块只管 v2 布局，由
//! `store::detect` 分派（判据与事故背景见 `conversation-adapter.md` §4.3.3）。
//!
//! v2 的行模型（一手实测）：
//! - `user` 行：`data.text` 平铺字符串；
//! - `assistant` 行：`data.content[]` = `{type:text|reasoning|tool}`，模型在 `data.model`；
//! - `system` / `synthetic` / `compaction` / `idle` / `*-switched` 行是元数据，**不是对话回合**。
//!
//! ## 回合判据：类型白名单，不是「有没有可见文本」
//!
//! 白名单 = 全仓唯一的角色白名单 [`CONVERSATION_ROLES`]（§4.6.2）。v2 的 `session_message.type`
//! 与 JSONL 适配器的 `message.role` 是同一组值，所以**不新开常量**：加角色时只改 `shared.rs`，
//! `pi` / `omp` / opencode v2 一起跟上。列表计数、单会话计数、正文解析三处都从它派生 SQL 过滤
//! ⇒ §4.6.3 的「三个用户可见量同源」是结构性成立，而不是靠两处人肉对齐。
//!
//! 为什么不去判「文本非空」：`json_extract(data,'$.content')` 要对 27k 行大 JSON 做解析，实测
//! 9.9s（列表扫描会卡死），而按类型走 `(session_id,type,seq)` 索引是 0.018s。代价是 `content`
//! 为空的 assistant 行（中断的回合，实测 288/24734、涉及 127 个会话）也算一个回合 —— 它们在前端
//! 渲染时被 `ConversationViewer` 的 `hasAnyContent` 跳过，所以看不到空卡片；徽标比 v1 多算这一小类。

mod blocks;
mod query;

#[cfg(test)]
mod tests;

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use rusqlite::Connection;
use serde_json::Value;

use self::blocks::map_content_items;
use self::query::{
    build_preview_messages, count_turns_per_session, first_user_text, session_query, turn_types_in,
};
use super::super::CONVERSATION_ROLES;
use super::common::{
    extract_model_id_from_json, normalize_timestamp, PREVIEW_ENRICH_LIMIT, SYNTHETIC_SEP,
};
use crate::conversation::adapter::{ParsedMessage, ParsedMeta};
use crate::conversation::types::MessageBlock;

/// 「用户」角色：唯一来源仍是 [`CONVERSATION_ROLES`]（`turn_text` / 首条用户消息 / 标题兜底共用）。
const USER_ROLE: &str = CONVERSATION_ROLES[0];

/// 从 v2 数据库读取全部（或某项目下的）会话元数据（回合判据见模块头）。
pub(super) fn parse_db(
    conn: &Connection,
    db_path: &Path,
    project_path: Option<&str>,
) -> Result<Vec<(ParsedMeta, PathBuf)>> {
    let (sql, params) = session_query(project_path);
    let mut stmt = conn
        .prepare(&sql)
        .context("Failed to prepare v2 session query")?;
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params
        .iter()
        .map(|s| s as &dyn rusqlite::types::ToSql)
        .collect();
    let rows = stmt
        .query_map(param_refs.as_slice(), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, Option<String>>(5)?,
            ))
        })
        .context("Failed to query v2 sessions")?;

    let counts = count_turns_per_session(conn);
    let mut results = Vec::new();
    for (index, row) in rows.enumerate() {
        let (id, title, directory, time_created, time_updated, model_json) = row?;
        let message_count = counts.get(&id).copied().unwrap_or(0);
        let recent_messages = if index < PREVIEW_ENRICH_LIMIT {
            build_preview_messages(conn, &id)
        } else {
            Vec::new()
        };
        let synthetic_path = PathBuf::from(format!("{}{}{}", db_path.display(), SYNTHETIC_SEP, id));
        // P3 标题兜底要的是**首条**用户消息，不是预览窗口里最旧的那条 —— 最近 5 个回合可能全是
        // assistant（实测有条会话 3 条 user 但一条都不在窗口内），那就退化成 `opencode <id8>`。
        let first_user_message = if index < PREVIEW_ENRICH_LIMIT {
            first_user_text(conn, &id)
        } else {
            None
        };

        results.push((
            ParsedMeta {
                native_session_id: id,
                title,
                first_user_message,
                recent_messages,
                model: model_json.as_deref().and_then(extract_model_id_from_json),
                started_at: normalize_timestamp(time_created),
                updated_at: normalize_timestamp(time_updated),
                message_count,
                project_path: directory,
            },
            synthetic_path,
        ));
    }

    Ok(results)
}

/// 读取单条会话的元数据（v1 的 `parse_opencode_session` 的 v2 对应实现）。
///
/// 计数用与列表、正文**同一个**判据（`CONVERSATION_ROLES`），否则侧栏徽标会和正文条数不一致。
pub(super) fn parse_session_meta(conn: &Connection, session_id: &str) -> Result<ParsedMeta> {
    let sql = format!(
        "SELECT v.title, v.directory, v.time_created, v.time_updated, v.model,
                (SELECT COUNT(*) FROM session_message sm
                 WHERE sm.session_id = v.id AND {}) AS msg_count
         FROM session_v2 v
         WHERE v.id = ?1
         LIMIT 1",
        turn_types_in("sm.type")
    );
    let row = conn
        .query_row(&sql, [session_id], |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, i64>(5)?,
            ))
        })
        .context("Session not found in OpenCode v2 database")?;

    let (title, directory, time_created, time_updated, model_json, msg_count) = row;
    let recent_messages = build_preview_messages(conn, session_id);
    let first_user_message = first_user_text(conn, session_id);

    Ok(ParsedMeta {
        native_session_id: session_id.to_string(),
        title,
        first_user_message,
        recent_messages,
        model: model_json.as_deref().and_then(extract_model_id_from_json),
        started_at: normalize_timestamp(time_created),
        updated_at: normalize_timestamp(time_updated),
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        message_count: msg_count.clamp(0, i64::from(u32::MAX)) as u32,
        project_path: directory,
    })
}

/// 读取一条会话的完整正文（块级）。
pub(super) fn parse_messages(conn: &Connection, session_id: &str) -> Result<Vec<ParsedMessage>> {
    let sql = format!(
        "SELECT type, time_created, json_extract(data, '$.model') AS model_json, data
         FROM session_message
         WHERE session_id = ?1 AND {}
         ORDER BY seq ASC",
        turn_types_in("type")
    );
    let mut stmt = conn
        .prepare(&sql)
        .context("Failed to prepare v2 message query")?;
    let rows = stmt
        .query_map([session_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .context("Failed to query v2 messages")?;

    let mut messages = Vec::new();
    for (index, row) in rows.enumerate() {
        let (kind, time_created, model_json, data_str) = row?;
        let data: Value = serde_json::from_str(&data_str).unwrap_or_default();
        let (content, blocks) = if kind == "user" {
            let text = data
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let blocks = if text.trim().is_empty() {
                Vec::new()
            } else {
                vec![MessageBlock::Text { text: text.clone() }]
            };
            (text, blocks)
        } else {
            map_content_items(data.get("content").and_then(Value::as_array))
        };

        messages.push(ParsedMessage {
            role: kind,
            content,
            blocks,
            model: model_json.as_deref().and_then(extract_model_id_from_json),
            timestamp: normalize_timestamp(time_created),
            #[allow(clippy::cast_possible_truncation)]
            seq: index as u32,
        });
    }

    Ok(messages)
}
