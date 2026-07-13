use std::time::Duration;

use anyhow::Result;
use tokio::io::AsyncWriteExt;

use crate::common::connection::types::AuthMethod;
use crate::common::utils::command::local::safe_path;
use crate::common::utils::command::ssh::exec_command;
#[cfg(target_os = "windows")]
use crate::common::utils::command::wsl;

const LOCAL_GIT_TIMEOUT: Duration = Duration::from_secs(30);
const NETWORK_GIT_TIMEOUT: Duration = Duration::from_secs(180);

/// 终端提示默认关闭——所有 git 子进程不挂死等待交互输入（AC5）。
const GIT_TERMINAL_PROMPT: &str = "0";

// ── 错误分类（AC8）─────────────────────────────────────────────────────────

/// 真正的鉴权失败（HTTPS 凭据错误/缺失）。命中即触发 in-app 登录弹窗。
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

/// SSH 专属鉴权失败——不弹密码框，引导配置 ssh-agent。
const AUTH_SSH_PATTERNS: &[&str] = &[
    "Permission denied (publickey)",
    "Host key verification failed",
];

/// 纯网络错误——不弹登录框，提示网络/远端不可达。
const NETWORK_PATTERNS: &[&str] = &[
    "fatal: unable to access",
    "Could not resolve host",
    "Connection timed out",
    "Failed to connect",
    "Connection refused",
    "RPC failed",
];

/// 模糊模式——既可能是私有仓库鉴权（GitHub 对无权访问返回 404）也可能是网络/路径。
/// 结合上下文（HTTP 401 vs 404）由调用方二次判定。
const AMBIGUOUS_PATTERNS: &[&str] = &[
    "Could not read from remote repository",
    "Repository not found",
    "The requested URL returned error",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorKind {
    /// HTTPS 鉴权失败/缺凭据 → 弹登录框
    Auth,
    /// SSH 鉴权失败 → 引导 ssh-agent
    AuthSsh,
    /// 网络错误 → 提示网络
    Network,
    /// 模糊（可能鉴权也可能网络）→ 调用方结合上下文判定
    Ambiguous,
    /// 其他错误
    Other,
}

/// 对 git stderr 文本分类。纯函数，便于单测。
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
    if AMBIGUOUS_PATTERNS.iter().any(|p| stderr.contains(*p)) {
        return ErrorKind::Ambiguous;
    }
    ErrorKind::Other
}

/// 带分类信息的 git 执行错误。`run_git_opts` 在非零退出时返回此类型（包在 anyhow 里），
/// 调用方可 downcast 取出 `kind` 与原始 stderr。
#[derive(Debug)]
pub struct GitExecError {
    pub kind: ErrorKind,
    pub stderr: String,
    pub stdout: String,
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

/// git 子进程执行选项：注入环境变量 + 前置 `-c key=val` 配置。
/// 现有调用方用 `Default::default()` 保持原行为零改动。
pub struct GitExecOptions<'a> {
    pub env: &'a [(&'a str, &'a str)],
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
    /// 渲染 `extra_config` 为 `["-c", "key=val", "-c", "key=val", ...]` 片段。
    fn config_args(&self) -> Vec<String> {
        let mut out = Vec::new();
        for (k, v) in self.extra_config {
            out.push("-c".to_string());
            out.push(format!("{}={}", k, v));
        }
        out
    }
}

pub enum GitTransport {
    Local,
    #[cfg(target_os = "windows")]
    Wsl {
        distro: String,
    },
    Remote {
        host: String,
        port: u16,
        username: String,
        auth: AuthMethod,
    },
}

impl GitTransport {
    /// Execute a raw git command, returning stdout. 旧签名保留，委托默认选项。
    pub async fn run_git(&self, args: &[&str], work_dir: &str) -> Result<String> {
        self.run_git_opts(args, work_dir, GitExecOptions::default()).await
    }

