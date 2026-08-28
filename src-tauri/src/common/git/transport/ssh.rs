#![allow(unused_imports, missing_docs)]

use anyhow::Result;
use tokio::io::AsyncWriteExt;

use crate::common::executor::factory::{create_executor, ExecTarget};
use crate::common::executor::sync::{collect_child_output, exec_on};
use crate::common::utils::command::local::safe_path;

use super::{classify_stderr, shell_quote, GitExecError};

/// Remote (SSH) execution of `git` via `exec_on` with shell quoting.
pub(crate) async fn run_git_remote(
    target: &ExecTarget,
    args: &[&str],
    work_dir: &str,
    env: &[(&str, &str)],
    mut config_args: Vec<String>,
) -> Result<String> {
    let sp = safe_path(work_dir);
    let env_prefix: String = env
        .iter()
        .map(|(k, v)| format!("{}={} ", k, shell_quote(v)))
        .collect();
    config_args.push("--".to_string());
    config_args.extend(args.iter().map(|a| shell_quote(a)));
    let git_cmd = format!("{}git {}", env_prefix, config_args.join(" "));
    let cmd = format!("cd '{sp}' && {git_cmd}");
    exec_on(target, "sh", &["-c", &cmd]).await.map_err(|e| {
        GitExecError {
            kind: classify_stderr(&e.to_string()),
            stderr: e.to_string(),
            stdout: String::new(),
            command: cmd,
        }
        .into()
    })
}

/// WSL/Remote shared stdin path: spawn git directly, write stdin, collect output.
pub(crate) async fn exec_git_with_stdin_remote(
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

/// Remote `is_git_repo` check via `test -e`.
pub(crate) async fn is_git_repo_remote(target: &ExecTarget, path: &str) -> bool {
    let sp = safe_path(path);
    let cmd = format!("test -e '{sp}/.git'");
    exec_on(target, "sh", &["-c", &cmd]).await.is_ok()
}
