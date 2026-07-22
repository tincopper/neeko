//! WSL command executor.
//!
//! Bridges command execution into a Windows Subsystem for Linux distribution
//! by spawning `wsl.exe`. User tool PATH is obtained by running commands via a
//! login shell (`bash -lc`) inside the distro so profile-managed tools (nvm,
//! fnm, cargo, …) match an interactive WSL terminal.

#[cfg(target_os = "windows")]
use std::sync::Arc;

use async_trait::async_trait;
#[cfg(target_os = "windows")]
use futures::FutureExt;
#[cfg(target_os = "windows")]
use tokio::sync::Mutex;

#[cfg(target_os = "windows")]
use super::{BoxAsyncRead, BoxAsyncWrite};
use super::{CommandExecutor, ExecChild, ExecError, SpawnOptions};

/// Executor that runs commands inside a WSL distribution.
///
/// On Windows spawns `wsl.exe` with Windows `PATH` stripped so host PATH does
/// not leak into Linux, then runs `bash -lc '…'` for the user command.
#[cfg(not(target_os = "windows"))]
pub struct WslExecutor;

#[cfg(not(target_os = "windows"))]
impl WslExecutor {
    /// Create a new `WslExecutor` (stub — returns an error on non-Windows platforms).
    pub fn new(_distro: String) -> Self {
        Self
    }
}

#[cfg(target_os = "windows")]
pub struct WslExecutor {
    /// WSL distribution name (e.g. "Ubuntu-22.04"). `None` uses the default distro.
    distro: Option<String>,
}

#[cfg(target_os = "windows")]
impl WslExecutor {
    /// Create a new `WslExecutor` for the given distribution.
    pub fn new(distro: String) -> Self {
        Self {
            distro: Some(distro),
        }
    }
}

/// Build a login-shell command script that changes to the working directory
/// and executes the requested command.
#[cfg(target_os = "windows")]
fn build_login_script(opts: &SpawnOptions<'_>) -> String {
    use crate::common::utils::command::local::{join_quoted_command, quote_shell_arg};
    let mut script = String::new();
    if let Some(dir) = opts.current_dir {
        script.push_str("cd ");
        script.push_str(&quote_shell_arg(dir));
        script.push_str(" && ");
    }
    script.push_str("exec ");
    script.push_str(&join_quoted_command(opts.cmd, opts.args));
    script
}

#[cfg(target_os = "windows")]
#[async_trait]
impl CommandExecutor for WslExecutor {
    async fn spawn_with(&self, opts: SpawnOptions<'_>) -> Result<ExecChild, ExecError> {
        let script = build_login_script(&opts);

        let mut wsl_args: Vec<String> = Vec::new();
        if let Some(ref d) = self.distro {
            wsl_args.push("-d".into());
            wsl_args.push(d.clone());
        }
        wsl_args.push("--".into());
        wsl_args.push("bash".into());
        wsl_args.push("-lc".into());
        wsl_args.push(script);

        let mut command = tokio::process::Command::new("wsl.exe");
        command
            .args(&wsl_args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        // Prevent Windows PATH entries from leaking into the WSL environment.
        command.env_remove("PATH");

        let mut child = command.spawn().map_err(ExecError::Io)?;

        let stdin: Option<BoxAsyncWrite> = child.stdin.take().map(|w| Box::pin(w) as BoxAsyncWrite);
        let stdout: Option<BoxAsyncRead> = child.stdout.take().map(|r| Box::pin(r) as BoxAsyncRead);
        let stderr: Option<BoxAsyncRead> = child.stderr.take().map(|r| Box::pin(r) as BoxAsyncRead);

        let child_lock = Arc::new(Mutex::new(child));
        let wait_child = Arc::clone(&child_lock);
        let wait = async move {
            let mut guard = wait_child.lock().await;
            guard
                .wait()
                .await
                .map_err(ExecError::Io)?
                .code()
                .ok_or(ExecError::Killed)
        };
        let kill_child = Arc::clone(&child_lock);
        let kill_fn = move || {
            async move {
                kill_child.lock().await.kill().await?;
                Ok(())
            }
            .boxed()
        };

        Ok(ExecChild::new(stdin, stdout, stderr, wait, kill_fn))
    }
}

#[cfg(not(target_os = "windows"))]
#[async_trait]
impl CommandExecutor for WslExecutor {
    async fn spawn_with(&self, _opts: SpawnOptions<'_>) -> Result<ExecChild, ExecError> {
        Err(ExecError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}
