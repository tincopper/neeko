use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// 会话元数据（扫描时提取，存在内存中）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationMeta {
    pub id: String,
    pub native_session_id: String,
    pub agent_id: String,
    pub title: String,
    pub started_at: i64,
    pub updated_at: i64,
    pub message_count: u32,
    pub preview: String,
    pub file_path: PathBuf,
    pub project_path: Option<String>,
    pub user_title: Option<String>,
    pub tags: Vec<String>,
}

/// 单条会话消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationMessage {
    pub role: String,
    pub content: String,
    pub timestamp: i64,
    pub seq: u32,
}

/// 扫描报告
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanReport {
    pub agent_id: String,
    pub sessions_found: u32,
    pub errors: Vec<String>,
}
