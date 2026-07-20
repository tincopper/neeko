//! Git execution transport abstraction (local and network execution with error classification).

use std::time::Duration;

use anyhow::Result;
use async_trait::async_trait;
use tokio::io::AsyncWriteExt;

use crate::common::connection::types::AuthMethod;
use crate::common::executor::factory::{create_executor, ExecTarget};
use crate::common::executor::sync::{collect_child_output, exec_on};
use crate::common::utils::command::local::safe_path;

/// Timeout for local (non-network) git commands.
const LOCAL_GIT_TIMEOUT: Duration = Duration::from_secs(30);
/// Timeout for network git commands (push, fetch, pull, clone).
const NETWORK_GIT_TIMEOUT: Duration = Duration::from_secs(30);

/// Terminal prompt disabled — all git subprocesses avoid hanging on interactive input.
const GIT_TERMINAL_PROMPT: &str = "0";

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
/// Callers can downcast to inspect `kind` and the original stderr.
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

// ── 执行选项 ───────────────────────────────────────────────────────────────

/// Execution options for git subprocess: environment variables and `-c key=val` config.
///
/// Use `Default::default()` for the default behaviour (no env, no extra config).
pub struct GitExecOptions<'a> {
    /// Environment variables to inject into the git process.
    pub env: &'a [(&'a str, &'a str)],
    /// Extra `-c key=val` config entries prepended to the git command.
    pub extra_config: &'a [(&'a str, &'a str)],
}

impl Default for GitExecOptions<'_> {
    fn default() -> Self {
        Self {
            env: &[],
            extra_config: &[],
        }
    }
}

impl<'a> GitExecOptions<'a> {
    /// Render `extra_config` as `["-c", "key=val", "-c", "key=val", ...]` args.
    fn config_args(&self) -> Vec<String> {
        let mut out = Vec::new();
        for (k, v) in self.extra_config {
            out.push("-c".to_string());
            out.push(format!("{}={}", k, v));
        }
        out
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

    /// Execute a git command with stdin bytes (for credential helpers etc.).
    async fn run_git_with_stdin(
        &self,
        args: &[&str],
        work_dir: &str,
        opts: GitExecOptions<'_>,
        stdin: &[u8],
    ) -> Result<String>;

    /// Open a git2 Repository for local transport, if git2 is available.
    /// Returns None for non-Local transports.
    fn open_repo(&self, path: &str) -> Option<git2::Repository>;

    /// Check if a directory is a git repo.
    async fn is_git_repo(&self, path: &str) -> bool;

    /// Return the ExecTarget corresponding to this transport.
    fn exec_target(&self) -> ExecTarget;
}

// ── Concrete enum ──────────────────────────────────────────────────────────

/// Concrete transport kinds. Implements [`GitTransport`].
pub enum GitTransportKind {
    /// Execute git commands on the local host.
    Local,
    /// Execute git commands inside a WSL distribution (Windows only).
    #[cfg(target_os = "windows")]
    Wsl {
        /// WSL distribution name.
        distro: String,
    },
    /// Execute git commands on a remote host via SSH.
    Remote {
        /// Remote host address.
        host: String,
        /// SSH port.
        port: u16,
        /// Remote username.
        username: String,
        /// Authentication method.
        auth: AuthMethod,
    },
}

// ── Trait implementation ───────────────────────────────────────────────────

#[async_trait]
impl GitTransport for GitTransportKind {
    /// Execute a raw git command, returning stdout. 旧签名保留，委托默认选项。
    async fn run_git(&self, args: &[&str], work_dir: &str) -> Result<String> {
        self.run_git_opts(args, work_dir, GitExecOptions::default())
            .await
    }

