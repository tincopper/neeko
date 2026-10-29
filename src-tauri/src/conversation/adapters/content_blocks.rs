//! Anthropic 风格内容块抽取（Pi / Claude Code / OMP 共用的「块数组」方言）。
//!
//! 适配器的唯一职责是「原生格式 → canonical 契约」映射，而不是各自实现一遍格式识别。
//! 这些 agent 都把 `message.content` 写成「纯字符串」或「块数组」，本模块把两种表示
//! 收敛成一个一等公民 [`MessageContent`]：
//!
//! - [`MessageContent::text`]：人类可读文本（text 块 + `<thinking>` 包裹 + 🔧 tool 标记），
//!   供标题（P3 首条用户消息）、列表预览与纯文本导出使用；
//! - [`MessageContent::blocks`]：结构化块，供前端按块渲染（思考折叠、工具卡片配对）。
//!
//! **方言差异只允许出现在 [`block_kind`] 的别名表与 [`tool_input`] 里**，新增同类 agent
//! 时加别名即可，不得再复制一份抽取逻辑。
//!
//! 两处刻意约束：
//!
//! 1. `tool_result` 只映射为结构化块，**不并入** `text`。工具输出体量不可控，并入正文会
//!    撞上 IPC 载荷边界（红线 4），也会让「工具结果」在正文视图里冒充用户发言。
//! 2. 媒体块（image 等）不产出文本：图片走附件通道，占位符只会污染标题与预览。

use crate::conversation::text::truncate;
use crate::conversation::types::MessageBlock;

/// 单条记录内容的两视图（纯文本 + 结构化块），一次遍历同时得到。
#[derive(Debug, Clone, Default)]
pub(crate) struct MessageContent {
    /// 人类可读文本（标题 / 预览 / 导出用）
    pub text: String,
    /// 结构化内容块（前端渲染用）
    pub blocks: Vec<MessageBlock>,
}

impl MessageContent {
    /// 标量字符串内容的等价视图：一段文本块。
    fn from_text(text: impl Into<String>) -> Self {
        let text = text.into();
        Self {
            blocks: vec![MessageBlock::Text { text: text.clone() }],
            text,
        }
    }
}

/// 从一行会话记录中抽取内容（记录形态：`{"message": ...}`）。
///
/// 无 `message` 字段的记录（`session` / `model_change` 等元数据行）返回空内容。
pub(crate) fn extract_message_content(entry: &serde_json::Value) -> MessageContent {
    entry
        .get("message")
        .map_or_else(MessageContent::default, |message| {
            match content_source(message) {
                ContentSource::Scalar(text) | ContentSource::Plain(text) => {
                    MessageContent::from_text(text)
                }
                // 数组分支不回落：块数组是权威表示，块内没有可读内容就是空（例如纯图片消息）
                ContentSource::Parts(parts) => content_from_parts(parts),
                ContentSource::Missing => MessageContent::default(),
            }
        })
}

/// 轻量判定：这条记录是否会产出可见正文。
///
/// 列表行（`parse_meta`）只需要「这条算不算一条对话消息」，不需要结构化块 ——
/// 用全量抽取去做这件事会让扫描成本正比于整个会话正文（历史事故：pi 列表扫描 3.3× 回归）。
/// 两个入口共用同一张 [`block_kind`] 方言表，等价性由 `tests::should_agree_with_full_extraction` 钉住。
pub(crate) fn has_visible_text(entry: &serde_json::Value) -> bool {
    let Some(message) = entry.get("message") else {
        return false;
    };
    match content_source(message) {
        ContentSource::Scalar(text) | ContentSource::Plain(text) => !text.trim().is_empty(),
        ContentSource::Parts(parts) => parts
            .iter()
            .any(|part| rendered_text(part).is_some_and(|text| !text.trim().is_empty())),
        ContentSource::Missing => false,
    }
}

