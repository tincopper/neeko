//! opencode **v1** 读取路径：`session` / `message` / `part`（升级后的迁移快照）。
//!
//! 行为与双布局改造前逐字一致（`PRD` 的硬约束）：SQL、过滤条件、预览口径、计数口径都不动。
//! 正文解析在 `v1/messages.rs`。

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use rusqlite::Connection;

use super::common::{
    extract_model_id_from_json, normalize_timestamp, PREVIEW_ENRICH_LIMIT, PREVIEW_LIMIT,
    SYNTHETIC_SEP,
};
use crate::conversation::adapter::ParsedMeta;
use crate::conversation::normalize::recent_messages_from;

mod messages;

pub(super) use messages::parse_messages_v1;

/// Parse sessions from an OpenCode SQLite database (v1 layout).
///
/// When `project_path` is set, only rows whose `directory` equals the project or
/// is nested under it are returned (SQL-side filter).
pub(super) fn parse_opencode_db(
    conn: &Connection,
    db_path: &Path,
    project_path: Option<&str>,
) -> Result<Vec<(ParsedMeta, PathBuf)>> {
    // Verify the session table exists
    let has_session_table: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='session'",
            [],
            |_| Ok(true),
        )
        .unwrap_or(false);
    if !has_session_table {
        return Ok(Vec::new());
    }

    // Light discovery: session row only (no correlated COUNT, no part JOIN).
    // Enrichment for preview/count is deferred to the most recent N sessions.
    let (sql, params): (String, Vec<String>) =
        match project_path.map(str::trim).filter(|s| !s.is_empty()) {
            Some(pp) => {
                let base = pp.trim_end_matches('/').to_string();
                let nested_prefix = format!("{base}/");
                (
                    "SELECT s.id, s.title, s.directory, s.time_created, s.time_updated, s.model
                 FROM session s
                 WHERE s.parent_id IS NULL
                   AND s.time_archived IS NULL
                   AND s.directory IS NOT NULL
                   AND (s.directory = ?1 OR s.directory LIKE ?2)
                 ORDER BY s.time_updated DESC"
                        .to_string(),
                    vec![base, format!("{nested_prefix}%")],
                )
            }
            None => (
                "SELECT s.id, s.title, s.directory, s.time_created, s.time_updated, s.model
             FROM session s
             WHERE s.parent_id IS NULL
               AND s.time_archived IS NULL
             ORDER BY s.time_updated DESC"
                    .to_string(),
                Vec::new(),
            ),
        };

    let mut stmt = conn
        .prepare(&sql)
        .context("Failed to prepare session query")?;

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params
        .iter()
        .map(|s| s as &dyn rusqlite::types::ToSql)
        .collect();

    let rows = stmt
        .query_map(param_refs.as_slice(), |row| {
            let id: String = row.get(0)?;
            let title: Option<String> = row.get(1)?;
            let directory: Option<String> = row.get(2)?;
            let time_created: i64 = row.get(3)?;
            let time_updated: i64 = row.get(4)?;
            let model_json: Option<String> = row.get(5)?;
            Ok((id, title, directory, time_created, time_updated, model_json))
        })
        .context("Failed to query sessions")?;

    let counts = count_messages_per_session(conn);
    let mut results = Vec::new();
    for (index, row) in rows.enumerate() {
        let (id, title, directory, time_created, time_updated, model_json) = row?;

        let synthetic_path = PathBuf::from(format!("{}{}{}", db_path.display(), SYNTHETIC_SEP, id));
        let started_at = normalize_timestamp(time_created);
        let updated_at = normalize_timestamp(time_updated);
        let model = model_json.as_deref().and_then(extract_model_id_from_json);

        // 徽标对所有会话都有值（分组聚合一次算完）；预览仍只给最近的 N 个会话。
        let message_count = counts.get(&id).copied().unwrap_or(0);
        let recent_messages = if index < PREVIEW_ENRICH_LIMIT {
            build_preview_messages(conn, &id)
        } else {
            Vec::new()
        };

        let first_user_raw = recent_messages
            .iter()
            .find(|(role, _)| role == "user")
            .map(|(_, text)| text.clone());

        let meta = ParsedMeta {
            native_session_id: id,
            title,
            first_user_message: first_user_raw,
            recent_messages,
            model,
            started_at,
            updated_at,
            message_count,
            project_path: directory,
        };

        results.push((meta, synthetic_path));
    }

    Ok(results)
}

