use anyhow::Result;
use std::path::{Path, PathBuf};

/// 解析后的元数据（parse_meta 返回值）
#[derive(Debug, Clone)]
pub struct ParsedMeta {
    pub native_session_id: String,
    pub title: Option<String>,
    pub started_at: i64,
    pub updated_at: i64,
    pub message_count: u32,
    pub preview: String,
    pub project_path: Option<String>,
}

/// 解析后的单条消息（parse_messages 返回值）
#[derive(Debug, Clone)]
pub struct ParsedMessage {
    pub role: String,
    pub content: String,
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
