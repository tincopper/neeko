use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// 会话元数据（扫描时提取，存在内存中）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMeta {
    pub id: String,
    pub native_session_id: String,
    pub agent_id: String,
    pub title: String,
    pub model: Option<String>,
    pub started_at: i64,
    pub updated_at: i64,
    pub message_count: u32,
    pub preview: String,
    pub file_path: PathBuf,
    pub project_path: Option<String>,
    pub user_title: Option<String>,
    pub tags: Vec<String>,
}

/// 消息内容块 - 表示 Agent 执行过程中的不同类型内容
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum MessageBlock {
    /// 文本内容
    Text {
        text: String,
    },
    /// 思考过程（Claude 的 thinking 模式）
    Thinking {
        thinking: String,
    },
    /// 工具调用
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    /// 工具执行结果
    ToolResult {
        tool_use_id: String,
        content: String,
        is_error: bool,
    },
}

/// 单条会话消息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessage {
    pub role: String,
    pub content: String,
    /// 结构化内容块，用于展示 Agent 执行过程
    #[serde(default)]
    pub blocks: Vec<MessageBlock>,
    /// 消息级别的模型名称（可能中途切换）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub timestamp: i64,
    pub seq: u32,
}

/// 扫描报告
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReport {
    pub agent_id: String,
    pub sessions_found: u32,
    pub errors: Vec<String>,
}
