use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TerminalStatus {
    Idle,    // 🟢
    Running, // 🟡
    Failed,  // 🔴
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ViewMode {
    Terminal,
    Diff { file_path: PathBuf },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FileStatus {
    Modified,
    Added,
    Deleted,
    Renamed,
    Untracked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChange {
    pub path: PathBuf,
    pub status: FileStatus,
    pub additions: usize,
    pub deletions: usize,
}

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalSession {
    pub id: String,
    pub pid: Option<u32>,
    pub status: TerminalStatus,
    pub history: Vec<String>,
    pub agent: Option<AgentConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Worktree {
    pub path: PathBuf,
    pub branch: String,
    pub head: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitInfo {
    pub current_branch: String,
    pub branches: Vec<String>,
    pub worktrees: Vec<Worktree>,
    pub changed_files: Vec<FileChange>,
    pub is_clean: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    pub git_info: Option<GitInfo>,
    pub terminal: TerminalSession,
    pub selected_agent: Option<String>,
    pub selected_ide: Option<String>, // IDE 可执行路径或命令
    pub active_view: ViewMode,
    pub collapsed: bool,
}

// 持久化会话
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

fn default_collapsed() -> bool {
    true
}

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
        }
    }
}

// SSH 认证方式
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AuthMethod {
    Password(String),
    KeyFile(String),
    KeyFileWithPassphrase {
        key_path: String,
        passphrase: String,
    },
}

// WSL 项目会话 (持久化用)
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

// WSL 发行版会话 (持久化用)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WSLEntrySession {
    pub id: String,
    pub distro: String,
    pub projects: Vec<WSLProjectSession>,
}

// SSH 项目会话 (持久化用)
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

// SSH 服务器会话 (持久化用)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteEntrySession {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub projects: Vec<RemoteProjectSession>,
    /// Base64 编码的 AuthMethod JSON（用户选择「保存密码」时填写）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub saved_auth: Option<String>,
}

// Diff 相关
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DiffLine {
    Context(String),
    Added(String),
    Removed(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffHunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffResult {
    pub hunks: Vec<DiffHunk>,
}
