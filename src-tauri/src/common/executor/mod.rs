//! Unified command execution interface.
//!
//! Provides a single [`CommandExecutor`] trait that abstracts over local,
//! WSL, and SSH command execution. Callers use the same API regardless
//! of the target environment.

pub mod factory;
mod local;
mod ssh;
pub mod ssh_auth;
pub mod sync;
mod wsl;

use std::future::Future;
use std::pin::Pin;

use async_trait::async_trait;
use thiserror::Error;
use tokio::io::{AsyncRead, AsyncWrite};

/// Type-erased asynchronous readable stream.
///
/// Child process stdio handles (ChildStdout / ChildStderr) are `Send` but
/// not `Sync`, so we use `Send` alone here.
pub type BoxAsyncRead = Pin<Box<dyn AsyncRead + Send>>;

/// Type-erased asynchronous writable stream.
pub type BoxAsyncWrite = Pin<Box<dyn AsyncWrite + Send>>;

/// Fully collected process output, preserving raw bytes for all exit statuses.
#[must_use]
#[derive(Debug, Eq, PartialEq)]
pub struct ExecOutput {
    /// Raw standard output bytes.
    pub stdout: Vec<u8>,
    /// Raw standard error bytes.
    pub stderr: Vec<u8>,
    /// Numeric process exit code.
    pub exit_code: i32,
}

/// Format command failure using UTF-8 text (prefer stderr, then stdout).
///
/// Avoids dumping raw byte arrays via `Debug`, which is unreadable in UI/logs.
pub fn format_command_failed_msg(code: i32, stdout: &[u8], stderr: &[u8]) -> String {
    let stderr_text = String::from_utf8_lossy(stderr);
    let stdout_text = String::from_utf8_lossy(stdout);
    let stderr_trim = stderr_text.trim();
    let stdout_trim = stdout_text.trim();
    let detail = if !stderr_trim.is_empty() {
        stderr_trim
    } else if !stdout_trim.is_empty() {
        stdout_trim
    } else {
        "(no output)"
    };
    format!("Command failed with code {code}: {detail}")
}

/// Errors that can occur during command execution.
#[derive(Error, Debug)]
pub enum ExecError {
    /// I/O error from the underlying process or channel.
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    /// SSH connection or channel error.
    #[error("SSH error: {0}")]
    Ssh(String),
    /// WSL-specific error.
    #[error("WSL error: {0}")]
    Wsl(String),
    /// Command completed with a non-zero status code.
    #[error("{}", format_command_failed_msg(*.code, .stdout, .stderr))]
    CommandFailed {
        /// Numeric process exit code.
        code: i32,
        /// Raw standard output bytes.
        stdout: Vec<u8>,
        /// Raw standard error bytes.
        stderr: Vec<u8>,
    },
    /// Process was killed by a signal.
    #[error("Process killed by signal")]
    Killed,
    /// Invalid executor configuration.
    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),
}

/// Handle to a running child process.
///
/// Provides access to stdin / stdout / stderr as async read/write streams,
/// along with wait and kill operations. Local, WSL, and SSH implementations
/// all conform to this same interface so callers never need to branch on
/// the execution environment.
pub struct ExecChild {
    /// Standard input stream (write to send data to the process).
    pub stdin: Option<BoxAsyncWrite>,
    /// Standard output stream (read to receive data from the process).
    pub stdout: Option<BoxAsyncRead>,
    /// Standard error stream.
    pub stderr: Option<BoxAsyncRead>,
    /// Future that resolves when the process exits, returning the exit code.
    pub wait: Pin<Box<dyn Future<Output = Result<i32, ExecError>> + Send>>,
    /// Internal kill function — called by [`ExecChild::kill`].
    kill_fn:
        Box<dyn FnOnce() -> Pin<Box<dyn Future<Output = Result<(), ExecError>> + Send>> + Send>,
}

impl ExecChild {
    /// Create a new `ExecChild` from its parts.
    #[allow(clippy::type_complexity)]
    pub fn new(
        stdin: Option<BoxAsyncWrite>,
        stdout: Option<BoxAsyncRead>,
        stderr: Option<BoxAsyncRead>,
        wait: impl Future<Output = Result<i32, ExecError>> + Send + 'static,
        kill_fn: impl FnOnce() -> Pin<Box<dyn Future<Output = Result<(), ExecError>> + Send>>
            + Send
            + 'static,
    ) -> Self {
        Self {
            stdin,
            stdout,
            stderr,
            wait: Box::pin(wait),
            kill_fn: Box::new(kill_fn),
        }
    }

    /// Forcefully kill the child process.
    ///
    /// For local / WSL processes this sends SIGKILL (or equivalent).
    /// For SSH processes this opens a new channel and executes `kill -9`.
    pub async fn kill(self) -> Result<(), ExecError> {
        (self.kill_fn)().await
    }

    /// Take stdio handles and leave wait/kill for lifecycle management.
    #[allow(clippy::type_complexity)]
    pub fn take_stdio(
        &mut self,
    ) -> (
        Option<BoxAsyncWrite>,
        Option<BoxAsyncRead>,
        Option<BoxAsyncRead>,
    ) {
        (
            self.stdin.take(),
            self.stdout.take(),
            self.stderr.take(),
        )
    }

    /// Consume into wait future + kill future factory (after stdio taken).
    #[allow(clippy::type_complexity)]
    pub fn into_wait_and_kill(
        self,
    ) -> (
        Pin<Box<dyn Future<Output = Result<i32, ExecError>> + Send>>,
        Box<dyn FnOnce() -> Pin<Box<dyn Future<Output = Result<(), ExecError>> + Send>> + Send>,
    ) {
        (self.wait, self.kill_fn)
    }
}

/// Options for spawning a command via [`CommandExecutor::spawn_with`].
#[derive(Debug, Clone, Copy)]
pub struct SpawnOptions<'a> {
    /// Program to run (resolved per environment PATH rules).
    pub cmd: &'a str,
    /// Arguments.
    pub args: &'a [&'a str],
    /// Working directory in the target environment (host path for Local,
    /// Linux path for WSL/SSH).
    pub current_dir: Option<&'a str>,
}

impl<'a> SpawnOptions<'a> {
    /// Spawn options without a working directory override.
    pub fn new(cmd: &'a str, args: &'a [&'a str]) -> Self {
        Self {
            cmd,
            args,
            current_dir: None,
        }
    }
}

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
}
