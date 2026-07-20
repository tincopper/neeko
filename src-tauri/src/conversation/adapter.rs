use anyhow::Result;
use std::path::{Path, PathBuf};

use crate::conversation::types::MessageBlock;

/// 解析后的元数据（parse_meta 返回值）
#[derive(Debug, Clone)]
pub struct ParsedMeta {
    /// Native session identifier from the agent's storage.
    pub native_session_id: String,
    /// P2 候选：适配器提供的 AI 生成标题（无则 None）
    pub title: Option<String>,
    /// P3 候选：首条用户消息原文（净化后作为兜底标题）
    pub first_user_message: Option<String>,
    /// 预览来源：最近消息环形缓冲（role, 原文），已剔除 harness 注入噪声
    pub recent_messages: Vec<(String, String)>,
    /// 模型名称（如 "claude-sonnet-4-20250514"）
    pub model: Option<String>,
    /// Unix timestamp (ms) when the conversation started.
    pub started_at: i64,
    /// Unix timestamp (ms) when the conversation was last updated.
    pub updated_at: i64,
    /// Number of messages in the conversation.
    pub message_count: u32,
    /// Optional project path for this session.
    pub project_path: Option<String>,
}

/// 解析后的单条消息（parse_messages 返回值）
#[derive(Debug, Clone)]
pub struct ParsedMessage {
    /// Message author role (e.g. "user", "assistant").
    pub role: String,
    /// Raw text content of the message.
    pub content: String,
    /// 结构化内容块
    pub blocks: Vec<MessageBlock>,
    /// 消息级别的模型名称（可能中途切换）
    pub model: Option<String>,
    /// Unix timestamp (ms) when the message was created.
    pub timestamp: i64,
    /// Sequential message index within the conversation.
    pub seq: u32,
}

/// Agent 会话文件适配器 trait
///
/// 每个 Agent 实现此 trait 以支持从 Agent 原生存储格式中解析会话元数据和消息。
pub trait AgentSessionAdapter: Send + Sync {
    /// Agent identifier string.
    fn agent_id(&self) -> &str;
    /// Root directory for scanning session files.
    fn session_root(&self) -> PathBuf;
    /// Glob pattern to match session files.
    fn file_pattern(&self) -> &str;

    /// 快速解析元数据（只读文件头部，列表展示用）
    fn parse_meta(&self, file_path: &Path) -> Result<ParsedMeta>;

    /// 完整解析消息（查看详情时按需调用）
    fn parse_messages(&self, file_path: &Path) -> Result<Vec<ParsedMessage>>;

    /// Extract a native session ID from a file path.
    fn extract_session_id(&self, file_path: &Path) -> Option<String>;

    /// 构建恢复命令。None = 不支持原生恢复。
    fn resume_command(&self, native_session_id: &str, project_path: &str) -> Option<Vec<String>>;

    /// 批量解析全部元数据（用于单文件多会话场景，如 SQLite 数据库）。
    ///
    /// 返回 `None` 表示使用默认的逐文件扫描（现有行为）。
    /// 返回 `Some(Ok(vec))` 替代 WalkDir 循环，每条记录包含 `(ParsedMeta, synthetic_path)`。
    /// `synthetic_path` 会存入 `ConversationMeta.file_path`，供 `parse_messages` 后续使用。
    fn parse_all_metas(&self) -> Option<Result<Vec<(ParsedMeta, PathBuf)>>> {
        None
    }
}
