//! Git execution transport abstraction (local and network execution with error classification).

#![allow(unused_imports, missing_docs)]

pub mod cancel;
pub mod local;
pub mod ssh;
pub mod wsl;

pub use cancel::{GitSyncGuard, GitSyncHandle, GitSyncSlots};

use std::time::Duration;

use crate::common::executor::factory::{create_executor, ExecTarget};
use crate::common::executor::{
    collect_child_output_streaming_cancellable, with_default_env, ExecChunkSink, ExecError,
    ExecOutput, SpawnOptions,
};
use anyhow::Result;
use async_trait::async_trait;

// ── Timeouts ───────────────────────────────────────────────────────────────

/// Timeout for local (non-network) git commands.
pub(crate) const LOCAL_GIT_TIMEOUT: Duration = Duration::from_secs(30);

/// Wall-clock bound for a git command; `None` = unbounded.
///
/// 长操作（push / fetch / pull / commit）的耗时由 hook 与网络决定、**没有上界** ——
/// 墙钟兜它们只会把「正常慢」误判成失败（2026-10-01 的 push 事故：pre-push 跑测试约
/// 3 分钟，30s 上限先弹失败）。挂死防护走取消通道，而不是把上限调大。
/// 读类命令保留上界：一个卡住的轮询不应占死调用方。策略与依据见
/// `.trellis/spec/backend/git-domain.md`「长操作超时策略」。
#[must_use]
pub(crate) fn git_command_timeout(args: &[&str]) -> Option<Duration> {
    match args.first().copied() {
        Some("push" | "fetch" | "pull" | "commit") => None,
        _ => Some(LOCAL_GIT_TIMEOUT),
    }
}

/// Terminal prompt disabled — all git subprocesses avoid hanging on interactive input.
pub(crate) const GIT_TERMINAL_PROMPT: &str = "0";

// ── 错误分类（AC8）─────────────────────────────────────────────────────────

/// Patterns matching true HTTPS authentication failures — triggers the in-app login dialog.
const AUTH_PATTERNS: &[&str] = &[
    "Authentication failed",
    "could not read Username",
    "could not read Password",
    "HTTP Basic: Access denied",
    "request failed with status 401",
    "Invalid username or password",
    "Support for password authentication was removed",
    "Bad credentials",
];

/// Patterns matching SSH authentication failures — guides the user to configure ssh-agent.
const AUTH_SSH_PATTERNS: &[&str] = &[
    "Permission denied (publickey)",
    "Host key verification failed",
];

/// Patterns matching pure network errors — shows network/remote-unreachable messages.
const NETWORK_PATTERNS: &[&str] = &[
    "fatal: unable to access",
    "Could not resolve host",
    "Connection timed out",
    "Failed to connect",
    "Connection refused",
    "RPC failed",
];

/// Patterns matching ambiguous errors — could be auth (404 for private repos) or network/path.
/// The caller should disambiguate based on context (HTTP 401 vs 404).
const AMBIGUOUS_PATTERNS: &[&str] = &[
    "Could not read from remote repository",
    "Repository not found",
    "The requested URL returned error",
];

/// Classified error kind from git command stderr analysis.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorKind {
    /// HTTPS authentication failure or missing credentials — show login dialog.
    Auth,
    /// SSH authentication failure — guide ssh-agent setup.
    AuthSsh,
    /// Network error — show network unreachable message.
    Network,
    /// Ambiguous (could be auth or network) — caller decides based on context.
    Ambiguous,
    /// Current branch has no upstream configured.
    NoUpstream,
    /// Other or unrecognized error.
    Other,
}

/// Classify git stderr text into an [`ErrorKind`]. Pure function, easy to unit-test.
#[must_use]
pub fn classify_stderr(stderr: &str) -> ErrorKind {
    if AUTH_SSH_PATTERNS.iter().any(|p| stderr.contains(*p)) {
        return ErrorKind::AuthSsh;
    }
    if AUTH_PATTERNS.iter().any(|p| stderr.contains(*p)) {
        return ErrorKind::Auth;
    }
    if NETWORK_PATTERNS.iter().any(|p| stderr.contains(*p)) {
        return ErrorKind::Network;
    }
    if stderr.contains("has no upstream branch") || stderr.contains("no upstream configured") {
        return ErrorKind::NoUpstream;
    }
    if AMBIGUOUS_PATTERNS.iter().any(|p| stderr.contains(*p)) {
        return ErrorKind::Ambiguous;
    }
    ErrorKind::Other
}

