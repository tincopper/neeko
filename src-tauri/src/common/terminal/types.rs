use serde::{Deserialize, Serialize};

use crate::common::agent::types::AgentConfig;

/// 终端状态
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub enum TerminalStatus {
    #[default]
    Idle, // 空闲
    Running, // 运行中
    Failed,  // 失败
}

/// 终端会话
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalSession {
    pub id: String,
    pub pid: Option<u32>,
    pub status: TerminalStatus,
    pub history: Vec<String>,
    pub agent: Option<AgentConfig>,
}
