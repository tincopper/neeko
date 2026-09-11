//! Executor 错误类型与失败消息格式化。

use thiserror::Error;

/// Format command failure using UTF-8 text (prefer stderr, then stdout).
///
/// Avoids dumping raw byte arrays via `Debug`, which is unreadable in UI/logs.
#[must_use]
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