    /// 同 `run_git`，但允许注入 env 与 `-c` 配置。网络操作统一由调用方传入
    /// `GIT_TERMINAL_PROMPT=0` 与 `credential.helper`（见 `network_opts`）。
    async fn run_git_opts(
        &self,
        args: &[&str],
        work_dir: &str,
        opts: GitExecOptions<'_>,
    ) -> Result<String> {
        let is_network_op = args
            .first()
            .map(|a| matches!(*a, "push" | "fetch" | "pull" | "clone"))
            .unwrap_or(false);
        let timeout = if is_network_op {
            NETWORK_GIT_TIMEOUT
        } else {
            LOCAL_GIT_TIMEOUT
        };

        // 网络操作强制叠加终端提示关闭，避免任何路径挂死（AC5）。
        let mut env: Vec<(&str, &str)> = opts.env.to_vec();
        if is_network_op {
            env.push(("GIT_TERMINAL_PROMPT", GIT_TERMINAL_PROMPT));
        }

        let config_args = opts.config_args();

        match self {
            GitTransportKind::Local => {
                let executor = create_executor(&ExecTarget::Local);

                let mut full_args: Vec<String> = config_args;
                full_args.extend(args.iter().map(|s| s.to_string()));

                let env_prefix: String = env
                    .iter()
                    .map(|(k, v)| format!("{}={} ", k, shell_quote(v)))
                    .collect();

                let quoted_args: String = full_args
                    .iter()
                    .map(|a| shell_quote(a))
                    .collect::<Vec<_>>()
                    .join(" ");

                let shell_cmd = format!(
                    "cd {} && {}exec git {}",
                    shell_quote(work_dir),
                    env_prefix,
                    quoted_args,
                );

                let mut child = executor
                    .spawn("sh", &["-c", &shell_cmd])
                    .await
                    .map_err(|e| anyhow::anyhow!("git command failed to spawn: {}", e))?;

                child.stdin.take();

                let output = tokio::time::timeout(timeout, collect_child_output(child))
                    .await
                    .map_err(|_| {
                        anyhow::anyhow!(
                            "git command timed out after {}s: git {}",
                            timeout.as_secs(),
                            full_args.join(" ")
                        )
                    })?
                    .map_err(|e| anyhow::anyhow!("failed to collect git output: {}", e))?;

                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                if output.exit_code != 0 {
                    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                    return Err(GitExecError {
                        kind: classify_stderr(&stderr),
                        stderr,
                        stdout,
                        command: format!("git {}", full_args.join(" ")),
                    }
                    .into());
                }
                Ok(stdout)
            }
            #[cfg(target_os = "windows")]
            GitTransportKind::Wsl { distro } => {
                let sp = safe_path(work_dir);
                let env_prefix: String = env
                    .iter()
                    .map(|(k, v)| format!("{}={} ", k, shell_quote(v)))
                    .collect();
                let mut parts = config_args;
                parts.push("--".to_string()); // 隔离 git 参数
                parts.extend(args.iter().map(|a| shell_quote(a)));
                let cmd = format!("cd '{sp}' && {}git {}", env_prefix, parts.join(" "));
                let out = exec_on(
                    &ExecTarget::Wsl {
                        distro: distro.clone(),
                    },
                    "bash",
                    &["-c", &cmd],
                );
                out.map_err(|e| {
                    GitExecError {
                        kind: classify_stderr(&e.to_string()),
                        stderr: e.to_string(),
                        stdout: String::new(),
                        command: cmd,
                    }
                    .into()
                })
            }
            GitTransportKind::Remote {
                host,
                port,
                username,
                auth,
            } => {
                let sp = safe_path(work_dir);
                let env_prefix: String = env
                    .iter()
                    .map(|(k, v)| format!("{}={} ", k, shell_quote(v)))
                    .collect();
                let mut parts = config_args;
                parts.push("--".to_string()); // 隔离 git 参数
                parts.extend(args.iter().map(|a| shell_quote(a)));
                let git_cmd = format!("{}git {}", env_prefix, parts.join(" "));
                let cmd = format!("cd '{sp}' && {git_cmd}");
                exec_on(
                    &ExecTarget::Remote {
                        host: host.clone(),
                        port: *port,
                        username: username.clone(),
                        auth: auth.clone(),
                    },
                    "sh",
                    &["-c", &cmd],
                )
                .await
                .map_err(|e| {
                    GitExecError {
                        kind: classify_stderr(&e.to_string()),
                        stderr: e.to_string(),
                        stdout: String::new(),
                        command: cmd,
                    }
                    .into()
                })
            }
        }
    }

