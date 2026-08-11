//! Cross-environment command execution facade.
//!
//! Business code should prefer this module over legacy
//! `crate::common::utils::command` helpers or constructing
//! environment-specific shells by hand. All runs go through
//! [`crate::common::executor`].
//!
//! **Existence checks and runs must use the project environment**
//! ([`ProjectEnvironment`] / [`ExecTarget`]), not the host alone — agents and
//! tools for WSL/SSH projects live in those environments.

use crate::common::executor::factory::{create_executor, ExecTarget};
use crate::common::executor::sync::{collect_child_output, collect_output, exec_on};
use crate::common::executor::{ExecChild, ExecError, ExecOutput, SpawnOptions};
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
    create_executor(target)
        .spawn_with(SpawnOptions::new(cmd, args).with_current_dir_if(current_dir))
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

/// Like [`collect`], with an optional working directory in the target environment.
pub async fn collect_in_dir(
    target: &ExecTarget,
    cmd: &str,
    args: &[&str],
    current_dir: Option<&str>,
) -> Result<ExecOutput, ExecError> {
    use crate::common::executor::sync::collect_child_output;
    let child = spawn_with(target, cmd, args, current_dir).await?;
    collect_child_output(child).await
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
            match run(
                target,
                "sh",
                &["-c", &format!("command -v {}", shell_quote(cmd))],
            )
            .await
            {
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
/// Safe to call from `spawn_blocking` or dedicated OS threads (no current
/// Tokio handle required). Must NOT be called from an async driver thread —
/// use the async [`command_exists`] there.
#[must_use]
pub fn command_exists_blocking(target: &ExecTarget, cmd: &str) -> bool {
    match target {
        ExecTarget::Local => exec_env::local_command_exists(cmd),
        ExecTarget::Wsl { .. } | ExecTarget::Remote { .. } => {
            block_on_temp(command_exists(target, cmd)).unwrap_or(false)
        }
    }
}

/// Run a command with full [`SpawnOptions`] and collect raw output.
async fn collect_with_opts(
    target: &ExecTarget,
    opts: SpawnOptions<'_>,
) -> Result<ExecOutput, ExecError> {
    let child = create_executor(target).spawn_with(opts).await?;
    collect_child_output(child).await
}

/// Build a temporary current-thread runtime and run `future` to completion.
///
/// Used by the blocking facade for sync call sites (git worker threads, git2
/// helpers, sync Tauri commands). Prefers an existing runtime handle when the
/// calling thread already has one (e.g. tokio blocking pool), and only falls
/// back to a brand-new current-thread runtime when no context exists.
///
/// Must NOT be called from an async driver thread (async task body /
/// `#[tokio::test]` body) — callers there should use the async variants
/// (`run` / `collect`) directly.
///
/// `#[track_caller]` + caller logging：一旦被误在 async driver 线程调用而触发
/// Tokio 的 block-on panic，panic 位置与日志均指向实际调用点，便于排查。
#[track_caller]
fn block_on_temp<T>(future: impl std::future::Future<Output = T>) -> Result<T, ExecError> {
    let caller = std::panic::Location::caller();
    match tokio::runtime::Handle::try_current() {
        Ok(handle) => {
            log::debug!(
                "[exec] block_on_temp inside existing runtime, called from {caller}; \
                 context must be a blocking pool / OS thread, not an async driver thread"
            );
            Ok(handle.block_on(future))
        }
        Err(_) => match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(rt) => Ok(rt.block_on(future)),
            Err(e) => {
                log::warn!("[exec] failed to build temp runtime for blocking exec: {e}");
                Err(ExecError::InvalidConfig(format!(
                    "failed to build temporary runtime: {e}"
                )))
            }
        },
    }
}

/// Blocking [`collect`] for sync call sites.
///
/// Returns raw stdout/stderr/exit code even for non-zero exits. Safe outside
/// any Tokio context (dedicated worker threads, sync Tauri commands).
pub fn collect_blocking(
    target: &ExecTarget,
    cmd: &str,
    args: &[&str],
) -> Result<ExecOutput, ExecError> {
    let opts = SpawnOptions::new(cmd, args);
    block_on_temp(collect_with_opts(target, opts))?
}

/// Blocking [`collect`] with full [`SpawnOptions`] (working directory + env).
pub fn collect_blocking_with(
    target: &ExecTarget,
    opts: SpawnOptions<'_>,
) -> Result<ExecOutput, ExecError> {
    block_on_temp(collect_with_opts(target, opts))?
}

/// Blocking [`run`] for sync call sites: UTF-8 stdout on success, error otherwise.
pub fn run_blocking(target: &ExecTarget, cmd: &str, args: &[&str]) -> Result<String, ExecError> {
    let output = collect_blocking(target, cmd, args)?;
    if output.exit_code == 0 {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        Err(ExecError::CommandFailed {
            code: output.exit_code,
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }
}

/// Blocking, fire-and-forget launch of a GUI / long-lived process (IDE,
/// default browser, `wsl.exe`, …). The child keeps running after this returns;
/// stdio is nulled and the process is detached (Unix process group / Windows
/// `DETACHED_PROCESS`).
pub fn spawn_detached(target: &ExecTarget, cmd: &str, args: &[&str]) -> Result<(), ExecError> {
    let opts = SpawnOptions::new(cmd, args);
    block_on_temp(async move {
        let executor = create_executor(target);
        executor.spawn_detached(opts.cmd, opts.args).await
    })?
}

fn shell_quote(s: &str) -> String {
    crate::common::utils::command::local::quote_shell_arg(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 同步桥必须在无 Tokio 上下文的线程上调用（普通 `#[test]` 线程即满足）。
    #[test]
    fn collect_blocking_captures_stdout_and_zero_exit() {
        let output = collect_blocking(&ExecTarget::Local, "sh", &["-c", "printf hello"]).unwrap();
        assert_eq!(output.exit_code, 0);
        assert_eq!(String::from_utf8_lossy(&output.stdout), "hello");
        assert!(output.stderr.is_empty());
    }

    #[test]
    fn collect_blocking_preserves_nonzero_exit_and_stderr() {
        let output =
            collect_blocking(&ExecTarget::Local, "sh", &["-c", "echo boom >&2; exit 3"]).unwrap();
        assert_eq!(output.exit_code, 3);
        assert!(String::from_utf8_lossy(&output.stderr).contains("boom"));
    }

    #[test]
    fn collect_blocking_with_sets_current_dir_and_env() {
        // Windows 上 Git Bash 的 pwd 输出 MSYS 路径(/c/Users/...),与 Windows
        // 路径(C:\Users\...)格式不同,不能直接 contains 全路径;改用唯一目录名
        // 验证 current_dir 已生效。
        let dir = tempfile::tempdir().expect("create temp dir");
        let dir_name = dir.path().file_name().unwrap().to_string_lossy();
        let output = collect_blocking_with(
            &ExecTarget::Local,
            SpawnOptions::new("sh", &["-c", "pwd; [ \"$NEEKO_TEST_ENV\" = \"42\" ]"])
                .with_current_dir(dir.path().to_str().unwrap())
                .with_env(&[("NEEKO_TEST_ENV", "42")]),
        )
        .unwrap();
        assert_eq!(output.exit_code, 0);
        assert!(
            String::from_utf8_lossy(&output.stdout).contains(dir_name.as_ref()),
            "stdout should mention the working dir: {}",
            String::from_utf8_lossy(&output.stdout)
        );
    }

    #[test]
    fn run_blocking_returns_stdout_on_success_and_error_on_failure() {
        let ok = run_blocking(&ExecTarget::Local, "sh", &["-c", "printf ok"]).unwrap();
        assert_eq!(ok, "ok");

        let err = run_blocking(&ExecTarget::Local, "sh", &["-c", "exit 5"]).unwrap_err();
        assert!(matches!(err, ExecError::CommandFailed { code: 5, .. }));
    }

    #[test]
    fn spawn_detached_launches_local_process_without_error() {
        // 成功启动：fire-and-forget，立即返回 Ok。
        spawn_detached(&ExecTarget::Local, "sh", &["-c", "true"]).expect("spawn sh");
    }

    #[test]
    fn spawn_detached_reports_spawn_failure() {
        // 不存在的命令：应返回 Io 错误而非 panic。
        let err = spawn_detached(
            &ExecTarget::Local,
            "definitely-not-a-real-command-987654",
            &[],
        )
        .unwrap_err();
        assert!(matches!(err, ExecError::Io(_)));
    }

    #[test]
    fn command_exists_blocking_local() {
        assert!(command_exists_blocking(&ExecTarget::Local, "sh"));
        assert!(!command_exists_blocking(
            &ExecTarget::Local,
            "definitely-not-a-real-command-987654"
        ));
    }
}
