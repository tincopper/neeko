#![allow(unused_imports, missing_docs)]

use anyhow::Result;

use crate::common::executor::factory::ExecTarget;
use crate::common::utils::command::local::safe_path;
use crate::core::exec::run;

use super::{shell_quote, GitRunHooks};

/// WSL execution of `git` via `bash -c`, streaming chunks to `hooks.on_output`.
///
/// 与 `run_git_local` 共享 [`super::run_shell_streaming`]（stdin 立即关闭、聚合返回原始字节）；
/// 失败时 `GitExecError` 携带真实 stderr / stdout / exit_code（此前经 `core::exec::run`
/// 的错误路径只有 Display 文本与 `-1`，与 Local 语义不一致）。
pub(crate) async fn run_git_wsl(
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
    let cmd = format!("cd '{sp}' && {}git {}", env_prefix, config_args.join(" "));

    // WSL 不参与本地墙钟（与旧行为一致：长操作无上限，靠取消通道兜挂死）。
    let output = super::run_shell_streaming(target, "bash", &cmd, &cmd, None, hooks).await?;
    super::finish_git_output(output, &cmd)
}

/// WSL `is_git_repo` check via `test -e` on bash.
pub(crate) async fn is_git_repo_wsl(target: &ExecTarget, path: &str) -> bool {
    let sp = safe_path(path);
    let cmd = format!("test -e '{sp}/.git'");
    run(target, "bash", &["-c", &cmd]).await.is_ok()
}
