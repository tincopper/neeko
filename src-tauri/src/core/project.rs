//! Core project model with environment and view mode types.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::common::connection::types::AuthMethod;
use crate::common::git::transport::GitTransportKind;
use crate::common::terminal::types::TerminalSession;
use crate::common::types::GitInfo;

/// 项目运行环境
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ProjectEnvironment {
    /// Local machine execution.
    Local,
    #[cfg(target_os = "windows")]
    /// WSL distribution execution.
    Wsl {
        /// WSL distribution name.
        distro: String,
    },
    /// Remote SSH server execution.
    Remote {
        /// Remote hostname or IP address.
        host: String,
        /// SSH port number.
        port: u16,
        /// SSH login username.
        username: String,
        /// Authentication method (password or key).
        auth: AuthMethod,
    },
}

impl Default for ProjectEnvironment {
    /// Defaults to local execution environment.
    fn default() -> Self {
        Self::Local
    }
}

impl ProjectEnvironment {
    /// Convert the environment into a Git transport kind with the project path.
    pub fn to_git_transport<'a>(&'a self, project_path: &'a str) -> (GitTransportKind, &'a str) {
        match self {
            Self::Local => (GitTransportKind::Local, project_path),
            #[cfg(target_os = "windows")]
            Self::Wsl { distro } => (
                GitTransportKind::Wsl {
                    distro: distro.clone(),
                },
                project_path,
            ),
            Self::Remote {
                host,
                port,
                username,
                auth,
            } => (
                GitTransportKind::Remote {
                    host: host.clone(),
                    port: *port,
                    username: username.clone(),
                    auth: auth.clone(),
                },
                project_path,
            ),
        }
    }

    /// Convert the environment into an executor target.
    pub fn to_exec_target(&self) -> crate::common::executor::factory::ExecTarget {
        match self {
            Self::Local => crate::common::executor::factory::ExecTarget::Local,
            #[cfg(target_os = "windows")]
            Self::Wsl { distro } => crate::common::executor::factory::ExecTarget::Wsl {
                distro: distro.clone(),
            },
            Self::Remote {
                host,
                port,
                username,
                auth,
            } => crate::common::executor::factory::ExecTarget::Remote {
                host: host.clone(),
                port: *port,
                username: username.clone(),
                auth: auth.clone(),
            },
        }
    }
}

/// 视图模式
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ViewMode {
    /// Terminal view mode.
    Terminal,
    /// Diff view mode showing a specific file.
    Diff {
        /// Path to the file being compared.
        file_path: PathBuf,
    },
}

/// 项目信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    /// Unique project identifier.
    pub id: String,
    /// Display name for the project.
    pub name: String,
    /// Filesystem path to the project root.
    pub path: PathBuf,
    #[serde(default)]
    /// Execution environment (local, WSL, or remote).
    pub environment: ProjectEnvironment,
    /// Current Git repository information.
    pub git_info: Option<GitInfo>,
    /// Active terminal session for this project.
    pub terminal: TerminalSession,
    /// Selected AI agent for this project.
    pub selected_agent: Option<String>,
    /// Selected IDE for this project.
    pub selected_ide: Option<String>,
    /// Current view mode (terminal or diff).
    pub active_view: ViewMode,
    /// Whether the project panel is collapsed.
    pub collapsed: bool,
    #[serde(default)]
    /// Avatar color override for the project card.
    pub avatar_color: Option<String>,
    /// Project-level primary LSP language override (e.g. "go", "rust").
    /// When set, soft-warm / onProjectSelect prefer this language over root-marker order.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_language: Option<String>,
}