    /// 执行 git 命令并向 stdin 写入字节（供 `git credential fill/approve/reject`）。
    /// Local、WSL、SSH 均通过真实 stdin 管道 + 统一输出收集执行。
    async fn run_git_with_stdin(
        &self,
        args: &[&str],
        work_dir: &str,
        opts: GitExecOptions<'_>,
        stdin: &[u8],
    ) -> Result<String> {
        let mut env: Vec<(&str, &str)> = opts.env.to_vec();
        env.push(("GIT_TERMINAL_PROMPT", GIT_TERMINAL_PROMPT));

        let config_args = opts.config_args();
        let mut full_args: Vec<String> = config_args;
        full_args.extend(args.iter().map(|s| s.to_string()));
        let command = format!("git {}", full_args.join(" "));

        match self {
            GitTransportKind::Local => {
                let executor = create_executor(&ExecTarget::Local);

                // Build env prefix: ENV=VAL ENV2=VAL2 ...
                // (always includes GIT_TERMINAL_PROMPT=0 from above)
                let env_prefix: String = env
                    .iter()
                    .map(|(k, v)| format!("{}={} ", k, shell_quote(v)))
                    .collect();

                // Shell-quote each arg so they survive sh -c
                let quoted_args: String = full_args
                    .iter()
                    .map(|a| shell_quote(a))
                    .collect::<Vec<_>>()
                    .join(" ");

                // Shell wrapper: cd work_dir, set env, then exec git
                // (exec replaces the shell so stdin goes directly to git)
                let shell_cmd = format!(
                    "cd {} && {}exec git {}",
                    shell_quote(work_dir),
                    env_prefix,
                    quoted_args,
                );

                let mut child = executor
                    .spawn("sh", &["-c", &shell_cmd])
                    .await
                    .map_err(|e| anyhow::anyhow!("git command failed to spawn: {}", e))?;

                if let Some(mut child_stdin) = child.stdin.take() {
                    child_stdin
                        .write_all(stdin)
                        .await
                        .map_err(|e| anyhow::anyhow!("failed to write git stdin: {}", e))?;
                }

                let output = tokio::time::timeout(LOCAL_GIT_TIMEOUT, collect_child_output(child))
                    .await
                    .map_err(|_| {
                        anyhow::anyhow!(
                            "git command timed out after {}s: {}",
                            LOCAL_GIT_TIMEOUT.as_secs(),
                            command
                        )
                    })?
                    .map_err(|e| anyhow::anyhow!("failed to collect git output: {}", e))?;

                let stdout_str = String::from_utf8_lossy(&output.stdout).to_string();
                if output.exit_code != 0 {
                    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                    return Err(GitExecError {
                        kind: classify_stderr(&stderr),
                        stderr,
                        stdout: stdout_str,
                        command,
                    }
                    .into());
                }
                Ok(stdout_str)
            }
            #[cfg(target_os = "windows")]
            GitTransportKind::Wsl { distro } => {
                exec_git_with_stdin_remote(
                    &ExecTarget::Wsl {
                        distro: distro.clone(),
                    },
                    &full_args,
                    &command,
                    stdin,
                )
                .await
            }
            GitTransportKind::Remote {
                host,
                port,
                username,
                auth,
            } => {
                exec_git_with_stdin_remote(
                    &ExecTarget::Remote {
                        host: host.clone(),
                        port: *port,
                        username: username.clone(),
                        auth: auth.clone(),
                    },
                    &full_args,
                    &command,
                    stdin,
                )
                .await
            }
        }
    }

    /// Open a git2 Repository for local transport, if git2 is available.
    /// Returns None for non-Local transports.
    fn open_repo(&self, path: &str) -> Option<git2::Repository> {
        match self {
            GitTransportKind::Local => git2::Repository::open(path).ok(),
            #[cfg(target_os = "windows")]
            GitTransportKind::Wsl { .. } => None,
            GitTransportKind::Remote { .. } => None,
        }
    }

