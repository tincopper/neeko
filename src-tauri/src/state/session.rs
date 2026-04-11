use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

use super::terminal::TerminalStatus;

fn default_collapsed() -> bool {
    true
}

/// 项目会话（持久化用）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSession {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    pub selected_agent: Option<String>,
    pub selected_ide: Option<String>,
    pub terminal_history: Vec<String>,
    pub last_status: TerminalStatus,
    #[serde(default = "default_collapsed")]
    pub collapsed: bool,
}

/// 会话存储
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionStore {
    pub projects: Vec<ProjectSession>,
    pub active_project_id: Option<String>,
    pub last_updated: String,
    #[serde(default)]
    pub wsl_entries: Vec<WSLEntrySession>,
    #[serde(default)]
    pub remote_entries: Vec<RemoteEntrySession>,
    #[serde(default)]
    pub sidebar_width: Option<u32>,
    #[serde(default)]
    pub side_terminal_width: Option<u32>,
    #[serde(default)]
    pub worktree_state: HashMap<String, String>,
}

impl SessionStore {
    pub fn new() -> Self {
        Self {
            projects: Vec::new(),
            active_project_id: None,
            last_updated: String::new(),
            wsl_entries: Vec::new(),
            remote_entries: Vec::new(),
            sidebar_width: None,
            side_terminal_width: None,
            worktree_state: HashMap::new(),
        }
    }
}

/// WSL 项目会话（持久化用）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WSLProjectSession {
    pub id: String,
    pub name: String,
    pub path: String,
    pub distro: String,
    pub entry_id: String,
    #[serde(default)]
    pub selected_agent: Option<String>,
    #[serde(default)]
    pub selected_ide: Option<String>,
}

/// WSL 发行版会话（持久化用）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WSLEntrySession {
    pub id: String,
    pub distro: String,
    pub projects: Vec<WSLProjectSession>,
}

/// SSH 项目会话（持久化用）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteProjectSession {
    pub id: String,
    pub name: String,
    pub path: String,
    pub entry_id: String,
    #[serde(default)]
    pub selected_agent: Option<String>,
    #[serde(default)]
    pub selected_ide: Option<String>,
}

/// SSH 服务器会话（持久化用）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteEntrySession {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub projects: Vec<RemoteProjectSession>,
    /// Base64 编码的 AuthMethod JSON
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub saved_auth: Option<String>,
}
