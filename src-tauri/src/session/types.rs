//! Types for session persistence and migration.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

use crate::common::terminal::types::TerminalStatus;
use crate::core::ProjectEnvironment;

fn default_collapsed() -> bool {
    true
}

fn default_environment() -> ProjectEnvironment {
    ProjectEnvironment::Local
}

/// 项目会话（持久化用）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSession {
    /// Unique session identifier.
    pub id: String,
    /// Display name of the project.
    pub name: String,
    /// Filesystem path to the project root.
    pub path: PathBuf,
    #[serde(default = "default_environment")]
    /// Execution environment (local, WSL, or remote).
    pub environment: ProjectEnvironment,
    /// Selected AI agent identifier.
    pub selected_agent: Option<String>,
    /// Selected IDE identifier.
    pub selected_ide: Option<String>,
    #[serde(default)]
    /// Historical terminal output lines.
    pub terminal_history: Vec<String>,
    #[serde(default)]
    /// Last known terminal status.
    pub last_status: TerminalStatus,
    #[serde(default = "default_collapsed")]
    /// Whether the project panel is collapsed in the sidebar.
    pub collapsed: bool,
    #[serde(default)]
    /// Avatar color override for the project card.
    pub avatar_color: Option<String>,
    /// Project-level primary LSP language override.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_language: Option<String>,
}

/// 会话存储
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionStore {
    /// All project sessions.
    pub projects: Vec<ProjectSession>,
    /// Currently active project identifier.
    pub active_project_id: Option<String>,
    /// RFC 3339 timestamp of last update.
    pub last_updated: String,
    /// 旧格式遗留字段，仅用于反序列化迁移
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub wsl_entries: Vec<WSLEntrySession>,
    /// 旧格式遗留字段，仅用于反序列化迁移
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub remote_entries: Vec<RemoteEntrySession>,
    #[serde(default)]
    /// Sidebar width in pixels.
    pub sidebar_width: Option<u32>,
    #[serde(default)]
    /// Per-project worktree state map.
    pub worktree_state: HashMap<String, String>,
}

impl SessionStore {
    /// Creates an empty session store.
    pub fn new() -> Self {
        Self {
            projects: Vec::new(),
            active_project_id: None,
            last_updated: String::new(),
            wsl_entries: Vec::new(),
            remote_entries: Vec::new(),
            sidebar_width: None,
            worktree_state: HashMap::new(),
        }
    }

    /// 扁平化：将旧格式的 wsl_entries / remote_entries 合并到统一的 projects 列表
    pub fn flatten_old_format(&mut self) {
        if self.wsl_entries.is_empty() && self.remote_entries.is_empty() {
            return;
        }

        #[cfg(target_os = "windows")]
        for entry in self.wsl_entries.drain(..) {
            for wp in entry.projects {
                self.projects.push(ProjectSession {
                    id: wp.id,
                    name: wp.name,
                    path: PathBuf::from(wp.path),
                    environment: ProjectEnvironment::Wsl { distro: wp.distro },
                    selected_agent: wp.selected_agent,
                    selected_ide: wp.selected_ide,
                    terminal_history: Vec::new(),
                    last_status: TerminalStatus::Idle,
                    collapsed: true,
                    avatar_color: wp.avatar_color,
                    primary_language: None,
                });
            }
        }
        #[cfg(not(target_os = "windows"))]
        self.wsl_entries.clear();

        for entry in self.remote_entries.drain(..) {
            let auth = entry.saved_auth.as_ref().and_then(|b64| {
                use base64::Engine;
                base64::engine::general_purpose::STANDARD
                    .decode(b64)
                    .ok()
                    .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            });
            for rp in entry.projects {
                self.projects.push(ProjectSession {
                    id: rp.id,
                    name: rp.name,
                    path: PathBuf::from(rp.path),
                    environment: ProjectEnvironment::Remote {
                        host: entry.host.clone(),
                        port: entry.port,
                        username: entry.username.clone(),
                        auth: auth.clone().unwrap_or(
                            crate::common::connection::types::AuthMethod::Password(String::new()),
                        ),
                    },
                    selected_agent: rp.selected_agent,
                    selected_ide: rp.selected_ide,
                    terminal_history: Vec::new(),
                    last_status: TerminalStatus::Idle,
                    collapsed: true,
                    avatar_color: rp.avatar_color,
                    primary_language: None,
                });
            }
        }
    }
}

impl Default for SessionStore {
    fn default() -> Self {
        Self::new()
    }
}

/// WSL 项目会话（持久化用）— 旧格式，仅用于反序列化迁移
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WSLProjectSession {
    /// Unique project identifier.
    pub id: String,
    /// Display name of the project.
    pub name: String,
    /// Project path inside the WSL distribution.
    pub path: String,
    /// WSL distribution name.
    pub distro: String,
    /// Parent entry session identifier.
    pub entry_id: String,
    #[serde(default)]
    /// Selected AI agent identifier.
    pub selected_agent: Option<String>,
    #[serde(default)]
    /// Selected IDE identifier.
    pub selected_ide: Option<String>,
    #[serde(default)]
    /// Avatar color override.
    pub avatar_color: Option<String>,
}

/// WSL 发行版会话（持久化用）— 旧格式，仅用于反序列化迁移
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WSLEntrySession {
    /// Unique entry identifier.
    pub id: String,
    /// WSL distribution name.
    pub distro: String,
    /// Projects associated with this WSL distribution.
    pub projects: Vec<WSLProjectSession>,
}

/// SSH 项目会话（持久化用）— 旧格式，仅用于反序列化迁移
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteProjectSession {
    /// Unique project identifier.
    pub id: String,
    /// Display name of the project.
    pub name: String,
    /// Project path on the remote server.
    pub path: String,
    /// Parent entry session identifier.
    pub entry_id: String,
    #[serde(default)]
    /// Selected AI agent identifier.
    pub selected_agent: Option<String>,
    #[serde(default)]
    /// Selected IDE identifier.
    pub selected_ide: Option<String>,
    #[serde(default)]
    /// Avatar color override.
    pub avatar_color: Option<String>,
}

/// SSH 服务器会话（持久化用）— 旧格式，仅用于反序列化迁移
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteEntrySession {
    /// Unique entry identifier.
    pub id: String,
    /// Remote server hostname or IP.
    pub host: String,
    /// SSH port number.
    pub port: u16,
    /// SSH username.
    pub username: String,
    /// Projects associated with this remote server.
    pub projects: Vec<RemoteProjectSession>,
    /// Base64 编码的 AuthMethod JSON
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub saved_auth: Option<String>,
}