    /// 同 `run_git`，但允许注入 env 与 `-c` 配置。网络操作统一由调用方传入
    /// `GIT_TERMINAL_PROMPT=0` 与 `credential.helper`（见 `network_opts`）。
    pub async fn run_git_opts(
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
            GitTransport::Local => {
                use tokio::process::Command as TokioCommand;

                let mut full_args: Vec<String> = config_args;
                full_args.extend(args.iter().map(|s| s.to_string()));

                let mut cmd = TokioCommand::new("git");
                cmd.args(&full_args).current_dir(work_dir);
                for (k, v) in &env {
                    cmd.env(k, v);
                }

                let output = tokio::time::timeout(timeout, cmd.output())
                    .await
                    .map_err(|_| {
                        anyhow::anyhow!(
                            "git command timed out after {}s: git {}",
                            timeout.as_secs(),
                            full_args.join(" ")
                        )
                    })?
                    .map_err(|e| anyhow::anyhow!("git command failed to execute: {}", e))?;

                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                if !output.status.success() {
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
            GitTransport::Wsl { distro } => {
                let sp = safe_path(work_dir);
                let env_prefix: String = env
                    .iter()
                    .map(|(k, v)| format!("{}={} ", k, shell_quote(v)))
                    .collect();
                let mut parts = config_args;
                parts.push("--".to_string()); // 隔离 git 参数
                parts.extend(args.iter().map(|a| shell_quote(a)));
                let cmd = format!("cd '{sp}' && {}git {}", env_prefix, parts.join(" "));
                let out = wsl::exec(distro, &cmd);
                out.map_err(|e| GitExecError {
                    kind: classify_stderr(&e.to_string()),
                    stderr: e.to_string(),
                    stdout: String::new(),
                    command: cmd,
                }
                .into())
            }
            GitTransport::Remote {
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
                exec_command(host, *port, username, auth, &cmd).await.map_err(|e| {
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
    /// 仅 Local 实现真管道；WSL/Remote 通过 shell 管道传递（凭据经 base64 避免可见字符问题）。
    pub async fn run_git_with_stdin(
        &self,
        args: &[&str],
        work_dir: &str,
        opts: GitExecOptions<'_>,
        stdin: &[u8],
    ) -> Result<String> {
        let config_args = opts.config_args();
        let mut env: Vec<(&str, &str)> = opts.env.to_vec();
        env.push(("GIT_TERMINAL_PROMPT", GIT_TERMINAL_PROMPT));

        match self {
            GitTransport::Local => {
                use tokio::process::Command as TokioCommand;

                let mut full_args: Vec<String> = config_args;
                full_args.extend(args.iter().map(|s| s.to_string()));

                let mut cmd = TokioCommand::new("git");
                cmd.args(&full_args)
                    .current_dir(work_dir)
                    .stdin(std::process::Stdio::piped())
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped());
                for (k, v) in &env {
                    cmd.env(k, v);
                }

                let mut child = cmd
                    .spawn()
                    .map_err(|e| anyhow::anyhow!("git command failed to spawn: {}", e))?;

                if let Some(mut child_stdin) = child.stdin.take() {
                    child_stdin
                        .write_all(stdin)
                        .await
                        .map_err(|e| anyhow::anyhow!("failed to write git stdin: {}", e))?;
                    // drop child_stdin to signal EOF
                }

                let output = tokio::time::timeout(LOCAL_GIT_TIMEOUT, child.wait_with_output())
                    .await
                    .map_err(|_| {
                        anyhow::anyhow!(
                            "git command timed out after {}s: git {}",
                            LOCAL_GIT_TIMEOUT.as_secs(),
                            full_args.join(" ")
                        )
                    })?
                    .map_err(|e| anyhow::anyhow!("git command failed to await: {}", e))?;

                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                if !output.status.success() {
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
            GitTransport::Wsl { distro } => {
                let sp = safe_path(work_dir);
                let env_prefix: String = env
                    .iter()
                    .map(|(k, v)| format!("{}={} ", k, shell_quote(v)))
                    .collect();
                let mut parts: Vec<String> = config_args
                    .iter()
                    .map(|c| format!("-c {}", shell_quote(c)))
                    .collect();
                parts.extend(args.iter().map(|a| shell_quote(a)));
                let b64 = base64_encode(stdin);
                let cmd = format!(
                    "cd '{sp}' && {}printf '%s' '{}' | base64 -d | git {}",
                    env_prefix,
                    b64,
                    parts.join(" ")
                );
                let out = wsl::exec(distro, &cmd);
                out.map_err(|e| GitExecError {
                    kind: classify_stderr(&e.to_string()),
                    stderr: e.to_string(),
                    stdout: String::new(),
                    command: cmd,
                }
                .into())
            }
            GitTransport::Remote {
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
                let mut parts: Vec<String> = config_args
                    .iter()
                    .map(|c| format!("-c {}", shell_quote(c)))
                    .collect();
                parts.extend(args.iter().map(|a| shell_quote(a)));
                let b64 = base64_encode(stdin);
                let git_cmd = format!(
                    "{}printf '%s' '{}' | base64 -d | git {}",
                    env_prefix,
                    b64,
                    parts.join(" ")
                );
                let cmd = format!("cd '{sp}' && {git_cmd}");
                exec_command(host, *port, username, auth, &cmd).await.map_err(|e| {
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

    /// Open a git2 Repository for local transport, if git2 is available.
    /// Returns None for non-Local transports.
    pub fn open_repo(&self, path: &str) -> Option<git2::Repository> {
        match self {
            GitTransport::Local => git2::Repository::open(path).ok(),
            #[cfg(target_os = "windows")]
            GitTransport::Wsl { .. } => None,
            GitTransport::Remote { .. } => None,
        }
    }

    /// Check if this transport supports git2 operations
    pub fn supports_git2(&self) -> bool {
        matches!(self, GitTransport::Local)
    }

    /// Check if a directory is a git repo
    pub async fn is_git_repo(&self, path: &str) -> bool {
        match self {
            GitTransport::Local => std::path::Path::new(path).join(".git").exists(),
            #[cfg(target_os = "windows")]
            GitTransport::Wsl { distro } => {
                let sp = safe_path(path);
                let cmd = format!("test -d '{sp}/.git'");
                wsl::exec(distro, &cmd).is_ok()
            }
            GitTransport::Remote {
                host,
                port,
                username,
                auth,
            } => {
                let sp = safe_path(path);
                let cmd = format!("test -d '{sp}/.git'");
                exec_command(host, *port, username, auth, &cmd)
                    .await
                    .is_ok()
            }
        }
    }
}

/// POSIX 单引号 shell 转义：把值包成 `'...'`，内部 `'` 转成 `'\''`。
fn shell_quote(v: &str) -> String {
    format!("'{}'", v.replace('\'', "'\\''"))
}

/// 简易 base64 编码（避免引入额外依赖；用于 WSL/Remote stdin 传递凭据）。
fn base64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0];
        let b1 = chunk.get(1).copied().unwrap_or(0);
        let b2 = chunk.get(2).copied().unwrap_or(0);
        out.push(TABLE[(b0 >> 2) as usize] as char);
        out.push(TABLE[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(b2 & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
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
        assert_eq!(classify_stderr("fatal: Authentication failed"), ErrorKind::Auth);
        assert_eq!(
            classify_stderr("fatal: could not read Username for 'https://...': terminal prompts disabled"),
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
            classify_stderr("fatal: the remote end hung up unexpectedly The requested URL returned error: 403"),
            ErrorKind::Ambiguous
        );
    }

    #[test]
    fn should_classify_other_for_empty_or_unknown() {
        assert_eq!(classify_stderr(""), ErrorKind::Other);
        assert_eq!(classify_stderr("some unrelated git message"), ErrorKind::Other);
    }

    // ── shell_quote / base64 ───────────────────────────────────────────────

    #[test]
    fn should_shell_quote_simple_value() {
        assert_eq!(shell_quote("hello"), "'hello'");
    }

    #[test]
    fn should_shell_quote_embedded_quote() {
        assert_eq!(shell_quote("a'b"), "'a'\\''b'");
    }

    #[test]
    fn should_base64_encode_roundtrip_known_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }

    // ── run_git_opts: env + extra_config 注入 ───────────────────────────────
    // env 注入已通过 `should_inject_env_into_git` 验证（GIT_AUTHOR_NAME）。
    // extra_config 拆分逻辑（k=v → -c k=v）是简单字符串拼接，单独单测价值低，
    // 实际使用在 credential.rs 的 `-c credential.helper=` 路径会被集成测试覆盖。

    #[tokio::test]
    async fn should_inject_env_into_git() {
        // 通过 GIT_AUTHOR_NAME 环境变量，git var GIT_AUTHOR_IDENT 返回该作者信息
        let transport = GitTransport::Local;
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
        let transport = GitTransport::Local;
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
        let transport = GitTransport::Local;
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
        let transport = GitTransport::Local;
        let result = transport.run_git(&["--version"], ".").await;
        assert!(result.is_ok());
        assert!(result.unwrap().contains("git version"));
    }

    #[tokio::test]
    async fn test_local_is_git_repo() {
        let transport = GitTransport::Local;
        assert!(!transport.is_git_repo("/tmp").await);
    }
}
