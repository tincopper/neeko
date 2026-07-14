//! Executor factory — maps an [`ExecTarget`] to a concrete [`CommandExecutor`].
//!
//! Callers that know which environment they need (local / WSL / SSH) construct
//! the appropriate [`ExecTarget`] variant and pass it to [`create_executor`],
//! rather than importing concrete executor types directly.

use super::local::LocalExecutor;
use super::ssh::SshExecutor;
use super::{CommandExecutor, ExecError};
use crate::common::connection::types::AuthMethod;

#[cfg(target_os = "windows")]
use super::wsl::WslExecutor;

/// Describes which execution environment a command should run in.
///
/// This is the public-facing enum that callers use instead of constructing
/// concrete executor types. See [`create_executor`].
pub enum ExecTarget {
    /// Run directly on the host machine.
    Local,
    /// Run inside a WSL distribution (Windows only).
    #[cfg(target_os = "windows")]
    Wsl {
        /// WSL distribution name (e.g. "Ubuntu-22.04").
        distro: String,
    },
    /// Run on a remote host via SSH.
    Remote {
        host: String,
        port: u16,
        username: String,
        auth: AuthMethod,
    },
}

/// Create a [`CommandExecutor`] for the given [`ExecTarget`].
pub fn create_executor(target: &ExecTarget) -> Box<dyn CommandExecutor> {
    match target {
        ExecTarget::Local => Box::new(LocalExecutor),
        #[cfg(target_os = "windows")]
        ExecTarget::Wsl { distro } => {
            Box::new(WslExecutor { distro: Some(distro.clone()) })
        }
        ExecTarget::Remote { host, port, username, auth } => {
            Box::new(SshExecutor::new(host, *port, username, auth.clone()))
        }
    }
}