/// COUNT user/assistant messages for one session (list enrich path only).
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
/// 每个会话的正文条数（一次分组聚合，覆盖**全部**会话）。
///
/// 两个必须与 `parse_messages` 对齐的点：
/// - 只算 `user` / `assistant` 角色的消息；
/// - 必须有 part 行（正文取数走 INNER JOIN part，无 part 的消息不会渲染）。
///
/// 早期实现只给最近 `PREVIEW_ENRICH_LIMIT` 个会话计数（其余为 0），导致老会话的
/// 徽标恒为 0 而正文有上千条 —— 徽标与正文必须是同一口径。
pub(super) fn count_messages_per_session(
    conn: &rusqlite::Connection,
) -> std::collections::HashMap<String, u32> {
    let mut counts = std::collections::HashMap::new();
    let Ok(mut stmt) = conn.prepare(
        "SELECT m.session_id, COUNT(*)
         FROM message m
         WHERE json_extract(m.data, '$.role') IN ('user','assistant')
           AND EXISTS (SELECT 1 FROM part p WHERE p.message_id = m.id)
         GROUP BY m.session_id",
    ) else {
        return counts;
    };
    let Ok(rows) = stmt.query_map([], |row| {
        let id: String = row.get(0)?;
        let count: i64 = row.get(1)?;
        Ok((id, count))
    }) else {
        return counts;
    };
    for row in rows.flatten() {
        counts.insert(row.0, row.1.clamp(0, i64::from(u32::MAX)) as u32);
    }
    counts
}

/// Build preview messages for a given session.
pub(super) fn build_preview_messages(
    conn: &rusqlite::Connection,
    session_id: &str,
) -> Vec<(String, String)> {
    let query = conn.prepare(
        "SELECT json_extract(m.data, '$.role') AS role,
                p.data AS part_data,
                p.time_created
         FROM message m
         JOIN part p ON p.message_id = m.id
         WHERE m.session_id = ?1
           AND json_extract(m.data, '$.role') IN ('user','assistant')
           AND json_extract(p.data, '$.type') = 'text'
         ORDER BY p.time_created DESC
         LIMIT ?2",
    );

    let mut stmt = match query {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let rows: Vec<(String, String, i64)> =
        match stmt.query_map([session_id, &PREVIEW_LIMIT.to_string()], |row| {
            let role: String = row.get(0)?;
            let part_data_str: String = row.get(1)?;
            let ts: i64 = row.get(2)?;
            Ok((role, part_data_str, ts))
        }) {
            Ok(r) => r.filter_map(|r| r.ok()).collect(),
            Err(_) => return Vec::new(),
        };

    // Reverse-iterate (query returns newest first, we want oldest-first for the ring buffer)
    let mut pairs: Vec<(String, String)> = Vec::new();
    for (role, part_data_str, _ts) in rows.into_iter().rev() {
        if let Some(text) = extract_part_text(&part_data_str) {
            if !text.trim().is_empty() {
                pairs.push((role, text));
            }
        }
    }

    recent_messages_from(pairs)
}

/// Parse a single session from a synthetic path reference (v1 layout).
pub(super) fn parse_opencode_session(conn: &Connection, session_id: &str) -> Result<ParsedMeta> {
    let row = conn
        .query_row(
            "SELECT s.title, s.directory, s.time_created, s.time_updated,
                s.model, COALESCE(s.tokens_input, 0), COALESCE(s.tokens_output, 0),
                COALESCE(s.tokens_reasoning, 0),
                (SELECT COUNT(*) FROM message m
                 WHERE m.session_id = s.id
                   AND json_extract(m.data, '$.role') IN ('user','assistant')
                ) AS msg_count
         FROM session s
         WHERE s.id = ?1
         LIMIT 1",
            [session_id],
            |row| {
                let title: Option<String> = row.get(0)?;
                let directory: Option<String> = row.get(1)?;
                let time_created: i64 = row.get(2)?;
                let time_updated: i64 = row.get(3)?;
                let model_json: Option<String> = row.get(4)?;
                let tokens_input: i64 = row.get(5)?;
                let tokens_output: i64 = row.get(6)?;
                let tokens_reasoning: i64 = row.get(7)?;
                let msg_count: i64 = row.get(8)?;
                Ok((
                    title,
                    directory,
                    time_created,
                    time_updated,
                    model_json,
                    tokens_input,
                    tokens_output,
                    tokens_reasoning,
                    msg_count,
                ))
            },
        )
        .context("Session not found in OpenCode database")?;

    let (
        title,
        directory,
        time_created,
        time_updated,
        model_json,
        _tokens_input,
        _tokens_output,
        _tokens_reasoning,
        msg_count,
    ) = row;

    let recent_messages = build_preview_messages(conn, session_id);

    let first_user_raw = recent_messages
        .iter()
        .find(|(role, _)| role == "user")
        .map(|(_, text)| text.clone());

    Ok(ParsedMeta {
        native_session_id: session_id.to_string(),
        title,
        first_user_message: first_user_raw,
        recent_messages,
        model: model_json.as_deref().and_then(extract_model_id_from_json),
        started_at: normalize_timestamp(time_created),
        updated_at: normalize_timestamp(time_updated),
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        message_count: msg_count.clamp(0, i64::from(u32::MAX)) as u32,
        project_path: directory,
    })
}

/// Extract text content from a part.data JSON string.
pub(super) fn extract_part_text(part_data: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(part_data).ok()?;
    value
        .get("text")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}
