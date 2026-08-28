#![allow(unused_imports, missing_docs)]

use std::time::Duration;

use anyhow::Result;
use tokio::io::AsyncWriteExt;

use crate::common::executor::factory::{create_executor, ExecTarget};
use crate::common::executor::sync::collect_child_output;

use super::{classify_stderr, shell_quote, GitExecError, LOCAL_GIT_TIMEOUT};

/// Local execution of `git` via shell (`sh -c "cd work_dir && env git args"`).
pub(crate) async fn run_git_local(
    target: &ExecTarget,
    args: &[&str],
    work_dir: &str,
    env: &[(&str, &str)],
    config_args: Vec<String>,
    timeout: Duration,
) -> Result<String> {
    if work_dir.trim().is_empty() {
        return Err(anyhow::anyhow!(
            "git command called with empty work directory"
        ));
    }
    let executor = create_executor(target);

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

/// Local `run_git_with_stdin`: spawn shell, write stdin, collect output.
pub(crate) async fn run_git_with_stdin_local(
    target: &ExecTarget,
    work_dir: &str,
    env: &[(&str, &str)],
    full_args: &[String],
    command: &str,
    stdin: &[u8],
) -> Result<String> {
    let executor = create_executor(target);

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
            command: command.to_string(),
        }
        .into());
    }
    Ok(stdout_str)
}

/// Local `is_git_repo` check via filesystem.
pub(crate) fn is_git_repo_local(path: &str) -> bool {
    std::path::Path::new(path).join(".git").exists()
}