/// `message` 的文本载体形态（各 agent 方言的统一入口）。
enum ContentSource<'a> {
    /// `message` 本身是字符串（Claude Code 旧格式的 user 消息）
    Scalar(&'a str),
    /// `message.content` 是块数组（Pi / Claude Code / OMP 主流格式）
    Parts(&'a [serde_json::Value]),
    /// `message.content` 或 `message.text` 是字符串
    Plain(&'a str),
    Missing,
}

fn content_source(message: &serde_json::Value) -> ContentSource<'_> {
    if let Some(text) = message.as_str() {
        return ContentSource::Scalar(text);
    }
    match message.get("content") {
        Some(serde_json::Value::Array(parts)) => ContentSource::Parts(parts),
        Some(serde_json::Value::String(text)) => ContentSource::Plain(text),
        _ => message
            .get("text")
            .and_then(serde_json::Value::as_str)
            .map_or(ContentSource::Missing, ContentSource::Plain),
    }
}

/// 单个块的人类可读文本，**不构建** [`MessageBlock`]。
///
/// 与 [`block_from_part`]（构建结构化块）+ [`block_text`]（块 → 文本）同构，
/// 两条路径的一致性由单元测试守护。
fn rendered_text(part: &serde_json::Value) -> Option<String> {
    let block_type = part
        .get("type")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();

    match block_kind(block_type) {
        BlockKind::Text | BlockKind::Unknown => str_field(part, "text"),
        BlockKind::Thinking => thinking_field(part)
            .filter(|thinking| !thinking.is_empty())
            .map(|thinking| format!("<thinking>\n{thinking}\n</thinking>")),
        // tool 调用总有可读文本（名称 + 入参预览）
        BlockKind::ToolUse => Some(format_tool_use(
            str_field(part, "name")
                .unwrap_or_else(|| "unknown".to_string())
                .as_str(),
            &tool_input(part),
        )),
        // 见模块文档约束 1（工具输出不并入正文）
        BlockKind::ToolResult | BlockKind::Media => None,
    }
}

/// 块数组 → 结构化块 + 拍平文本。
fn content_from_parts(parts: &[serde_json::Value]) -> MessageContent {
    let blocks: Vec<MessageBlock> = parts.iter().filter_map(block_from_part).collect();
    let text = blocks
        .iter()
        .filter_map(block_text)
        .collect::<Vec<_>>()
        .join("\n\n");
    MessageContent { text, blocks }
}

/// 内容块语义（跨 agent 的统一分类）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BlockKind {
    Text,
    Thinking,
    ToolUse,
    ToolResult,
    Media,
    Unknown,
}

/// 块 `type` 别名表 —— 各 agent 方言差异的唯一落点。
fn block_kind(block_type: &str) -> BlockKind {
    match block_type {
        "text" | "input_text" | "output_text" => BlockKind::Text,
        // `redacted_thinking` 只带加密载荷（无 thinking/text 字段），分类在此、
        // 由字段缺失自然丢弃，避免它落进 `Unknown` 被误当正文。
        "thinking" | "redacted_thinking" | "reasoning" => BlockKind::Thinking,
        "tool_use" | "toolCall" | "tool_call" | "function_call" => BlockKind::ToolUse,
        "tool_result" | "toolResult" => BlockKind::ToolResult,
        "image" | "image_url" | "document" => BlockKind::Media,
        _ => BlockKind::Unknown,
    }
}