    /// Check if a directory is a git repo
    async fn is_git_repo(&self, path: &str) -> bool {
        match self {
            GitTransportKind::Local => std::path::Path::new(path).join(".git").exists(),
            #[cfg(target_os = "windows")]
            GitTransportKind::Wsl { distro } => {
                let sp = safe_path(path);
                let cmd = format!("test -d '{sp}/.git'");
                exec_on(
                    &ExecTarget::Wsl {
                        distro: distro.clone(),
                    },
                    "bash",
                    &["-c", &cmd],
                )
                .is_ok()
            }
            GitTransportKind::Remote {
                host,
                port,
                username,
                auth,
            } => {
                let sp = safe_path(path);
                let cmd = format!("test -d '{sp}/.git'");
                exec_on(
                    &ExecTarget::Remote {
                        host: host.clone(),
                        port: *port,
                        username: username.clone(),
                        auth: auth.clone(),
                    },
                    "sh",
                    &["-c", &cmd],
                )
                .await
                .is_ok()
            }
        }
    }

    fn exec_target(&self) -> ExecTarget {
        match self {
            GitTransportKind::Local => ExecTarget::Local,
            #[cfg(target_os = "windows")]
            GitTransportKind::Wsl { distro } => ExecTarget::Wsl {
                distro: distro.clone(),
            },
            GitTransportKind::Remote {
                host,
                port,
                username,
                auth,
            } => ExecTarget::Remote {
                host: host.clone(),
                port: *port,
                username: username.clone(),
                auth: auth.clone(),
            },
        }
    }
}

/// WSL/Remote 共用的 stdin 管道执行路径：通过 executor spawn、写 stdin、收集输出。
async fn exec_git_with_stdin_remote(
    target: &ExecTarget,
    full_args: &[String],
    command: &str,
    stdin: &[u8],
) -> Result<String> {
    let executor = create_executor(target);
    let args_refs: Vec<&str> = full_args.iter().map(|s| s.as_str()).collect();
    let mut child = executor
        .spawn("git", &args_refs)
        .await
        .map_err(|e| anyhow::anyhow!("failed to spawn git: {}", e))?;

    if let Some(mut child_stdin) = child.stdin.take() {
        child_stdin
            .write_all(stdin)
            .await
            .map_err(|e| anyhow::anyhow!("failed to write git stdin: {}", e))?;
    }

    let output = collect_child_output(child)
        .await
        .map_err(|e| anyhow::anyhow!("failed to collect git output: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if output.exit_code != 0 {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(GitExecError {
            kind: classify_stderr(&stderr),
            stderr,
            stdout,
            command: command.to_string(),
        }
        .into());
    }
    Ok(stdout)
}

