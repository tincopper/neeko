//! Cross-environment command execution facade.
//!
//! Business code should prefer this module over calling
//! [`crate::common::utils::command::local`] spawn helpers or constructing
//! environment-specific shells by hand. All runs go through
//! [`crate::common::executor`].
//!
//! **Existence checks and runs must use the project environment**
//! ([`ProjectEnvironment`] / [`ExecTarget`]), not the host alone — agents and
//! tools for WSL/SSH projects live in those environments.

use crate::common::executor::factory::{create_executor, ExecTarget};
use crate::common::executor::sync::{collect_output, exec_on};
use crate::common::executor::{ExecChild, ExecError, ExecOutput};
use crate::core::exec_env;
use crate::core::project::ProjectEnvironment;

/// Run a command on `target` and return UTF-8 stdout on success.
pub async fn run(target: &ExecTarget, cmd: &str, args: &[&str]) -> Result<String, ExecError> {
    exec_on(target, cmd, args).await
}

/// Run a command in the project's execution environment.
pub async fn run_on_project(
    env: &ProjectEnvironment,
    cmd: &str,
    args: &[&str],
) -> Result<String, ExecError> {
    let target = env.to_exec_target();
    run(&target, cmd, args).await
}

/// Spawn a long-lived process (stdio pipes) on `target`.
pub async fn spawn(target: &ExecTarget, cmd: &str, args: &[&str]) -> Result<ExecChild, ExecError> {
    create_executor(target).spawn(cmd, args).await
}

/// Spawn with optional working directory in the target environment.
pub async fn spawn_with(
    target: &ExecTarget,
    cmd: &str,
    args: &[&str],
    current_dir: Option<&str>,
) -> Result<ExecChild, ExecError> {
    use crate::common::executor::SpawnOptions;
    create_executor(target)
        .spawn_with(SpawnOptions {
            cmd,
            args,
            current_dir,
        })
        .await
}

/// Collect raw stdout/stderr/exit code (including non-zero exits).
pub async fn collect(
    target: &ExecTarget,
    cmd: &str,
    args: &[&str],
) -> Result<ExecOutput, ExecError> {
    collect_output(target, cmd, args).await
}

/// Whether `cmd` exists in the target environment's user tool PATH.
///
/// * Local: host process PATH (after [`exec_env::init_host_user_path`]).
/// * WSL/SSH: `command -v` via the executor (login-shell wrapped).
pub async fn command_exists(target: &ExecTarget, cmd: &str) -> bool {
    match target {
        ExecTarget::Local => exec_env::local_command_exists(cmd),
        ExecTarget::Wsl { .. } | ExecTarget::Remote { .. } => {
            // Login-shell wrapping is applied by the executor; a simple
            // `command -v` is enough (do not nest another `bash -c` unnecessarily).
            match run(target, "sh", &["-c", &format!("command -v {}", shell_quote(cmd))]).await {
                Ok(out) => !out.trim().is_empty(),
                Err(_) => false,
            }
        }
    }
}

/// Whether `cmd` exists in the project's environment (Local / WSL / SSH).
pub async fn command_exists_on_project(env: &ProjectEnvironment, cmd: &str) -> bool {
    let target = env.to_exec_target();
    command_exists(&target, cmd).await
}

/// Blocking wrapper for sync call sites (e.g. LSP session setup on a
/// `spawn_blocking` worker). Prefer [`command_exists`] / [`command_exists_on_project`]
/// in async code.
///
/// Safe to call from `spawn_blocking` (no current Tokio handle required).
pub fn command_exists_blocking(target: &ExecTarget, cmd: &str) -> bool {
    match target {
        ExecTarget::Local => exec_env::local_command_exists(cmd),
        ExecTarget::Wsl { .. } | ExecTarget::Remote { .. } => {
            match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt.block_on(command_exists(target, cmd)),
                Err(e) => {
                    log::warn!("[exec] failed to build temp runtime for command_exists: {e}");
                    false
                }
            }
        }
    }
}

fn shell_quote(s: &str) -> String {
    crate::common::utils::command::local::quote_shell_arg(s)
}
