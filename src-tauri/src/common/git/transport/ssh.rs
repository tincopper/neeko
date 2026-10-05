#![allow(unused_imports, missing_docs)]

use anyhow::Result;
use tokio::io::AsyncWriteExt;

use crate::common::executor::collect_child_output;
use crate::common::executor::factory::{create_executor, ExecTarget};
use crate::common::utils::command::local::safe_path;
use crate::core::exec::run;

use super::{classify_stderr, shell_quote, GitExecError, GitRunHooks};

/// Remote (SSH) execution of `git` via a remote shell, streaming output chunks.
///
/// 与 `run_git_local` / `run_git_wsl` 共享 [`super::run_shell_streaming`]；失败时携带真实
/// stderr / stdout / exit_code。
pub(crate) async fn run_git_remote(
    target: &ExecTarget,
    args: &[&str],
    work_dir: &str,
    env: &[(&str, &str)],
    mut config_args: Vec<String>,
    hooks: GitRunHooks,
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

    // SSH 不参与本地墙钟（与旧行为一致：长操作无上限，靠取消通道兜挂死）。
    let output = super::run_shell_streaming(target, "sh", &cmd, &cmd, None, hooks).await?;
    super::finish_git_output(output, &cmd)
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
            exit_code: output.exit_code,
        }
        .into());
    }
    Ok(stdout)
}

/// Remote `is_git_repo` check via `test -e`.
pub(crate) async fn is_git_repo_remote(target: &ExecTarget, path: &str) -> bool {
    let sp = safe_path(path);
    let cmd = format!("test -e '{sp}/.git'");
    run(target, "sh", &["-c", &cmd]).await.is_ok()
}
