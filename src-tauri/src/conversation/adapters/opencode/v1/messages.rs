//! v1 正文解析：`message` JOIN `part`，逐 part 映射内容块（迁移前的存储布局）。

use anyhow::{Context, Result};
use rusqlite::Connection;

use super::super::common::extract_model_id_from_json;
use crate::conversation::adapter::ParsedMessage;
use crate::conversation::types::MessageBlock;

/// v1 正文解析：`message` JOIN `part`（迁移前的存储布局，行为保持原样）。
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::type_complexity
)]
pub(crate) fn parse_messages_v1(conn: &Connection, session_id: &str) -> Result<Vec<ParsedMessage>> {
    // Messages with their parts, ordered by time
    let mut stmt = conn
        .prepare(
            "SELECT m.id, json_extract(m.data, '$.role') AS role,
                    m.time_created,
                    json_extract(m.data, '$.model') AS model_json,
                    p.data AS part_data,
                    p.time_created AS part_time
             FROM message m
             JOIN part p ON p.message_id = m.id
             WHERE m.session_id = ?1
               AND json_extract(m.data, '$.role') IN ('user', 'assistant')
             ORDER BY m.time_created ASC, p.time_created ASC",
        )
        .context("Failed to prepare message query")?;

    // Group parts by message
    let mut msg_map: Vec<(String, String, i64, Option<String>, Vec<serde_json::Value>)> =
        Vec::new();

    let rows = stmt
        .query_map([&session_id], |row| {
            let msg_id: String = row.get(0)?;
            let role: String = row.get(1)?;
            let ts: i64 = row.get(2)?;
            let model_json: Option<String> = row.get(3)?;
            let part_data_str: String = row.get(4)?;
            let _part_time: i64 = row.get(5)?;
            let part_data: serde_json::Value =
                serde_json::from_str(&part_data_str).unwrap_or_default();
            Ok((msg_id, role, ts, model_json, part_data))
        })
        .context("Failed to query messages")?
        .filter_map(|r| r.ok());

    for (msg_id, role, ts, model_json, part_data) in rows {
        if let Some(pos) = msg_map.iter().position(|(id, _, _, _, _)| *id == msg_id) {
            msg_map[pos].4.push(part_data);
        } else {
            msg_map.push((msg_id, role, ts, model_json, vec![part_data]));
        }
    }

    // Build ParsedMessages
    let messages: Vec<ParsedMessage> = msg_map
        .into_iter()
        .enumerate()
        .map(|(seq, (_msg_id, role, ts, model_json, parts))| {
            let ts_ms = if ts > 1_000_000_000_000 {
                ts
            } else {
                ts * 1000
            };

            let mut content = String::new();
            let mut blocks: Vec<MessageBlock> = Vec::new();

            for part in &parts {
                let part_type = part.get("type").and_then(|v| v.as_str()).unwrap_or("text");
                match part_type {
                    "text" => {
                        if let Some(text) = part.get("text").and_then(|v| v.as_str()) {
                            if !content.is_empty() {
                                content.push('\n');
                            }
                            content.push_str(text);
                            blocks.push(MessageBlock::Text {
                                text: text.to_string(),
                            });
                        }
                    }
                    // opencode 的思考部件（Claude Code 对应 "thinking"）
                    "reasoning" => {
                        if let Some(text) = part.get("text").and_then(|v| v.as_str()) {
                            blocks.push(MessageBlock::Thinking {
                                thinking: text.to_string(),
                            });
                        }
                    }
                    "tool_use" => {
                        let id = part
                            .get("id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let name = part
                            .get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown")
                            .to_string();
                        let input = part
                            .get("input")
                            .cloned()
                            .unwrap_or(serde_json::Value::Null);
                        blocks.push(MessageBlock::ToolUse { id, name, input });
                    }
                    "tool_result" => {
                        let tool_use_id = part
                            .get("tool_use_id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let text = part.get("text").and_then(|v| v.as_str()).unwrap_or("");
                        let is_error = part
                            .get("is_error")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);
                        blocks.push(MessageBlock::ToolResult {
                            tool_use_id,
                            content: text.to_string(),
                            is_error,
                        });
                    }
                    // opencode 的工具部件：单个 part 自带调用与终态，拆成
                    // ToolUse + ToolResult 成对块，复用前端按 callId 配对
                    // 回填输出/状态的既有管线（historyConvert.pushToolResult）。
                    "tool" => {
                        let call_id = part
                            .get("callID")
                            .and_then(|v| v.as_str())
                            .unwrap_or_default();
                        if call_id.is_empty() {
                            continue;
                        }
                        let name = part
                            .get("tool")
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown");
                        let state = part.get("state");
                        let input = state
                            .and_then(|s| s.get("input"))
                            .cloned()
                            .unwrap_or(serde_json::Value::Null);
                        blocks.push(MessageBlock::ToolUse {
                            id: call_id.to_string(),
                            name: name.to_string(),
                            input,
                        });
                        let status = state.and_then(|s| s.get("status")).and_then(|v| v.as_str());
                        match status {
                            Some("completed") => {
                                let output = state
                                    .and_then(|s| s.get("output"))
                                    .and_then(|v| v.as_str())
                                    .unwrap_or_default();
                                blocks.push(MessageBlock::ToolResult {
                                    tool_use_id: call_id.to_string(),
                                    content: output.to_string(),
                                    is_error: false,
                                });
                            }
                            Some("error") => {
                                let err = state
                                    .and_then(|s| s.get("error"))
                                    .and_then(|v| v.as_str())
                                    .unwrap_or_default();
                                blocks.push(MessageBlock::ToolResult {
                                    tool_use_id: call_id.to_string(),
                                    content: err.to_string(),
                                    is_error: true,
                                });
                            }
                            // pending/running：快照无终态输出，仅保留 ToolUse
                            _ => {}
                        }
                    }
                    _ => {}
                }
            }

            let model = model_json.as_deref().and_then(extract_model_id_from_json);

            ParsedMessage {
                role,
                content,
                blocks,
                model,
                timestamp: ts_ms,
                seq: seq as u32,
            }
        })
        .collect();

    Ok(messages)
}
