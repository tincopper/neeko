//! Local command executor.
//!
//! Spawns processes on the local machine using `tokio::process::Command`
//! with full PATH resolution (fnm, nvm, homebrew, etc.).

use std::sync::Arc;

use async_trait::async_trait;
use futures::FutureExt;
use tokio::process::Command;
use tokio::sync::Mutex;

use super::{BoxAsyncRead, BoxAsyncWrite, CommandExecutor, ExecChild, ExecError};

/// Executor that runs commands on the local machine.
///
/// Binary resolution uses [`crate::common::utils::command::local::resolve_command_path`]
/// with [`crate::common::utils::command::local::resolve_full_path`] so that
/// tools installed via fnm, nvm, npm global, etc. are found even when the
/// Tauri GUI process has a minimal PATH.
pub struct LocalExecutor;

#[async_trait]
impl CommandExecutor for LocalExecutor {
    async fn spawn(&self, cmd: &str, args: &[&str]) -> Result<ExecChild, ExecError> {
        let resolved = crate::common::utils::command::local::resolve_command_path(
            cmd,
            &crate::common::utils::command::local::resolve_full_path(),
        );

        let mut child = Command::new(&resolved)
            .args(args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(ExecError::Io)?;

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
