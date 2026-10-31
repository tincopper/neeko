//! Core project model with environment and view mode types.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::common::connection::types::AuthMethod;
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
    /// Convert the environment into an executor target.
    #[must_use]
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
    /// Selected AI agents for this project.
    #[serde(default)]
    pub selected_agents: Vec<String>,
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

/// 路径 → 归属项目的执行环境（「这条路属于哪个环境」的唯一实现）。
///
/// # 为什么是项目域的事
///
/// 环境是 `Project` 的字段，所以「按路径找环境」是对项目聚合的一次查询 —— 与
/// `ProjectManager::get_project` 同类。调用方（组合根 / 团队执行层）只提供快照与目标路径，
/// 不自己写一遍匹配规则：否则「嵌套项目算谁的」会有两个答案。
///
/// # 两侧都归一化
///
/// 项目路径来自用户输入、团队根来自 `Workspace` 身份 —— 两者在符号链接与 macOS
/// `/var` ↔ `/private/var` 上会给出字面不同的字符串。只对其中一侧规范化等于「有时能
/// 匹配上」，而失败时的表现是「团队建好了但成员起不来」。
///
/// # 最长前缀
///
/// 嵌套项目（子目录也是项目）必须落到**最具体**的那个：否则在一个嵌套项目里建队会拿到
/// 外层项目的环境（而外层可能是 SSH，子目录是本地）。
///
/// # 不要求存在
///
/// SSH / WSL 的远端路径在本机不存在，`canonicalize` 失败时退回字面形 —— 两侧同样退化成
/// 字面形时仍然正确，而「要求存在」会把整类项目排除在外。
///
/// # 阻塞（红线 3）
///
/// `canonicalize` 是 I/O：异步调用方必须把本函数放进阻塞池。
pub fn environment_for_path(
    projects: &[(PathBuf, ProjectEnvironment)],
    target: &std::path::Path,
) -> Result<ProjectEnvironment, crate::common::error::AppError> {
    let target = normalize_path(target);
    projects
        .iter()
        .map(|(root, environment)| (normalize_path(root), environment))
        .filter(|(root, _)| target == *root || target.starts_with(root))
        .max_by_key(|(root, _)| root.as_os_str().len())
        .map(|(_, environment)| environment.clone())
        .ok_or_else(|| {
            crate::common::error::AppError::NotFound(format!(
                "no project owns {}: a team's execution environment is the environment of its \
                 project, so a team root outside every project cannot be launched",
                target.display()
            ))
        })
}

/// 路径身份归一化：能 `canonicalize` 就用规范形，否则用字面形（远端路径在本机不存在）。
fn normalize_path(path: &std::path::Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn local(path: &std::path::Path) -> (PathBuf, ProjectEnvironment) {
        (path.to_path_buf(), ProjectEnvironment::Local)
    }

    fn remote(path: &std::path::Path) -> (PathBuf, ProjectEnvironment) {
        (
            path.to_path_buf(),
            ProjectEnvironment::Remote {
                host: "h".into(),
                port: 22,
                username: "u".into(),
                auth: AuthMethod::Password(String::new()),
            },
        )
    }

    /// 嵌套项目必须落到**最具体**的那个。
    #[test]
    fn the_most_specific_project_owns_the_path() {
        let outer = tempfile::tempdir().expect("tempdir");
        let inner = outer.path().join("nested");
        std::fs::create_dir_all(&inner).expect("nested dir");

        let projects = vec![local(outer.path()), remote(&inner)];
        assert!(
            matches!(
                environment_for_path(&projects, &inner),
                Ok(ProjectEnvironment::Remote { .. })
            ),
            "嵌套项目必须胜出（最长前缀）"
        );
        assert!(matches!(
            environment_for_path(&projects, outer.path()),
            Ok(ProjectEnvironment::Local)
        ));
    }

    /// 不属于任何项目的路径 → `NotFound`（**不**降级成 `Local`）。
    ///
    /// 降级成 `Local` 的后果是在本机起一个指向远端路径的 PTY：成员「起来了」但环境是错的，
    /// 而这种错在花名册上看不出来。
    #[test]
    fn a_path_outside_every_project_is_refused() {
        let project = tempfile::tempdir().expect("tempdir");
        let stray = tempfile::tempdir().expect("tempdir");
        let projects = vec![local(project.path())];

        let err = environment_for_path(&projects, stray.path()).expect_err("必须拒绝");
        assert!(
            matches!(err, crate::common::error::AppError::NotFound(_)),
            "{err:?}"
        );
        assert!(err.to_string().contains("no project owns"), "{err}");
    }

    /// 路径前缀不是目录边界：`<tmp>/repo-extra` 不属于项目 `<tmp>/repo`。
    #[test]
    fn a_sibling_with_a_shared_prefix_is_not_a_child() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let project = tmp.path().join("repo");
        let sibling = tmp.path().join("repo-extra");
        std::fs::create_dir_all(&project).expect("project dir");
        std::fs::create_dir_all(&sibling).expect("sibling dir");

        let projects = vec![local(&project)];
        assert!(
            environment_for_path(&projects, &sibling).is_err(),
            "`repo-extra` 不在 `repo` 之下（`Path::starts_with` 按组件比较）"
        );
    }
}