/// Git execution error with classified kind and raw output.
///
/// `run_git_opts` returns this wrapped in `anyhow::Error` on non-zero exit.
/// Callers can downcast to inspect `kind`, the original stderr, and the exit code.
#[derive(Debug)]
pub struct GitExecError {
    /// Classified error kind.
    pub kind: ErrorKind,
    /// Raw stderr from the git command.
    pub stderr: String,
    /// Raw stdout from the git command.
    pub stdout: String,
    /// The git command that was executed (for display).
    pub command: String,
    /// Process exit code. `-1` when the command never ran (spawn failure).
    pub exit_code: i32,
}

impl std::fmt::Display for GitExecError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "git command failed: {} (kind={:?}): {}",
            self.command,
            self.kind,
            self.stderr.trim()
        )
    }
}

impl std::error::Error for GitExecError {}

// ── Execution options ──────────────────────────────────────────────────────

/// Execution options for git subprocess: environment variables and `-c key=val` config.
///
/// Use `Default::default()` for the default behaviour (no env, no extra config).
#[derive(Default)]
pub struct GitExecOptions<'a> {
    /// Environment variables to inject into the git process.
    pub env: &'a [(&'a str, &'a str)],
    /// Extra `-c key=val` config entries prepended to the git command.
    pub extra_config: &'a [(&'a str, &'a str)],
}

impl<'a> GitExecOptions<'a> {
    /// Render `extra_config` as `["-c", "key=val", "-c", "key=val", ...]` args.
    pub(crate) fn config_args(&self) -> Vec<String> {
        let mut out = Vec::new();
        for (k, v) in self.extra_config {
            out.push("-c".to_string());
            out.push(format!("{}={}", k, v));
        }
        out
    }
}

// ── Run hooks ──────────────────────────────────────────────────────────────

/// 一次 git 运行的 Console 出口与取消句柄。
///
/// 缺省（[`GitRunHooks::none`]）= 无流式、不可取消：读类命令的常规路径。
/// 长操作由命令层装配 `on_output`（事件发射）与 `cancel`（单飞槽里的句柄）。
///
/// `cancel` 持有 `GitSyncHandle`（watch sender/receiver 的廉价 `Clone`）而非借用：
/// 命令层可在 `begin_git_run` 里一次性产出 hooks，无需自引用生命周期。
#[derive(Clone)]
pub struct GitRunHooks {
    /// 输出块回调（stdout/stderr 按 UTF-8 边界成块到达）。
    pub on_output: Option<ExecChunkSink>,
    /// 取消句柄；触发时杀掉进程树并让本次运行以取消错误结束。
    pub cancel: Option<GitSyncHandle>,
}

impl GitRunHooks {
    /// 无流式、不可取消。
    #[must_use]
    pub const fn none() -> Self {
        Self {
            on_output: None,
            cancel: None,
        }
    }
}

// ── Trait ──────────────────────────────────────────────────────────────────

/// Transport-agnostic git operations trait.
///
/// Each variant knows how to run git commands in its environment
/// (local subprocess, WSL, or SSH remote).
#[async_trait]
pub trait GitTransport: Send + Sync {
    /// Execute a raw git command, returning stdout.
    async fn run_git(&self, args: &[&str], work_dir: &str) -> Result<String>;

    /// Execute a git command with custom options (env, extra config).
    async fn run_git_opts(
        &self,
        args: &[&str],
        work_dir: &str,
        opts: GitExecOptions<'_>,
    ) -> Result<String>;

    /// [`Self::run_git_opts`] 的流式变体：每个 stdout/stderr 文本块到达时即交给
    /// `hooks.on_output`（Console 可见性用），`hooks.cancel` 触发时杀掉进程树；
    /// 聚合返回值与 `run_git_opts` 一致（取消时返回错误）。
    ///
    /// 默认实现忽略 hooks、退化为聚合调用 —— 测试假实现无需改动；
    /// `ExecTarget` 覆写为 Local / WSL / SSH 三路真实流式与取消。
    async fn run_git_opts_streaming(
        &self,
        args: &[&str],
        work_dir: &str,
        opts: GitExecOptions<'_>,
        _hooks: GitRunHooks,
    ) -> Result<String> {
        self.run_git_opts(args, work_dir, opts).await
    }

    /// Execute a git command with stdin bytes (for credential helpers etc.).
    async fn run_git_with_stdin(
        &self,
        args: &[&str],
        work_dir: &str,
        opts: GitExecOptions<'_>,
        stdin: &[u8],
    ) -> Result<String>;

    /// 同步核心：打开本地 git2 仓库。**只允许**同步上下文或已在阻塞池内的调用方使用（红线 3）——
    /// 异步上下文一律用 [`Self::open_repo_async`]。
    /// Returns None for non-Local transports.
    fn open_repo(&self, path: &str) -> Option<git2::Repository>;

