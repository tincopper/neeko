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
    /// Whether the agent adapter can produce a native resume command.
    /// Frontend hides the Resume button when false (D4).
    #[serde(default)]
    pub supports_resume: bool,
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

/// 会话正文分页。
///
/// 红线 4：单次 Command 载荷 ≤2MB，而单个会话可能有数千条消息（实测最大 8.7MB）。
/// 前端按 `has_more` 逐页组装；每页由 manager 按字节预算切分，IPC 单次始终在预算内。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessagePage {
    /// 本页消息（时间正序）
    pub items: Vec<ConversationMessage>,
    /// 会话消息总数
    pub total: u32,
    /// 本页起始下标
    pub offset: u32,
    /// 本页条数
    pub limit: u32,
    /// 是否还有下一页
    pub has_more: bool,
}

/// 工具调用定位（前端侧边栏回跳：`seq` 定位消息，`block_idx` 定位消息内块）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallRef {
    /// 消息序号（树线性化序号，与 `ConversationMessage.seq` 对齐）
    pub seq: u32,
    /// 消息内的块下标
    pub block_idx: u32,
    /// 工具名
    pub name: String,
    /// 短摘要（路径 / 命令 / pattern 等，≤120 字符）
    pub summary: String,
}

/// 会话正文统计（顶部信息条 + 工具调用侧边栏的数据源）。
///
/// 由 Rust 计算的意义：前端不需要为了「数一数有几个工具调用」而把整段会话读进内存
/// （红线 4 的同一动机：载荷与常驻内存都要与实际展示量匹配）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationStats {
    /// 正文消息总数（与正文视图条数一致）
    pub total_messages: u32,
    /// 工具调用总数
    pub tool_calls: u32,
    /// thinking 块总数
    pub thinking_count: u32,
    /// 出现过的工具名（去重，按首次出现顺序）
    pub unique_tools: Vec<String>,
    /// 工具调用清单（按出现顺序，供侧边栏渲染与回跳；超过上限时截断）
    pub tool_call_list: Vec<ToolCallRef>,
    /// 清单是否被截断（`tool_calls` 仍是真实总数）
    pub tool_call_list_truncated: bool,
}

/// 会话内搜索命中（只回传定位与摘要，不回传正文）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSearchHit {
    /// 命中消息序号（供前端按需加载定位页）
    pub seq: u32,
    /// 角色（user / assistant）
    pub role: String,
    /// 命中片段（前后各留少量上下文）
    pub snippet: String,
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

/// Paginated conversation list result (list rib / infinite scroll).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationListPage {
    /// Page items sorted by `updated_at` desc.
    pub items: Vec<ConversationMeta>,
    /// Total matching rows (after project/agent filters).
    pub total: u32,
    /// Requested offset.
    pub offset: u32,
    /// Requested limit (0 means "all remaining" was requested and applied as unbounded).
    pub limit: u32,
    /// Whether more rows exist after this page.
    pub has_more: bool,
}
