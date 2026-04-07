use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 终端状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TerminalStatus {
    Idle,    // 空闲
    Running, // 运行中
    Failed,  // 失败
}

/// Agent 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub icon: Option<String>,
    pub enabled: bool,
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