    /// 异步入口：打开本地 git2 仓库，阻塞 fs 隔离到阻塞池（红线 3）。
    ///
    /// **刻意没有默认实现**：默认体只能回落同步核心，于是未来的 transport impl 会「默认阻塞」——
    /// 那正是本契约要消灭的形态。缺实现时编译器直接报错，而不是留下一个假异步。
    async fn open_repo_async(&self, path: &str) -> Option<git2::Repository>;

    /// The execution environment this transport targets.
    ///
    /// 用于**平台相关的路径归一**：清单里回传的工作树路径会被前端拼成 `RepoKey`，
    /// 必须与 `RepoRef::key()` 同形 —— Local 需锚定到文件系统 canonical 形态（符号链接 /
    /// 尾分隔符 / `.` 折叠），WSL / SSH 只能词法归一（远端 Linux 路径绝不能经宿主
    /// `std::path`，见 `common/git/unit_path.rs`）。
    fn exec_target(&self) -> ExecTarget;

    /// Check if a directory is a git repo.
    async fn is_git_repo(&self, path: &str) -> bool;
}

// ── Shared helper ──────────────────────────────────────────────────────────

/// POSIX single-quote shell escaping: wraps value in `'...'` and escapes `'` as `'\''`.
pub(crate) fn shell_quote(v: &str) -> String {
    format!("'{}'", v.replace('\'', "'\\''"))
}

/// 共享的「spawn 包装器 → 流式采集 →（可选）墙钟 / 取消」核心。
///
/// Local / WSL / SSH 的差异只有 `program`（`sh` / `bash`）与 shell 命令字符串；
/// 生命周期（stdin 关闭、`kill_tree` 树杀、取消赛跑、错误映射）完全同构 —— 收敛到
/// 这里，避免三份复制各自漂移（其中一个修了另一个忘改）。
///
/// `label` 用于取消 / 超时错误文案；`timeout: None` = 无墙钟（长操作，
/// 见 [`git_command_timeout`]）。
pub(crate) async fn run_shell_streaming(
    target: &ExecTarget,
    program: &str,
    shell_cmd: &str,
    label: &str,
    timeout: Option<Duration>,
    hooks: GitRunHooks,
) -> Result<ExecOutput> {
    let cancelled = || anyhow::anyhow!("git command cancelled: {label}");
    if hooks
        .cancel
        .as_ref()
        .is_some_and(GitSyncHandle::is_cancelled)
    {
        return Err(cancelled());
    }

    let executor = create_executor(target);
    let child = executor
        .spawn_with(SpawnOptions::new(program, &["-c", shell_cmd]).with_kill_tree())
        .await
        .map_err(|e| anyhow::anyhow!("git command failed to spawn: {}", e))?;

    let GitRunHooks { on_output, cancel } = hooks;
    let cancel = async move {
        match cancel {
            Some(handle) => handle.cancelled().await,
            None => std::future::pending::<()>().await,
        }
    };
    let collect = collect_child_output_streaming_cancellable(child, on_output, cancel);
    let output = match timeout {
        Some(limit) => tokio::time::timeout(limit, collect).await.map_err(|_| {
            anyhow::anyhow!("git command timed out after {}s: {label}", limit.as_secs())
        })?,
        None => collect.await,
    }
    .map_err(|e| match e {
        // 取消路径是 Killed 的唯一预期来源（超时只停止等待、不杀进程）。
        ExecError::Killed => cancelled(),
        other => anyhow::anyhow!("failed to collect git output: {}", other),
    })?;
    Ok(output)
}

/// 把 [`ExecOutput`] 收敛成 `run_git*` 的返回值：非零退出 ⇒ 携带真实 stderr / stdout /
/// exit_code 的 [`GitExecError`]；成功 ⇒ stdout 文本。三 transport 共用同一语义。
pub(crate) fn finish_git_output(output: ExecOutput, command: &str) -> Result<String> {
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if output.exit_code != 0 {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(GitExecError {
            kind: classify_stderr(&stderr),
            stderr,
            stdout,
            command: command.to_string(),
            exit_code: output.exit_code,
        }
        .into());
    }
    Ok(stdout)
}

// ── Trait implementation ───────────────────────────────────────────────────

#[async_trait]
impl GitTransport for ExecTarget {
    async fn run_git(&self, args: &[&str], work_dir: &str) -> Result<String> {
        self.run_git_opts(args, work_dir, GitExecOptions::default())
            .await
    }

