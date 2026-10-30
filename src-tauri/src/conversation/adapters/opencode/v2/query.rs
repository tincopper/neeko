//! v2 的 SQL 层：列表 / 计数 / 预览 / 标题兜底素材的查询。
//!
//! 与 `blocks.rs` 分开：这一层只认识表与索引（`session_v2` / `session_message`），不判断
//! `data` 里的内容形态；预览取出的行仍交给 `blocks::turn_text` 提取文本。

use std::collections::HashMap;

use rusqlite::Connection;
use serde_json::Value;

use super::super::super::CONVERSATION_ROLES;
use super::super::common::PREVIEW_LIMIT;
use super::blocks::turn_text;
use super::USER_ROLE;
use crate::conversation::normalize::recent_messages_from;

/// 会话列表 SQL：只取顶层（非子会话）、未归档的行，按最近更新倒序。
pub(super) fn session_query(project_path: Option<&str>) -> (String, Vec<String>) {
    const COLUMNS: &str =
        "SELECT v.id, v.title, v.directory, v.time_created, v.time_updated, v.model
         FROM session_v2 v
         WHERE v.parent_id IS NULL
           AND v.time_archived IS NULL";
    match project_path.map(str::trim).filter(|s| !s.is_empty()) {
        Some(project) => {
            let base = project.trim_end_matches('/').to_string();
            (
                format!(
                    "{COLUMNS}
                       AND v.directory IS NOT NULL
                       AND (v.directory = ?1 OR v.directory LIKE ?2)
                     ORDER BY v.time_updated DESC"
                ),
                vec![base.clone(), format!("{base}/%")],
            )
        }
        None => (
            format!("{COLUMNS} ORDER BY v.time_updated DESC"),
            Vec::new(),
        ),
    }
}

/// `type IN ('user','assistant')` —— 白名单的唯一来源是 `CONVERSATION_ROLES`。
/// 列名只接受字面量（只有 `type` / `sm.type` 两个调用点），避免将来被运行时值污染 SQL。
pub(super) fn turn_types_in(column: &'static str) -> String {
    let quoted: Vec<String> = CONVERSATION_ROLES
        .iter()
        .map(|t| format!("'{t}'"))
        .collect();
    format!("{column} IN ({})", quoted.join(","))
}

/// 每个会话的对话回合计（一次分组聚合，覆盖**全部**会话）。
///
/// 走 `(session_id, type, seq)` 索引；不能改成 `json_extract(content)` 判可见性 —— 实测 9.9s，
/// 列表扫描会卡住（权衡写在模块头的「回合判据」一节）。
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
pub(super) fn count_turns_per_session(conn: &Connection) -> HashMap<String, u32> {
    let mut counts = HashMap::new();
    let sql = format!(
        "SELECT session_id, COUNT(*)
         FROM session_message
         WHERE {}
         GROUP BY session_id",
        turn_types_in("type")
    );
    let Ok(mut stmt) = conn.prepare(&sql) else {
        log::warn!("[opencode/v2] 计数查询失败，徽标将退化为 0（正文仍可读）：{sql}");
        return counts;
    };
    let Ok(rows) = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    }) else {
        log::warn!("[opencode/v2] 计数查询执行失败，徽标将退化为 0");
        return counts;
    };
    for row in rows.flatten() {
        counts.insert(row.0, row.1.clamp(0, i64::from(u32::MAX)) as u32);
    }
    counts
}

/// 最近 `PREVIEW_LIMIT` 条**文本**（工具输出与 thinking 不进预览）。
pub(super) fn build_preview_messages(conn: &Connection, session_id: &str) -> Vec<(String, String)> {
    let sql = format!(
        "SELECT type, data
         FROM session_message
         WHERE session_id = ?1 AND {}
         ORDER BY seq DESC
         LIMIT ?2",
        turn_types_in("type")
    );
    let Ok(mut stmt) = conn.prepare(&sql) else {
        log::warn!("[opencode/v2] 预览查询失败，列表预览将为空");
        return Vec::new();
    };
    // 多取一段窗口：最近 N 个回合里可能有工具/思考/空回合（无文本），v1 是先把
    // `part.type='text'` 压进 SQL 再 LIMIT，所以稳定拿满 5 条。这里同样要拿满 —— 取
    // `PREVIEW_LIMIT * 3` 行、凑够 `PREVIEW_LIMIT` 条文本即停，成本随实际行数收敛。
    let window = i64::from(PREVIEW_LIMIT) * 3;
    let rows = match stmt.query_map(rusqlite::params![session_id, window], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    }) {
        Ok(rows) => rows,
        Err(e) => {
            log::warn!("[opencode/v2] 预览查询执行失败，列表预览将为空：{e}");
            return Vec::new();
        }
    };

    // 查询按 seq 倒序（新→旧）；凑满即停，最后反转成 `recent_messages_from` 需要的正序。
    let mut pairs_newest_first = Vec::new();
    for row in rows.flatten() {
        let (kind, data_str) = row;
        let data: Value = serde_json::from_str(&data_str).unwrap_or_default();
        let Some(text) = turn_text(&kind, &data) else {
            continue;
        };
        let text = text.trim();
        if text.is_empty() {
            continue;
        }
        pairs_newest_first.push((kind, text.to_string()));
        if pairs_newest_first.len() >= PREVIEW_LIMIT as usize {
            break;
        }
    }
    pairs_newest_first.reverse();
    recent_messages_from(pairs_newest_first)
}

/// 会话的**首条**用户消息（P3 标题兜底的素材，与 `recent_messages` 无关）。
///
/// 走 `(session_id, type, seq)` 索引的 `ORDER BY seq ASC LIMIT 1`，只对进入预览窗口的会话调用。
pub(super) fn first_user_text(conn: &Connection, session_id: &str) -> Option<String> {
    // 角色走绑定参数，不拼进 SQL 字面量 —— 引号形态（`"user"` 在 SQLite 里是标识符引号，
    // 只靠 deprecated 的 DQS 回退才当字符串）不值得赌。
    let mut stmt = conn
        .prepare(
            "SELECT data FROM session_message
             WHERE session_id = ?1 AND type = ?2
             ORDER BY seq ASC
             LIMIT 1",
        )
        .ok()?;
    let data_str: String = stmt
        .query_row([session_id, USER_ROLE], |row| row.get(0))
        .ok()?;
    let data: Value = serde_json::from_str(&data_str).unwrap_or_default();
    let text = data.get("text").and_then(Value::as_str)?.trim();
    (!text.is_empty()).then(|| text.to_string())
}
