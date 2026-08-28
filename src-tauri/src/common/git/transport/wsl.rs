#![allow(unused_imports, missing_docs)]

use anyhow::Result;

use crate::common::executor::factory::ExecTarget;
use crate::common::executor::sync::exec_on;
use crate::common::utils::command::local::safe_path;

use super::{classify_stderr, shell_quote, GitExecError};

/// WSL execution of `git` via `bash -c`.
pub(crate) async fn run_git_wsl(
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
    let cmd = format!("cd '{sp}' && {}git {}", env_prefix, config_args.join(" "));
    exec_on(target, "bash", &["-c", &cmd]).await.map_err(|e| {
        GitExecError {
            kind: classify_stderr(&e.to_string()),
            stderr: e.to_string(),
            stdout: String::new(),
            command: cmd,
        }
        .into()
    })
}

/// WSL `is_git_repo` check via `test -e` on bash.
pub(crate) async fn is_git_repo_wsl(target: &ExecTarget, path: &str) -> bool {
    let sp = safe_path(path);
    let cmd = format!("test -e '{sp}/.git'");
    exec_on(target, "bash", &["-c", &cmd]).await.is_ok()
}
