//! Executor factory — maps an [`ExecTarget`] to a concrete [`CommandExecutor`].
//!
//! Callers that know which environment they need (local / WSL / SSH) construct
//! the appropriate [`ExecTarget`] variant and pass it to [`create_executor`],
//! rather than importing concrete executor types directly.

use super::local::LocalExecutor;
use super::ssh::SshExecutor;
use super::wsl::WslExecutor;
use super::CommandExecutor;
use crate::common::connection::types::AuthMethod;

/// Describes which execution environment a command should run in.
///
/// This is the public-facing enum that callers use instead of constructing
/// concrete executor types. See [`create_executor`].
#[derive(Clone)]
pub enum ExecTarget {
    /// Run directly on the host machine.
    Local,
    /// Run inside a WSL distribution (Windows only; fails on other platforms).
    Wsl {
        /// WSL distribution name (e.g. "Ubuntu-22.04").
        distro: String,
    },
    /// Run on a remote host via SSH.
    Remote {
        /// Remote host address.
        host: String,
        /// SSH port.
        port: u16,
        /// Remote username.
        username: String,
        /// Authentication method.
        auth: AuthMethod,
    },
}

impl ExecTarget {
    /// 稳定缓存键：同一进程内跨环境共用「按 target 探测一次」的缓存时必须
    /// 用它隔离 —— Local / WSL distro / SSH 端点的 `java`、`PATH` 等互不相同，
    /// 共用一个槽位会把一个环境的结果串到另一个环境。
    ///
    /// 不含 `auth`：同一 host/port/user 的认证方式变化不影响环境本身，
    /// 且避免把凭据带入键/日志。
    #[must_use]
    pub fn cache_key(&self) -> String {
        match self {
            Self::Local => "local".to_string(),
            Self::Wsl { distro } => format!("wsl:{distro}"),
            Self::Remote {
                host,
                port,
                username,
                ..
            } => format!("remote:{username}@{host}:{port}"),
        }
    }
}

/// Create a [`CommandExecutor`] for the given [`ExecTarget`].
#[must_use]
pub fn create_executor(target: &ExecTarget) -> Box<dyn CommandExecutor> {
    match target {
        ExecTarget::Local => Box::new(LocalExecutor),
        ExecTarget::Wsl { distro } => Box::new(WslExecutor::new(distro.clone())),
        ExecTarget::Remote {
            host,
            port,
            username,
            auth,
        } => Box::new(SshExecutor::new(host, *port, username, auth.clone())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::common::executor::ExecError;

    /// 缓存键必须按环境区分：Local / WSL distro / SSH 端点互不相同，
    /// 否则跨环境缓存（如 PATH `java` 探测）会串味。
    #[test]
    fn cache_key_distinguishes_environments() {
        assert_eq!(ExecTarget::Local.cache_key(), "local");
        assert_eq!(
            ExecTarget::Wsl {
                distro: "Ubuntu-22.04".into()
            }
            .cache_key(),
            "wsl:Ubuntu-22.04"
        );
        let a = ExecTarget::Remote {
            host: "h1".into(),
            port: 22,
            username: "u".into(),
            auth: crate::common::connection::types::AuthMethod::Password("p".into()),
        };
        let b = ExecTarget::Remote {
            host: "h2".into(),
            port: 22,
            username: "u".into(),
            auth: crate::common::connection::types::AuthMethod::Password("p".into()),
        };
        assert_eq!(a.cache_key(), "remote:u@h1:22");
        assert_ne!(a.cache_key(), b.cache_key(), "不同 host 不得共用缓存键");
        assert_ne!(a.cache_key(), ExecTarget::Local.cache_key());
    }

    /// 非 Windows 平台上 WSL 目标可构造，但真正 spawn 时必须返回 `Wsl` 错误，
    /// 而不是静默失败或 panic。
    #[cfg(not(target_os = "windows"))]
    #[tokio::test]
    async fn wsl_target_spawn_returns_wsl_error() {
        let target = ExecTarget::Wsl {
            distro: "Ubuntu".to_string(),
        };
        let result = create_executor(&target).spawn("true", &[]).await;

        assert!(matches!(result, Err(ExecError::Wsl(_))));
    }
}
