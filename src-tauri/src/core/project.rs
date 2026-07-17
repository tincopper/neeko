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
    Local,
    #[cfg(target_os = "windows")]
    Wsl {
        distro: String,
    },
    Remote {
        host: String,
        port: u16,
        username: String,
        auth: AuthMethod,
    },
}

impl Default for ProjectEnvironment {
    fn default() -> Self {
        Self::Local
    }
}

impl ProjectEnvironment {
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
    Terminal,
    Diff { file_path: PathBuf },
}

/// 项目信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    #[serde(default)]
    pub environment: ProjectEnvironment,
    pub git_info: Option<GitInfo>,
    pub terminal: TerminalSession,
    pub selected_agent: Option<String>,
    pub selected_ide: Option<String>,
    pub active_view: ViewMode,
    pub collapsed: bool,
    #[serde(default)]
    pub avatar_color: Option<String>,
    /// Project-level primary LSP language override (e.g. "go", "rust").
    /// When set, soft-warm / onProjectSelect prefer this language over root-marker order.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_language: Option<String>,
}
