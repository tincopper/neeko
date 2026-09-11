//! [`CommandExecutor`]：Local / WSL / SSH 的统一执行抽象。

use async_trait::async_trait;

use super::error::ExecError;
use super::types::{ExecChild, SpawnOptions};

/// Unified command executor that abstracts over execution environments.
///
/// # Examples
///
/// ```ignore
/// let executor = LocalExecutor;
/// let mut child = executor.spawn("bash", &["-c", "echo hello"]).await?;
/// // read child.stdout, write child.stdin, then child.wait().await
/// ```
#[async_trait]
pub trait CommandExecutor: Send + Sync {
    /// Spawn a command and return a handle to the child process.
    ///
    /// Equivalent to [`spawn_with`](Self::spawn_with) without `current_dir`.
    async fn spawn(&self, cmd: &str, args: &[&str]) -> Result<ExecChild, ExecError> {
        self.spawn_with(SpawnOptions::new(cmd, args)).await
    }

    /// Spawn with optional working directory.
    ///
    /// PATH / login-shell rules:
    /// * Local — host process PATH (after `core::exec_env::init_host_user_path`)
    /// * WSL — distro login shell (`bash -lc`)
    /// * SSH — remote login shell (`bash -lc`)
    async fn spawn_with(&self, opts: SpawnOptions<'_>) -> Result<ExecChild, ExecError>;

    /// Fire-and-forget launch: spawn `cmd` detached and return immediately.
    ///
    /// Default implementation spawns normally and drops the child handle
    /// (process keeps running, stdio pipes close). Concrete executors may
    /// override this — e.g. Local detaches the process group on Unix and uses
    /// `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP` on Windows so GUI apps
    /// (IDEs, browsers) are not tied to the parent's lifetime or console.
    ///
    /// # Default implementation limits
    /// * Only suitable for commands whose stdio is irrelevant — stdout/stderr
    ///   pipes close on drop, so a chatty child may hit SIGPIPE.
    /// * The wait future is discarded, so the child is never reaped (Unix
    ///   zombie until the parent exits).
    /// * WSL/SSH executors MUST override: the default `spawn` bridges a
    ///   channel whose drop would terminate the remote/WSL process.
    async fn spawn_detached(&self, cmd: &str, args: &[&str]) -> Result<(), ExecError> {
        let mut child = self.spawn(cmd, args).await?;
        drop(child.stdin.take());
        drop(child);
        Ok(())
    }
}
