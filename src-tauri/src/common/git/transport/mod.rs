//! Git execution transport abstraction (local and network execution with error classification).

#![allow(unused_imports, missing_docs)]

pub mod local;
pub mod ssh;
pub mod wsl;

use std::time::Duration;

use anyhow::Result;
use async_trait::async_trait;

use crate::common::executor::factory::ExecTarget;

// ── Timeouts ───────────────────────────────────────────────────────────────

/// Timeout for local (non-network) git commands.
pub(crate) const LOCAL_GIT_TIMEOUT: Duration = Duration::from_secs(30);
/// Timeout for network git commands (push, fetch, pull, clone).
pub(crate) const NETWORK_GIT_TIMEOUT: Duration = Duration::from_secs(30);

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
}

// ── Shared helper ──────────────────────────────────────────────────────────

/// POSIX single-quote shell escaping: wraps value in `'...'` and escapes `'` as `'\''`.
pub(crate) fn shell_quote(v: &str) -> String {
    format!("'{}'", v.replace('\'', "'\\''"))
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
        let is_network_op = args
            .first()
            .map(|a| matches!(*a, "push" | "fetch" | "pull" | "clone"))
            .unwrap_or(false);
        let timeout = if is_network_op {
            NETWORK_GIT_TIMEOUT
        } else {
            LOCAL_GIT_TIMEOUT
        };

        let mut env: Vec<(&str, &str)> = opts.env.to_vec();
        if is_network_op {
            env.push(("GIT_TERMINAL_PROMPT", GIT_TERMINAL_PROMPT));
        }

        let config_args = opts.config_args();

        match self {
            ExecTarget::Local => {
                local::run_git_local(self, args, work_dir, &env, config_args, timeout).await
            }
            ExecTarget::Wsl { .. } => {
                wsl::run_git_wsl(self, args, work_dir, &env, config_args).await
            }
            ExecTarget::Remote { .. } => {
                ssh::run_git_remote(self, args, work_dir, &env, config_args).await
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
        let mut env: Vec<(&str, &str)> = opts.env.to_vec();
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

    async fn is_git_repo(&self, path: &str) -> bool {
        match self {
            ExecTarget::Local => local::is_git_repo_local(path),
            ExecTarget::Wsl { .. } => wsl::is_git_repo_wsl(self, path).await,
            ExecTarget::Remote { .. } => ssh::is_git_repo_remote(self, path).await,
        }
    }
}

#[cfg(test)]
mod tests;