    async fn run_git_opts(
        &self,
        args: &[&str],
        work_dir: &str,
        opts: GitExecOptions<'_>,
    ) -> Result<String> {
        self.run_git_opts_streaming(args, work_dir, opts, GitRunHooks::none())
            .await
    }

    async fn run_git_opts_streaming(
        &self,
        args: &[&str],
        work_dir: &str,
        opts: GitExecOptions<'_>,
        hooks: GitRunHooks,
    ) -> Result<String> {
        let is_network_op = args
            .first()
            .map(|a| matches!(*a, "push" | "fetch" | "pull" | "clone"))
            .unwrap_or(false);
        let timeout = git_command_timeout(args);

        // 只读语义默认生效（GIT_OPTIONAL_LOCKS=0）：读路径（status 等）不再 refresh index，
        // 避免与 IDE / 用户 git 争 index 锁。见 common::git::git_env 的第一性依据。
        let mut env: Vec<(&str, &str)> = with_default_env("git", opts.env);
        if is_network_op {
            env.push(("GIT_TERMINAL_PROMPT", GIT_TERMINAL_PROMPT));
        }

        let config_args = opts.config_args();

        match self {
            ExecTarget::Local => {
                local::run_git_local(self, args, work_dir, &env, config_args, timeout, hooks).await
            }
            ExecTarget::Wsl { .. } => {
                wsl::run_git_wsl(self, args, work_dir, &env, config_args, hooks).await
            }
            ExecTarget::Remote { .. } => {
                ssh::run_git_remote(self, args, work_dir, &env, config_args, hooks).await
            }
        }
    }

    async fn run_git_with_stdin(
        &self,
        args: &[&str],
        work_dir: &str,
        opts: GitExecOptions<'_>,
        stdin: &[u8],
    ) -> Result<String> {
        // 只读语义默认生效（GIT_OPTIONAL_LOCKS=0）：读路径（status 等）不再 refresh index，
        // 避免与 IDE / 用户 git 争 index 锁。见 common::git::git_env 的第一性依据。
        let mut env: Vec<(&str, &str)> = with_default_env("git", opts.env);
        env.push(("GIT_TERMINAL_PROMPT", GIT_TERMINAL_PROMPT));

        let config_args = opts.config_args();
        let mut full_args: Vec<String> = config_args;
        full_args.extend(args.iter().map(|s| s.to_string()));
        let command = format!("git {}", full_args.join(" "));

        match self {
            ExecTarget::Local => {
                local::run_git_with_stdin_local(self, work_dir, &env, &full_args, &command, stdin)
                    .await
            }
            ExecTarget::Wsl { .. } => {
                ssh::exec_git_with_stdin_remote(self, &full_args, &command, stdin).await
            }
            ExecTarget::Remote { .. } => {
                ssh::exec_git_with_stdin_remote(self, &full_args, &command, stdin).await
            }
        }
    }

    fn open_repo(&self, path: &str) -> Option<git2::Repository> {
        match self {
            ExecTarget::Local => git2::Repository::open(path).ok(),
            ExecTarget::Wsl { .. } => None,
            ExecTarget::Remote { .. } => None,
        }
    }

    async fn open_repo_async(&self, path: &str) -> Option<git2::Repository> {
        match self {
            // git2 open 走文件系统（红线 3）：宿主路径必须在阻塞池内打开。
            ExecTarget::Local => {
                let target = self.clone();
                let dir = path.to_string();
                tokio::task::spawn_blocking(move || target.open_repo(&dir))
                    .await
                    .unwrap_or_else(|e| {
                        log::warn!("[git] open repo task failed for `{path}`: {e}");
                        None
                    })
            }
            // WSL / SSH 不碰宿主 fs：与同步核心同语义（None ⇒ 调用方走 shell 兜底）。
            ExecTarget::Wsl { .. } | ExecTarget::Remote { .. } => None,
        }
    }

    fn exec_target(&self) -> ExecTarget {
        self.clone()
    }

    async fn is_git_repo(&self, path: &str) -> bool {
        match self {
            // `.git` 探测同样是阻塞 fs：async 方法里直接调同步 helper 就是「假异步」。
            ExecTarget::Local => {
                let dir = path.to_string();
                tokio::task::spawn_blocking(move || local::is_git_repo_local(&dir))
                    .await
                    .unwrap_or_else(|e| {
                        log::warn!("[git] is_git_repo task failed for `{path}`: {e}");
                        false
                    })
            }
            ExecTarget::Wsl { .. } => wsl::is_git_repo_wsl(self, path).await,
            ExecTarget::Remote { .. } => ssh::is_git_repo_remote(self, path).await,
        }
    }
}

#[cfg(test)]
mod tests;
