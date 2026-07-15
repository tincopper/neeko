//! WSL command executor.
//!
//! Bridges command execution into a Windows Subsystem for Linux distribution
//! by spawning `wsl.exe` with the appropriate distro flag.

use async_trait::async_trait;

#[cfg(target_os = "windows")]
use super::local::LocalExecutor;
use super::{CommandExecutor, ExecChild, ExecError};

/// Executor that runs commands inside a WSL distribution.
///
/// Internally delegates to [`LocalExecutor`] with `wsl.exe` as the program.
/// Only available on `cfg(windows)`; on other platforms the executor is a
/// stub that always returns an error.
#[cfg(target_os = "windows")]
pub struct WslExecutor {
    distro: Option<String>,
}

#[cfg(target_os = "windows")]
impl WslExecutor {
    /// Create an executor for a named WSL distribution.
    pub fn new(distro: String) -> Self {
        Self {
            distro: Some(distro),
        }
    }
}

#[cfg(target_os = "windows")]
#[async_trait]
impl CommandExecutor for WslExecutor {
    async fn spawn(&self, cmd: &str, args: &[&str]) -> Result<ExecChild, ExecError> {
        let mut wsl_args: Vec<&str> = Vec::new();
        if let Some(ref d) = self.distro {
            wsl_args.push("-d");
            wsl_args.push(d.as_str());
        }
        wsl_args.push("--");
        wsl_args.push(cmd);
        wsl_args.extend(args.iter().copied());

        let local = LocalExecutor;
        local.spawn("wsl.exe", &wsl_args).await
    }
}

/// Stub for non-Windows platforms.
#[cfg(not(target_os = "windows"))]
pub struct WslExecutor;

#[cfg(not(target_os = "windows"))]
impl WslExecutor {
    /// Create the platform stub while preserving the cross-platform API.
    pub fn new(_distro: String) -> Self {
        Self
    }
}

#[cfg(not(target_os = "windows"))]
#[async_trait]
impl CommandExecutor for WslExecutor {
    async fn spawn(&self, _cmd: &str, _args: &[&str]) -> Result<ExecChild, ExecError> {
        Err(ExecError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}
