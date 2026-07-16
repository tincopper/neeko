//! WSL command executor.
//!
//! Bridges command execution into a Windows Subsystem for Linux distribution
//! by spawning `wsl.exe` with the appropriate distro flag.

use async_trait::async_trait;

#[cfg(target_os = "windows")]
use super::local::LocalExecutor;
use super::{CommandExecutor, ExecChild, ExecError, ExecOutput};

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

/// Execute a command inside a WSL distribution with full control over
/// WSL-specific flags (`-u <user>`, `env_remove`, etc.) that the standard
/// [`CommandExecutor`] trait does not expose through its generic `spawn`.
///
/// On non-Windows platforms this function returns `ExecError::Wsl`.
///
/// # Arguments
///
/// * `distro` - WSL distribution name (e.g. `"Ubuntu-22.04"`)
/// * `user` - Optional WSL user to run as (sets the `-u` flag)
/// * `env_remove_keys` - Environment variable keys to remove before execution
/// * `cmd` - Command to run inside the distribution
/// * `args` - Arguments to pass to the command
#[cfg(target_os = "windows")]
pub async fn exec_wsl(
    distro: &str,
    user: Option<&str>,
    env_remove_keys: &[&str],
    cmd: &str,
    args: &[&str],
) -> Result<ExecOutput, ExecError> {
    let mut command = tokio::process::Command::new("wsl.exe");
    command.arg("-d").arg(distro);
    if let Some(user) = user {
        command.arg("-u").arg(user);
    }
    command.arg("--").arg(cmd);
    command.args(args);
    for key in env_remove_keys {
        command.env_remove(key);
    }

    let output = command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .await
        .map_err(ExecError::Io)?;

    Ok(ExecOutput {
        stdout: output.stdout,
        stderr: output.stderr,
        exit_code: output.status.code().unwrap_or(-1),
    })
}

/// Non-Windows stub for [`exec_wsl`].
#[cfg(not(target_os = "windows"))]
pub async fn exec_wsl(
    _distro: &str,
    _user: Option<&str>,
    _env_remove_keys: &[&str],
    _cmd: &str,
    _args: &[&str],
) -> Result<ExecOutput, ExecError> {
    Err(ExecError::Wsl(
        "WSL is only supported on Windows".to_string(),
    ))
}
