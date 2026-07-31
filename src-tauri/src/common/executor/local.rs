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
            .envs(opts.env.iter().copied())
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            // 与旧 `common::utils::command::local::exec` 对齐：隐藏控制台窗口。
            command.creation_flags(crate::common::utils::command::local::flags::CREATE_NO_WINDOW);
        }
        if let Some(dir) = opts.current_dir {
            command.current_dir(dir);
        }

        let mut child = command.spawn().map_err(ExecError::Io)?;
        let pid = child.id();

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

        Ok(ExecChild::new_with_pid(
            stdin, stdout, stderr, wait, kill_fn, pid,
        ))
    }

    /// Detached GUI / long-lived process launch (IDE, default browser, …).
    ///
    /// Stdio is nulled (no pipes to leak), Unix spawns a new process group so
    /// signals to the parent don't propagate, Windows detaches the process so
    /// it outlives the parent console / lifetime.
    async fn spawn_detached(&self, cmd: &str, args: &[&str]) -> Result<(), ExecError> {
        let path = crate::common::utils::command::local::resolve_full_path();
        let resolved = crate::common::utils::command::local::resolve_command_path(cmd, &path);

        let mut command = Command::new(&resolved);
        command
            .args(args)
            .env("PATH", &path)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        #[cfg(target_os = "windows")]
        {
            use crate::common::utils::command::local::flags;
            use std::os::windows::process::CommandExt;
            command.creation_flags(
                flags::CREATE_NO_WINDOW | flags::DETACHED_PROCESS | flags::CREATE_NEW_PROCESS_GROUP,
            );
        }
        #[cfg(unix)]
        {
            command.process_group(0);
        }

        command.spawn().map_err(ExecError::Io)?;
        Ok(())
    }
}
