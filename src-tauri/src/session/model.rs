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
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    #[serde(default = "default_environment")]
    pub environment: ProjectEnvironment,
    pub selected_agent: Option<String>,
    pub selected_ide: Option<String>,
    #[serde(default)]
    pub terminal_history: Vec<String>,
    #[serde(default)]
    pub last_status: TerminalStatus,
    #[serde(default = "default_collapsed")]
    pub collapsed: bool,
    #[serde(default)]
    pub avatar_color: Option<String>,
}

/// 会话存储
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionStore {
    pub projects: Vec<ProjectSession>,
    pub active_project_id: Option<String>,
    pub last_updated: String,
    /// 旧格式遗留字段，仅用于反序列化迁移
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub wsl_entries: Vec<WSLEntrySession>,
    /// 旧格式遗留字段，仅用于反序列化迁移
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub remote_entries: Vec<RemoteEntrySession>,
    #[serde(default)]
    pub sidebar_width: Option<u32>,
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
    pub id: String,
    pub name: String,
    pub path: String,
    pub distro: String,
    pub entry_id: String,
    #[serde(default)]
    pub selected_agent: Option<String>,
    #[serde(default)]
    pub selected_ide: Option<String>,
    #[serde(default)]
    pub avatar_color: Option<String>,
}

/// WSL 发行版会话（持久化用）— 旧格式，仅用于反序列化迁移
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WSLEntrySession {
    pub id: String,
    pub distro: String,
    pub projects: Vec<WSLProjectSession>,
}

/// SSH 项目会话（持久化用）— 旧格式，仅用于反序列化迁移
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
    #[serde(default)]
    pub avatar_color: Option<String>,
}

/// SSH 服务器会话（持久化用）— 旧格式，仅用于反序列化迁移
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
