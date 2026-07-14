//! Unified command execution interface.
//!
//! Provides a single [`CommandExecutor`] trait that abstracts over local,
//! WSL, and SSH command execution. Callers use the same API regardless
//! of the target environment.

mod local;
mod ssh;

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
    /// Process exited with a non-zero status code.
    #[error("Process exited with code: {0}")]
    ExitCode(i32),
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
    /// `cmd` is the program to run. Resolution follows environment-specific
    /// PATH rules (local uses `resolve_full_path`, WSL uses WSL's own PATH,
    /// SSH uses the remote server's PATH).
    async fn spawn(&self, cmd: &str, args: &[&str]) -> Result<ExecChild, ExecError>;
}
