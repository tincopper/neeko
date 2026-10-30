//! v2 的 `data` JSON → 文本 + 块映射（`text` / `reasoning` / `tool` 方言的唯一实现处）。
//!
//! 与 v1 的 part 映射同形，前端按 callId 配对的既有管线不变（§4.6.1 的 opencode 例外）。

use serde_json::Value;

use super::USER_ROLE;
use crate::conversation::types::MessageBlock;

/// 一条回合里可以进预览的文本：user 的 `text`，assistant 的 `content[].type=="text"`。
pub(super) fn turn_text(kind: &str, data: &Value) -> Option<String> {
    match kind {
        USER_ROLE => data.get("text").and_then(Value::as_str).map(str::to_string),
        "assistant" => {
            let items = data.get("content").and_then(Value::as_array)?;
            let joined = items
                .iter()
                .filter_map(|item| match item.get("type").and_then(Value::as_str) {
                    Some("text") => item.get("text").and_then(Value::as_str),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("\n");
            (!joined.is_empty()).then_some(joined)
        }
        _ => None,
    }
}

/// `content[]` → 扁平文本 + 块（与 v1 的 part 映射同形，前端按 callId 配对的既有管线不变）。
pub(super) fn map_content_items(items: Option<&Vec<Value>>) -> (String, Vec<MessageBlock>) {
    let mut content = String::new();
    let mut blocks = Vec::new();
    for item in items.into_iter().flatten() {
        match item.get("type").and_then(Value::as_str).unwrap_or_default() {
            "text" => {
                if let Some(text) = item.get("text").and_then(Value::as_str) {
                    if !content.is_empty() {
                        content.push('\n');
                    }
                    content.push_str(text);
                    blocks.push(MessageBlock::Text {
                        text: text.to_string(),
                    });
                }
            }
            // v2 的思考项（v1 对应 part type = "reasoning"）
            "reasoning" => {
                if let Some(text) = item.get("text").and_then(Value::as_str) {
                    blocks.push(MessageBlock::Thinking {
                        thinking: text.to_string(),
                    });
                }
            }
            "tool" => push_tool_blocks(item, &mut blocks),
            _ => {}
        }
    }
    (content, blocks)
}

/// 工具项自带调用与终态，拆成 `ToolUse` + `ToolResult` 成对块。
pub(super) fn push_tool_blocks(item: &Value, blocks: &mut Vec<MessageBlock>) {
    let Some(call_id) = item
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
    else {
        return;
    };
    let name = item
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let state = item.get("state");
    let input = state
        .and_then(|s| s.get("input"))
        .cloned()
        .unwrap_or(Value::Null);
    blocks.push(MessageBlock::ToolUse {
        id: call_id.to_string(),
        name,
        input,
    });

    let tool_use_id = call_id.to_string();
    match state.and_then(|s| s.get("status")).and_then(Value::as_str) {
        Some("completed") => blocks.push(MessageBlock::ToolResult {
            tool_use_id,
            content: tool_output_text(state),
            is_error: false,
        }),
        Some("error") => blocks.push(MessageBlock::ToolResult {
            tool_use_id,
            content: state
                .and_then(|s| s.get("error"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            is_error: true,
        }),
        // pending / running：快照没有终态输出，只保留 ToolUse
        _ => {}
    }
}

/// completed 工具的输出：`state.content[]` 里 `type=="text"` 的项拼接（file 项是附件，不含文本）。
pub(super) fn tool_output_text(state: Option<&Value>) -> String {
    let Some(items) = state
        .and_then(|s| s.get("content"))
        .and_then(Value::as_array)
    else {
        return String::new();
    };
    items
        .iter()
        .filter_map(|item| item.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n")
}