/// 单个块 → 结构化块。
fn block_from_part(part: &serde_json::Value) -> Option<MessageBlock> {
    let block_type = part
        .get("type")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();

    match block_kind(block_type) {
        BlockKind::Text => str_field(part, "text").map(|text| MessageBlock::Text { text }),
        BlockKind::Thinking => {
            thinking_field(part).map(|thinking| MessageBlock::Thinking { thinking })
        }
        BlockKind::ToolUse => Some(MessageBlock::ToolUse {
            id: str_field(part, "id").unwrap_or_default(),
            name: str_field(part, "name").unwrap_or_else(|| "unknown".to_string()),
            input: tool_input(part),
        }),
        BlockKind::ToolResult => Some(MessageBlock::ToolResult {
            tool_use_id: str_field(part, "tool_use_id")
                .or_else(|| str_field(part, "toolCallId"))
                .unwrap_or_default(),
            content: tool_result_content(part),
            is_error: is_error_flag(part),
        }),
        // 媒体块没有文本语义（图片走附件通道）
        BlockKind::Media => None,
        // 未知块：带 `text` 字段则按文本处理（宁可见、不可静默丢内容），否则丢弃
        BlockKind::Unknown => str_field(part, "text").map(|text| MessageBlock::Text { text }),
    }
}

/// 结构化块 → 人类可读文本（`None` = 该块不参与纯文本视图）。
fn block_text(block: &MessageBlock) -> Option<String> {
    match block {
        MessageBlock::Text { text } => Some(text.clone()),
        MessageBlock::Thinking { thinking } => {
            (!thinking.is_empty()).then(|| format!("<thinking>\n{thinking}\n</thinking>"))
        }
        MessageBlock::ToolUse { name, input, .. } => Some(format_tool_use(name, input)),
        // 见模块文档约束 1
        MessageBlock::ToolResult { .. } => None,
    }
}

/// 🔧 tool 调用标记（`normalize::strip_tool_call_patterns` 在预览目标下会剥掉它）。
fn format_tool_use(name: &str, input: &serde_json::Value) -> String {
    let raw = match input {
        // 方言：Pi 的 `arguments` 是已序列化字符串，原样呈现比二次 JSON 转义可读
        serde_json::Value::String(raw) => raw.clone(),
        serde_json::Value::Null => String::new(),
        structured => serde_json::to_string_pretty(structured).unwrap_or_default(),
    };
    format!("🔧 `{name}`\n```json\n{}\n```", truncate(&raw, 200))
}

/// tool 入参：Anthropic 方言用 `input`（已结构化），Pi 方言用 `arguments`（字符串）。
///
/// Pi 写出的 `arguments` 可能是非严格 JSON（Python 字面量风格），解析失败时按原文字符串保留。
fn tool_input(part: &serde_json::Value) -> serde_json::Value {
    if let Some(input) = part.get("input").filter(|v| !v.is_null()) {
        return input.clone();
    }
    match part.get("arguments") {
        Some(serde_json::Value::String(raw)) => {
            serde_json::from_str(raw).unwrap_or_else(|_| serde_json::Value::String(raw.clone()))
        }
        Some(other) => other.clone(),
        None => serde_json::Value::Null,
    }
}

/// tool 结果载荷：字符串或块数组（取其中的文本块）。
fn tool_result_content(part: &serde_json::Value) -> String {
    match part.get("content") {
        Some(serde_json::Value::String(text)) => text.clone(),
        Some(serde_json::Value::Array(parts)) => content_from_parts(parts).text,
        _ => String::new(),
    }
}

fn is_error_flag(part: &serde_json::Value) -> bool {
    part.get("is_error")
        .or_else(|| part.get("isError"))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
}

