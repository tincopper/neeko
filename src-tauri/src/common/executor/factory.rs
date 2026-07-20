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

/// Create a [`CommandExecutor`] for the given [`ExecTarget`].
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
