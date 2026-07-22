//! Local command executor.
//!
//! Spawns processes on the local machine using `tokio::process::Command`
//! with host PATH resolution (process PATH after `core::exec_env` init,
//! plus common package-manager extras via `resolve_full_path`).

use std::sync::Arc;

use async_trait::async_trait;
use futures::FutureExt;
use tokio::process::Command;
use tokio::sync::Mutex;

use super::{BoxAsyncRead, BoxAsyncWrite, CommandExecutor, ExecChild, ExecError, SpawnOptions};

/// Executor that runs commands on the local machine.
///
/// Binary resolution uses [`crate::common::utils::command::local::resolve_command_path`]
/// with [`crate::common::utils::command::local::resolve_full_path`]. The resolved
/// PATH is also injected into the child env so shebang scripts (`#!/usr/bin/env node`)
/// keep working.
pub struct LocalExecutor;

#[async_trait]
impl CommandExecutor for LocalExecutor {
    async fn spawn_with(&self, opts: SpawnOptions<'_>) -> Result<ExecChild, ExecError> {
        let path = crate::common::utils::command::local::resolve_full_path();
        let resolved = crate::common::utils::command::local::resolve_command_path(opts.cmd, &path);

        let mut command = Command::new(&resolved);
        command
            .args(opts.args)
            .env("PATH", &path)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        if let Some(dir) = opts.current_dir {
            command.current_dir(dir);
        }

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