fn str_field(part: &serde_json::Value, key: &str) -> Option<String> {
    part.get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

/// thinking 块的正文字段：Claude 用 `thinking`，OpenAI 风格方言用 `text`。
fn thinking_field(part: &serde_json::Value) -> Option<String> {
    str_field(part, "thinking").or_else(|| str_field(part, "text"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn entry(content: serde_json::Value) -> serde_json::Value {
        json!({ "type": "message", "message": { "role": "user", "content": content } })
    }

    #[test]
    fn should_extract_scalar_string_content() {
        let content = extract_message_content(&entry(json!("plain text")));
        assert_eq!(content.text, "plain text");
        assert!(matches!(
            content.blocks.as_slice(),
            [MessageBlock::Text { text }] if text == "plain text"
        ));
    }

    #[test]
    fn should_extract_text_blocks_from_array() {
        let content = extract_message_content(&entry(json!([
            { "type": "text", "text": "first" },
            { "type": "text", "text": "second" }
        ])));
        assert_eq!(content.text, "first\n\nsecond");
        assert_eq!(content.blocks.len(), 2);
    }

    #[test]
    fn should_wrap_thinking_blocks_for_plain_text() {
        let content = extract_message_content(&entry(json!([
            { "type": "thinking", "thinking": "先看 diff" },
            { "type": "text", "text": "done" }
        ])));
        assert_eq!(content.text, "<thinking>\n先看 diff\n</thinking>\n\ndone");
    }

    #[test]
    fn should_map_tool_call_aliases() {
        let content = extract_message_content(&entry(json!([
            { "type": "toolCall", "id": "c1", "name": "bash", "arguments": "{\"command\":\"ls\"}" },
            { "type": "tool_use", "id": "c2", "name": "read", "input": { "path": "a.rs" } }
        ])));
        assert!(matches!(
            &content.blocks[0],
            MessageBlock::ToolUse { name, input, .. } if name == "bash" && input["command"] == "ls"
        ));
        assert!(matches!(
            &content.blocks[1],
            MessageBlock::ToolUse { name, input, .. } if name == "read" && input["path"] == "a.rs"
        ));
    }

    #[test]
    fn should_keep_unparsable_tool_arguments_as_raw_string() {
        // Pi 会写出 Python 字面量风格（单引号），JSON 解析必然失败
        let content = extract_message_content(&entry(json!([
            { "type": "toolCall", "id": "c1", "name": "bash", "arguments": "{'command': 'ls'}" }
        ])));
        assert!(matches!(
            &content.blocks[0],
            MessageBlock::ToolUse { input, .. } if input.as_str() == Some("{'command': 'ls'}")
        ));
        assert!(content.text.contains("'command': 'ls'"));
    }

    #[test]
    fn should_exclude_tool_results_from_plain_text() {
        let content = extract_message_content(&entry(json!([
            { "type": "text", "text": "before" },
            {
                "type": "tool_result",
                "tool_use_id": "c1",
                "content": [{ "type": "text", "text": "tool output" }],
                "is_error": true
            }
        ])));
        assert_eq!(content.text, "before");
        assert!(matches!(
            &content.blocks[1],
            MessageBlock::ToolResult { tool_use_id, content, is_error }
                if tool_use_id == "c1" && content == "tool output" && *is_error
        ));
    }

    #[test]
    fn should_drop_media_blocks() {
        let content = extract_message_content(&entry(json!([
            { "type": "text", "text": "look" },
            { "type": "image", "data": "iVBORw0KGgo=", "mimeType": "image/png" }
        ])));
        assert_eq!(content.text, "look");
        assert_eq!(content.blocks.len(), 1);
    }

    #[test]
    fn should_keep_unknown_block_carrying_text() {
        let content = extract_message_content(&entry(json!([
            { "type": "some_future_block", "text": "still readable" }
        ])));
        assert_eq!(content.text, "still readable");
    }

    /// 方言别名表是「新增 agent 只加别名」的唯一落点 —— 每个条目都必须有断言，
    /// 否则别名腐化时没人会发现。
    #[test]
    fn should_classify_every_dialect_alias() {
        use BlockKind::{Media, Text, Thinking, ToolResult, ToolUse, Unknown};
        let table: &[(&str, BlockKind)] = &[
            ("text", Text),
            ("input_text", Text),
            ("output_text", Text),
            ("thinking", Thinking),
            ("redacted_thinking", Thinking),
            ("reasoning", Thinking),
            ("tool_use", ToolUse),
            ("toolCall", ToolUse),
            ("tool_call", ToolUse),
            ("function_call", ToolUse),
            ("tool_result", ToolResult),
            ("toolResult", ToolResult),
            ("image", Media),
            ("image_url", Media),
            ("document", Media),
            ("", Unknown),
            ("some_future_block", Unknown),
        ];
        for (alias, expected) in table {
            assert_eq!(
                block_kind(alias),
                *expected,
                "alias `{alias}` misclassified"
            );
        }
    }

    #[test]
    fn should_read_content_string_on_message_object() {
        let content = extract_message_content(&json!({
            "message": { "role": "user", "content": "inline string" }
        }));
        assert_eq!(content.text, "inline string");
        assert!(matches!(
            content.blocks.as_slice(),
            [MessageBlock::Text { text }] if text == "inline string"
        ));
    }

    #[test]
    fn should_read_message_text_field() {
        let content = extract_message_content(&json!({ "message": { "text": "legacy text" } }));
        assert_eq!(content.text, "legacy text");
    }

    /// 方言：pi 用 camelCase（`toolCallId` / `isError`），content 可为纯字符串。
    #[test]
    fn should_read_camel_case_tool_result_fields() {
        let content = extract_message_content(&entry(json!([
            {
                "type": "toolResult",
                "toolCallId": "call_9",
                "content": "raw output",
                "isError": true
            }
        ])));
        assert!(matches!(
            &content.blocks[0],
            MessageBlock::ToolResult { tool_use_id, content, is_error }
                if tool_use_id == "call_9" && content == "raw output" && *is_error
        ));
        assert_eq!(content.text, "");
    }

    #[test]
    fn should_keep_object_arguments() {
        let content = extract_message_content(&entry(json!([
            { "type": "tool_call", "name": "read", "arguments": { "path": "a.rs" } }
        ])));
        assert!(matches!(
            &content.blocks[0],
            MessageBlock::ToolUse { input, .. } if input["path"] == "a.rs"
        ));
    }

    #[test]
    fn should_skip_empty_thinking_block() {
        let content = extract_message_content(&entry(json!([
            { "type": "thinking", "thinking": "" },
            { "type": "text", "text": "answer" }
        ])));
        assert_eq!(content.text, "answer");
    }

    /// 两条路径必须等价：轻量判定（`has_visible_text`）与全量抽取（`extract_message_content`）
    /// 一旦分叉，列表徽标就会和正文条数对不上。
    #[test]
    fn should_agree_with_full_extraction() {
        let cases = vec![
            entry(json!("scalar")),
            entry(json!([{ "type": "text", "text": "hi" }])),
            entry(json!([{ "type": "text", "text": "   " }])),
            entry(json!([{ "type": "thinking", "thinking": "plan" }])),
            entry(json!([{ "type": "thinking", "thinking": "" }])),
            entry(json!([{ "type": "toolCall", "name": "bash", "arguments": "{}" }])),
            entry(json!([{ "type": "image", "data": "x", "mimeType": "image/png" }])),
            entry(json!([{ "type": "tool_result", "content": "out" }])),
            entry(json!([{ "type": "future_block", "text": "kept" }])),
            entry(json!([{ "type": "future_block" }])),
            entry(json!({ "content": "inline" })),
            entry(json!({ "text": "legacy" })),
            json!({ "type": "session" }),
        ];
        for case in cases {
            let full = extract_message_content(&case);
            assert_eq!(
                has_visible_text(&case),
                !full.text.trim().is_empty(),
                "light/full extraction disagree for {case}"
            );
        }
    }

    #[test]
    fn should_return_empty_for_record_without_message() {
        let content = extract_message_content(&json!({ "type": "session", "version": 3 }));
        assert_eq!(content.text, "");
        assert!(content.blocks.is_empty());
    }

    #[test]
    fn should_return_empty_for_image_only_message() {
        let content = extract_message_content(&entry(json!([
            { "type": "image", "data": "iVBORw0KGgo=", "mimeType": "image/png" }
        ])));
        assert_eq!(content.text, "");
        assert!(content.blocks.is_empty());
    }
}
