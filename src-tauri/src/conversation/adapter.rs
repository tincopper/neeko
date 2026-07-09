use anyhow::Result;
use std::path::{Path, PathBuf};

use crate::conversation::types::MessageBlock;

/// 解析后的元数据（parse_meta 返回值）
#[derive(Debug, Clone)]
pub struct ParsedMeta {
    pub native_session_id: String,
    /// P2 候选：适配器提供的 AI 生成标题（无则 None）
    pub title: Option<String>,
    /// P3 候选：首条用户消息原文（净化后作为兜底标题）
    pub first_user_message: Option<String>,
    /// 预览来源：最近消息环形缓冲（role, 原文），已剔除 harness 注入噪声
    pub recent_messages: Vec<(String, String)>,
    pub started_at: i64,
    pub updated_at: i64,
    pub message_count: u32,
    pub project_path: Option<String>,
}

/// 解析后的单条消息（parse_messages 返回值）
#[derive(Debug, Clone)]
pub struct ParsedMessage {
    pub role: String,
    pub content: String,
    /// 结构化内容块
    pub blocks: Vec<MessageBlock>,
    pub timestamp: i64,
    pub seq: u32,
}

/// Agent 会话文件适配器 trait
///
/// 每个 Agent 实现此 trait 以支持从 Agent 原生存储格式中解析会话元数据和消息。
pub trait AgentSessionAdapter: Send + Sync {
    fn agent_id(&self) -> &str;
    fn session_root(&self) -> PathBuf;
    fn file_pattern(&self) -> &str;

    /// 快速解析元数据（只读文件头部，列表展示用）
    fn parse_meta(&self, file_path: &Path) -> Result<ParsedMeta>;

    /// 完整解析消息（查看详情时按需调用）
    fn parse_messages(&self, file_path: &Path) -> Result<Vec<ParsedMessage>>;

    fn extract_session_id(&self, file_path: &Path) -> Option<String>;

    /// 构建恢复命令。None = 不支持原生恢复。
    fn resume_command(&self, native_session_id: &str, project_path: &str) -> Option<Vec<String>>;
}