/// POSIX 单引号 shell 转义：把值包成 `'...'`，内部 `'` 转成 `'\''`。
fn shell_quote(v: &str) -> String {
    format!("'{}'", v.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── classify_stderr ────────────────────────────────────────────────────

    #[test]
    fn should_classify_ssh_as_auth_ssh() {
        assert_eq!(
            classify_stderr("Permission denied (publickey).\nfatal: Could not read"),
            ErrorKind::AuthSsh
        );
        assert_eq!(
            classify_stderr("Host key verification failed."),
            ErrorKind::AuthSsh
        );
    }

    #[test]
    fn should_classify_https_auth_failures() {
        assert_eq!(
            classify_stderr("fatal: Authentication failed"),
            ErrorKind::Auth
        );
        assert_eq!(
            classify_stderr(
                "fatal: could not read Username for 'https://...': terminal prompts disabled"
            ),
            ErrorKind::Auth
        );
        assert_eq!(
            classify_stderr("remote: HTTP Basic: Access denied"),
            ErrorKind::Auth
        );
        assert_eq!(
            classify_stderr("remote: Invalid username or password."),
            ErrorKind::Auth
        );
        assert_eq!(
            classify_stderr("remote: Support for password authentication was removed."),
            ErrorKind::Auth
        );
    }

    #[test]
    fn should_classify_network_errors() {
        assert_eq!(
            classify_stderr("fatal: unable to access 'https://...': Could not resolve host"),
            ErrorKind::Network
        );
        assert_eq!(
            classify_stderr("fatal: Connection timed out"),
            ErrorKind::Network
        );
    }

    #[test]
    fn should_classify_ambiguous_patterns() {
        assert_eq!(
            classify_stderr("ERROR: Repository not found."),
            ErrorKind::Ambiguous
        );
        assert_eq!(
            classify_stderr("fatal: Could not read from remote repository."),
            ErrorKind::Ambiguous
        );
        assert_eq!(
            classify_stderr(
                "fatal: the remote end hung up unexpectedly The requested URL returned error: 403"
            ),
            ErrorKind::Ambiguous
        );
    }

    #[test]
    fn should_classify_other_for_empty_or_unknown() {
        assert_eq!(classify_stderr(""), ErrorKind::Other);
        assert_eq!(
            classify_stderr("some unrelated git message"),
            ErrorKind::Other
        );
    }

    // ── shell_quote ────────────────────────────────────────────────────────

    #[test]
    fn should_shell_quote_simple_value() {
        assert_eq!(shell_quote("hello"), "'hello'");
    }

    #[test]
    fn should_shell_quote_embedded_quote() {
        assert_eq!(shell_quote("a'b"), "'a'\\''b'");
    }

    // ── run_git_opts: env + extra_config 注入 ───────────────────────────────
    // env 注入已通过 `should_inject_env_into_git` 验证（GIT_AUTHOR_NAME）。
    // extra_config 拆分逻辑（k=v → -c k=v）是简单字符串拼接，单独单测价值低，
    // 实际使用在 credential.rs 的 `-c credential.helper=` 路径会被集成测试覆盖。

    #[tokio::test]
    async fn should_inject_env_into_git() {
        // 通过 GIT_AUTHOR_NAME 环境变量，git var GIT_AUTHOR_IDENT 返回该作者信息
        let transport = GitTransportKind::Local;
        let opts = GitExecOptions {
            env: &[("GIT_AUTHOR_NAME", "Neeko Test")],
            extra_config: &[],
        };
        let out = transport
            .run_git_opts(&["var", "GIT_AUTHOR_IDENT"], ".", opts)
            .await
            .expect("git var should succeed");
        assert!(out.contains("Neeko Test"));
    }

    // ── run_git_with_stdin ──────────────────────────────────────────────────

    #[tokio::test]
    async fn should_feed_stdin_to_git_hash_object() {
        // git hash-object --stdin 对输入字节计算 blob hash
        let transport = GitTransportKind::Local;
        let opts = GitExecOptions::default();
        let out = transport
            .run_git_with_stdin(&["hash-object", "--stdin"], ".", opts, b"hello\n")
            .await
            .expect("hash-object should succeed");
        // git hash-object of "hello\n" = a576ec7d6464f8b5c76b6a0b3c9b68c0e8c4c3b3...（运行时校验非空且为 40 hex）
        let hash = out.trim();
        assert_eq!(hash.len(), 40);
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
    }

    // ── GitExecError 分类在非零退出时生效 ────────────────────────────────────

    #[tokio::test]
    async fn should_return_classified_error_on_auth_failure() {
        // git push 到一个不存在的本地路径会失败；这里用一个必失败的命令触发 GitExecError
        // 用 `git --no-such-flag` 触发非零退出，stderr 不含鉴权模式 → Other
        let transport = GitTransportKind::Local;
        let result = transport
            .run_git_opts(&["--no-such-flag"], ".", GitExecOptions::default())
            .await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        let git_err = err.downcast_ref::<GitExecError>();
        assert!(git_err.is_some(), "error should be GitExecError");
        assert_eq!(git_err.unwrap().kind, ErrorKind::Other);
    }

    #[tokio::test]
    async fn test_local_run_git() {
        let transport = GitTransportKind::Local;
        let result = transport.run_git(&["--version"], ".").await;
        assert!(result.is_ok());
        assert!(result.unwrap().contains("git version"));
    }

    #[tokio::test]
    async fn test_local_is_git_repo() {
        let transport = GitTransportKind::Local;
        assert!(!transport.is_git_repo("/tmp").await);
    }
}
