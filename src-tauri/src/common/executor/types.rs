//! Executor 公共数据类型：stdio 句柄别名、进程输出、子进程句柄、spawn 参数。

use std::future::Future;
use std::pin::Pin;

use tokio::io::{AsyncRead, AsyncWrite};

use super::error::ExecError;

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

/// Handle to a running child process.
///
/// Provides access to stdin / stdout / stderr as async read/write streams,
/// along with wait and kill operations. Local, WSL, and SSH implementations
/// all conform to this same interface so callers never need to branch on
/// the execution environment.
#[allow(clippy::type_complexity)]
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
    /// Best-effort OS / remote process id when known (local, WSL host, SSH remote).
    pub pid: Option<u32>,
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
        Self::new_with_pid(stdin, stdout, stderr, wait, kill_fn, None)
    }

    /// Create a new `ExecChild` including an optional process id.
    #[allow(clippy::type_complexity)]
    pub fn new_with_pid(
        stdin: Option<BoxAsyncWrite>,
        stdout: Option<BoxAsyncRead>,
        stderr: Option<BoxAsyncRead>,
        wait: impl Future<Output = Result<i32, ExecError>> + Send + 'static,
        kill_fn: impl FnOnce() -> Pin<Box<dyn Future<Output = Result<(), ExecError>> + Send>>
            + Send
            + 'static,
        pid: Option<u32>,
    ) -> Self {
        Self {
            stdin,
            stdout,
            stderr,
            wait: Box::pin(wait),
            kill_fn: Box::new(kill_fn),
            pid,
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
        (self.stdin.take(), self.stdout.take(), self.stderr.take())
    }

    /// Consume into wait future + kill future factory (after stdio taken).
    #[allow(clippy::type_complexity)]
    #[must_use]
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
    /// Extra environment variables to set for the command.
    pub env: &'a [(&'a str, &'a str)],
    /// 该 spawn 是否需要**连后代一起清理**（包装器脚本 → 服务进程，如
    /// jdtls → JVM、dlv → 调试目标）。
    ///
    /// 默认 `false`：不改变进程组语义、`kill()` 只杀直接子进程 —— 短命令
    /// （git / 探测 / 克隆）无需树杀，不应被无条件改 `pgid`。
    /// `true` 时：Unix 本地让子进程自成进程组并按组杀；SSH 按远端进程组杀。
    pub kill_tree: bool,
}

impl<'a> SpawnOptions<'a> {
    /// Spawn options without a working directory override.
    #[must_use]
    pub const fn new(cmd: &'a str, args: &'a [&'a str]) -> Self {
        Self {
            cmd,
            args,
            current_dir: None,
            env: &[],
            kill_tree: false,
        }
    }

    /// Set the working directory in the target environment.
    #[must_use]
    pub const fn with_current_dir(mut self, current_dir: &'a str) -> Self {
        self.current_dir = Some(current_dir);
        self
    }

    /// Set the working directory only when `Some`.
    #[must_use]
    pub const fn with_current_dir_if(self, current_dir: Option<&'a str>) -> Self {
        match current_dir {
            Some(dir) => self.with_current_dir(dir),
            None => self,
        }
    }

    /// Set extra environment variables for the command.
    #[must_use]
    pub const fn with_env(mut self, env: &'a [(&'a str, &'a str)]) -> Self {
        self.env = env;
        self
    }

    /// Declare that this spawn may need its whole process tree killed
    /// (wrapper scripts / long-lived trees). See [`SpawnOptions::kill_tree`].
    #[must_use]
    pub const fn with_kill_tree(mut self) -> Self {
        self.kill_tree = true;
        self
    }
}
