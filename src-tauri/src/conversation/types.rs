//! Types for conversation metadata, messages, and scan reports.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// 会话元数据（扫描时提取，存在内存中）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMeta {
    /// Unique conversation identifier.
    pub id: String,
    /// Native session ID from the agent's storage.
    pub native_session_id: String,
    /// Agent identifier (e.g. "claude-code", "opencode").
    pub agent_id: String,
    /// Conversation title.
    pub title: String,
    /// Model name used for the conversation.
    pub model: Option<String>,
    /// Unix timestamp (ms) when the conversation started.
    pub started_at: i64,
    /// Unix timestamp (ms) when the conversation was last updated.
    pub updated_at: i64,
    /// Number of messages in the conversation.
    pub message_count: u32,
    /// Preview text extracted from recent messages.
    pub preview: String,
    /// Filesystem path to the session file.
    pub file_path: PathBuf,
    /// Optional project path associated with this conversation.
    pub project_path: Option<String>,
    /// User-customizable title override.
    pub user_title: Option<String>,
    /// User-assigned tags for categorization.
    pub tags: Vec<String>,
}

/// 消息内容块 - 表示 Agent 执行过程中的不同类型内容
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum MessageBlock {
    /// 文本内容
    Text {
        /// The text content.
        text: String,
    },
    /// 思考过程（Claude 的 thinking 模式）
    Thinking {
        /// The thinking content.
        thinking: String,
    },
    /// 工具调用
    ToolUse {
        /// Unique identifier for the tool use.
        id: String,
        /// Name of the tool being called.
        name: String,
        /// Input arguments for the tool.
        input: serde_json::Value,
    },
    /// 工具执行结果
    ToolResult {
        /// ID of the corresponding tool use.
        tool_use_id: String,
        /// Result content from the tool execution.
        content: String,
        /// Whether the tool execution resulted in an error.
        is_error: bool,
    },
}

/// 单条会话消息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessage {
    /// Message author role (e.g. "user", "assistant").
    pub role: String,
    /// Raw text content of the message.
    pub content: String,
    /// 结构化内容块，用于展示 Agent 执行过程
    #[serde(default)]
    pub blocks: Vec<MessageBlock>,
    /// 消息级别的模型名称（可能中途切换）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Unix timestamp (ms) when the message was created.
    pub timestamp: i64,
    /// Sequential message index within the conversation.
    pub seq: u32,
}

/// 扫描报告
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReport {
    /// Agent that was scanned.
    pub agent_id: String,
    /// Number of sessions found during scan.
    pub sessions_found: u32,
    /// Errors encountered during scan.
    pub errors: Vec<String>,
}
