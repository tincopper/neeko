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

/// Which standard stream a chunk of process output came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExecStream {
    /// Standard output.
    Stdout,
    /// Standard error.
    Stderr,
}

/// 输出块回调：`(stream, text)`，`text` 仅在回调调用期间有效。
///
/// 用 `Arc` 持有而非 `&dyn` 借用：借用形态在 `async_trait` 生成的高阶生命周期
/// 边界上无法稳定推导（E0308 / E0521），owned 句柄可在双流读取任务间直接克隆共享。
pub type ExecChunkSink = std::sync::Arc<dyn Fn(ExecStream, &str) + Send + Sync>;

/// 子进程退出 future 的类型。
pub type WaitFuture = Pin<Box<dyn Future<Output = Result<i32, ExecError>> + Send>>;
/// 强制终止 future 的类型。
pub type KillFuture = Pin<Box<dyn Future<Output = Result<(), ExecError>> + Send>>;
/// 可重复调用的强制终止动作。`cancel`（主动终止）与退出收敛**共用同一个动作**：
/// 由 executor 按其执行目标（Local/WSL 本地树杀、SSH 远端 kill）构造，不存在第二条 kill 途径。
pub type KillFn = std::sync::Arc<dyn Fn() -> KillFuture + Send + Sync>;

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
    pub wait: WaitFuture,
    /// 可重复调用的强制终止动作（cancel 与退出收敛共用；见 [`KillFn`]）。
    kill: KillFn,
    /// Best-effort OS / remote process id when known (local, WSL host, SSH remote).
    pub pid: Option<u32>,
}

impl ExecChild {
    /// Create a new `ExecChild` from its parts.
    pub fn new(
        stdin: Option<BoxAsyncWrite>,
        stdout: Option<BoxAsyncRead>,
        stderr: Option<BoxAsyncRead>,
        wait: impl Future<Output = Result<i32, ExecError>> + Send + 'static,
        kill: impl Fn() -> KillFuture + Send + Sync + 'static,
    ) -> Self {
        Self::new_with_pid(stdin, stdout, stderr, wait, kill, None)
    }

    /// Create a new `ExecChild` including an optional process id.
    pub fn new_with_pid(
        stdin: Option<BoxAsyncWrite>,
        stdout: Option<BoxAsyncRead>,
        stderr: Option<BoxAsyncRead>,
        wait: impl Future<Output = Result<i32, ExecError>> + Send + 'static,
        kill: impl Fn() -> KillFuture + Send + Sync + 'static,
        pid: Option<u32>,
    ) -> Self {
        Self {
            stdin,
            stdout,
            stderr,
            wait: Box::pin(wait),
            kill: std::sync::Arc::new(kill),
            pid,
        }
    }

    /// 取出可重复调用的终止动作（退出收敛登记用）；与 [`Self::kill`] 共用**同一动作**。
    #[must_use]
    pub(crate) fn kill_action(&self) -> KillFn {
        std::sync::Arc::clone(&self.kill)
    }

    /// Forcefully kill the child process.
    ///
    /// For local / WSL processes this sends SIGKILL (or equivalent).
    /// For SSH processes this opens a new channel and executes `kill -9`.
    pub async fn kill(self) -> Result<(), ExecError> {
        (self.kill)().await
    }

    /// Take stdio handles and leave wait/kill for lifecycle management.
    pub fn take_stdio(
        &mut self,
    ) -> (
        Option<BoxAsyncWrite>,
        Option<BoxAsyncRead>,
        Option<BoxAsyncRead>,
    ) {
        (self.stdin.take(), self.stdout.take(), self.stderr.take())
    }

    /// Consume into wait future + re-callable kill action (after stdio taken).
    #[must_use = "dropping the tuple drops both the wait future and the kill handle"]
    pub fn into_wait_and_kill(self) -> (WaitFuture, KillFn) {
        (self.wait, self.kill)
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
    /// 默认 `false`：不改变进程组语义、`kill()` 只杀直接子进程 —— 短探测命令
    /// 不需要树杀，不应被无条件改 `pgid`。
    /// `true` 时：Unix 本地让子进程自成进程组并按组杀；SSH 按远端进程组杀。
    /// git 传输层开 `true`：git 会跑 hook（pre-push → pnpm → vitest/cargo），
    /// 取消必须能摘掉整棵测试进程树。
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

    /// Set [`SpawnOptions::kill_tree`] only when `true`.
    #[must_use]
    pub const fn with_kill_tree_if(mut self, kill_tree: bool) -> Self {
        self.kill_tree = kill_tree;
        self
    }
}

/// Options for spawning a **shell script** — see [`CommandExecutor::spawn_script`].
///
/// 与 [`SpawnOptions`] 的区别：调用方只给「一段脚本」，不给命令 / 参数。要不要经
/// shell、用哪个 shell、如何 `cd` / 送达 env 全由执行目标决定（这就是把「执行细节」
/// 收在 executor 的意义）。
///
/// [`CommandExecutor::spawn_script`]: crate::common::executor::CommandExecutor::spawn_script
#[derive(Debug, Clone, Copy)]
pub struct ScriptOptions<'a> {
    /// 脚本内容（调用方不得自带 shell 程序名 / 引号转义）。
    pub script: &'a str,
    /// 目标环境中的工作目录（Local 宿主路径 / WSL·SSH 远端 Linux 路径）。
    pub current_dir: Option<&'a str>,
    /// 额外环境变量。
    pub env: &'a [(&'a str, &'a str)],
    /// 是否需要连后代一起清理（见 [`SpawnOptions::kill_tree`]）。
    pub kill_tree: bool,
}

impl<'a> ScriptOptions<'a> {
    /// Script options without cwd / env.
    #[must_use]
    pub const fn new(script: &'a str) -> Self {
        Self {
            script,
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

    /// Set extra environment variables for the script.
    #[must_use]
    pub const fn with_env(mut self, env: &'a [(&'a str, &'a str)]) -> Self {
        self.env = env;
        self
    }

    /// Declare that this spawn may need its whole process tree killed.
    #[must_use]
    pub const fn with_kill_tree(mut self) -> Self {
        self.kill_tree = true;
        self
    }
}
