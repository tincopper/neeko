//! WSL command executor.
//!
//! Bridges command execution into a Windows Subsystem for Linux distribution
//! by spawning `wsl.exe` with the appropriate distro flag.

use std::sync::Arc;

use async_trait::async_trait;
use futures::FutureExt;
use tokio::sync::Mutex;

use super::{BoxAsyncRead, BoxAsyncWrite, CommandExecutor, ExecChild, ExecError};

/// Executor that runs commands inside a WSL distribution.
///
/// On Windows spawns `wsl.exe` with `env_remove("PATH")` to prevent Windows
/// PATH entries from leaking into the WSL environment. On other platforms
/// this executor is a stub that always returns an error.
#[cfg(target_os = "windows")]
pub struct WslExecutor {
    distro: Option<String>,
}

#[cfg(target_os = "windows")]
impl WslExecutor {
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

        let mut command = tokio::process::Command::new("wsl.exe");
        command.args(&wsl_args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        command.env_remove("PATH");

        let mut child = command.spawn().map_err(ExecError::Io)?;

        let stdin: Option<BoxAsyncWrite> = child.stdin.take().map(|w| Box::pin(w) as BoxAsyncWrite);
        let stdout: Option<BoxAsyncRead> = child.stdout.take().map(|r| Box::pin(r) as BoxAsyncRead);
        let stderr: Option<BoxAsyncRead> = child.stderr.take().map(|r| Box::pin(r) as BoxAsyncRead);

        let child_lock = Arc::new(Mutex::new(child));
        let wait_child = Arc::clone(&child_lock);
        let wait = async move {
            let mut guard = wait_child.lock().await;
            guard.wait().await.map_err(ExecError::Io)?.code().ok_or(ExecError::Killed)
        };
        let kill_child = Arc::clone(&child_lock);
        let kill_fn = move || async move {
            kill_child.lock().await.kill().await?;
            Ok(())
        }.boxed();

        Ok(ExecChild::new(stdin, stdout, stderr, wait, kill_fn))
    }
}

#[cfg(not(target_os = "windows"))]
pub struct WslExecutor;

#[cfg(not(target_os = "windows"))]
impl WslExecutor {
    pub fn new(_distro: String) -> Self {
        Self
    }
}

#[cfg(not(target_os = "windows"))]
#[async_trait]
impl CommandExecutor for WslExecutor {
    async fn spawn(&self, _cmd: &str, _args: &[&str]) -> Result<ExecChild, ExecError> {
        Err(ExecError::Wsl("WSL is only supported on Windows".to_string()))
    }
}
