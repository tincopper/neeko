//! Cross-environment command execution facade.
//!
//! Business code should prefer this module over legacy
//! `crate::common::utils::command` helpers or constructing
//! environment-specific shells by hand. All runs go through
//! [`crate::common::executor`].
//!
//! **Existence checks and runs must use the project environment**
//! ([`crate::core::project::ProjectEnvironment`] / [`ExecTarget`]), not the host alone — agents and
//! tools for WSL/SSH projects live in those environments.

use crate::common::executor::factory::{create_executor, ExecTarget};
use crate::common::executor::{
    collect_child_output, ExecChild, ExecError, ExecOutput, SpawnOptions,
};
use crate::core::exec_env;

/// Run a command on `target` and return UTF-8 stdout on success.
pub async fn run(target: &ExecTarget, cmd: &str, args: &[&str]) -> Result<String, ExecError> {
    let output = collect(target, cmd, args, None).await?;
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

/// Spawn a long-lived process (stdio pipes) on `target`.
///
/// 声明 `kill_tree`：facade 的 spawn 面向**受管长驻进程**（LSP 服务器 / DAP
/// adapter / 调试目标），其形态多为包装器脚本 + 服务进程，`kill()` 必须能连带
/// 清理后代，否则孤儿持锁。短命令走 `collect*`，不带该语义。
pub async fn spawn(target: &ExecTarget, cmd: &str, args: &[&str]) -> Result<ExecChild, ExecError> {
    create_executor(target)
        .spawn_with(SpawnOptions::new(cmd, args).with_kill_tree())
        .await
}

/// Spawn with optional working directory in the target environment.
pub async fn spawn_with(
    target: &ExecTarget,
    cmd: &str,
    args: &[&str],
    current_dir: Option<&str>,
) -> Result<ExecChild, ExecError> {
    create_executor(target)
        .spawn_with(
            SpawnOptions::new(cmd, args)
                .with_current_dir_if(current_dir)
                .with_kill_tree(),
        )
        .await
}

/// Collect raw stdout/stderr/exit code (including non-zero exits).
///
/// `current_dir` 与 [`spawn_with`] 同义：`None` 用执行环境默认目录，`Some(dir)`
/// 在该目录下运行。短命令**不**改进程组（不带 `kill_tree`）——只有长驻受管进程
/// 才走 [`spawn`] / [`spawn_with`] 建立自组、支持树杀。
pub async fn collect(
    target: &ExecTarget,
    cmd: &str,
    args: &[&str],
    current_dir: Option<&str>,
) -> Result<ExecOutput, ExecError> {
    collect_core(
        target,
        SpawnOptions::new(cmd, args).with_current_dir_if(current_dir),
    )
    .await
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

/// Blocking wrapper for sync call sites (e.g. LSP session setup on a
/// `spawn_blocking` worker). Prefer the async [`command_exists`] in async code.
///
/// Safe to call from `spawn_blocking` or dedicated OS threads (no current
/// Tokio handle required). Must NOT be called from an async driver thread —
/// use the async [`command_exists`] there.
#[must_use]
#[track_caller]
pub fn command_exists_blocking(target: &ExecTarget, cmd: &str) -> bool {
    match target {
        ExecTarget::Local => exec_env::local_command_exists(cmd),
        ExecTarget::Wsl { .. } | ExecTarget::Remote { .. } => {
            block_on_sync("command_exists_blocking", command_exists(target, cmd)).unwrap_or(false)
        }
    }
}

/// 采集系列的**单一实现核心**：spawn + 并发抽干双流。
///
/// [`collect`] / [`collect_blocking`] / [`collect_blocking_with`] 全部汇入此处，
/// 彼此只在「是否同步桥」「是否带 cwd/env」上有别。
async fn collect_core(
    target: &ExecTarget,
    opts: SpawnOptions<'_>,
) -> Result<ExecOutput, ExecError> {
    let child = create_executor(target).spawn_with(opts).await?;
    collect_child_output(child).await
}

/// 同步桥：把 async `future` 驱动到完成，**任何上下文都不 panic**。
///
/// 由 [`collect_blocking`] / [`collect_blocking_with`] /
/// [`command_exists_blocking`] / [`spawn_detached`] 共用 —— 这些同步入口服务于
/// 真同步调用方（独立 OS 线程、`spawn_blocking` 闭包、同步 `#[tauri::command]`）。
///
/// 两条路径，**都自建临时 current_thread runtime**（绝不借用调用方 runtime）：
///
/// * 无 runtime 上下文（OS 线程 / 同步命令）：本线程直接跑，零额外线程。
/// * 已在 runtime 内（`spawn_blocking` / async driver 线程）：本线程禁止 `block_on`
///   （tokio 会拒绝），改在**独立 OS 线程**上跑；`thread::scope` 保留非 `'static`
///   借用。该场景是性能反模式，故 `log::warn!` 记录调用点，而不是 panic。
///
/// `#[track_caller]` + `op`：warn 同时给出**具体桥函数**与**实际调用点**。
#[track_caller]
fn block_on_sync<T: Send>(
    op: &str,
    future: impl std::future::Future<Output = T> + Send,
) -> Result<T, ExecError> {
    let caller = std::panic::Location::caller();
    match tokio::runtime::Handle::try_current() {
        Err(_) => Ok(build_temp_runtime(op)?.block_on(future)),
        Ok(_) => {
            log::warn!(
                "[exec] {op} called from within a runtime context ({caller}); \
                 running it on a dedicated OS thread instead. Use the async variants \
                 (run / collect / command_exists) from async code."
            );
            block_on_own_thread(op, future)
        }
    }
}

/// 建临时 current_thread runtime（`enable_all` 以满足 process / IO driver）。
fn build_temp_runtime(op: &str) -> Result<tokio::runtime::Runtime, ExecError> {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| {
            log::warn!("[exec] failed to build temp runtime for {op}: {e}");
            ExecError::InvalidConfig(format!("failed to build temporary runtime: {e}"))
        })
}

/// 在独立 OS 线程上用自有 runtime 跑 `future`（`thread::scope` 允许借用非 `'static`）。
fn block_on_own_thread<T: Send>(
    op: &str,
    future: impl std::future::Future<Output = T> + Send,
) -> Result<T, ExecError> {
    std::thread::scope(|scope| {
        let handle = scope.spawn(move || -> Result<T, ExecError> {
            Ok(build_temp_runtime(op)?.block_on(future))
        });
        match handle.join() {
            Ok(result) => result,
            // future 自身的 panic 原样透传（不吞真实 bug）。
            Err(payload) => std::panic::resume_unwind(payload),
        }
    })
}

/// Blocking [`collect`] for sync call sites (no cwd/env).
///
/// [`collect_blocking_with`] 的便捷形式——同一实现的两种入口。返回原始
/// stdout/stderr/exit code（含非零退出）。
///
/// 任何线程都可调用（见 [`block_on_sync`]，不会 panic）；但推荐在独立 worker
/// 线程 / 同步 Tauri 命令中调用 —— 在 async driver 线程调用会额外起一个 OS
/// 线程（性能反模式），async 路径请直接用 [`collect`]。
#[track_caller]
pub fn collect_blocking(
    target: &ExecTarget,
    cmd: &str,
    args: &[&str],
) -> Result<ExecOutput, ExecError> {
    collect_blocking_with(target, SpawnOptions::new(cmd, args))
}

/// Blocking [`collect`] with full [`SpawnOptions`] (working directory + env).
///
/// 需要注入 `env`（如 `git` 的代理变量）或组合 cwd + env 时用此入口。
#[track_caller]
pub fn collect_blocking_with(
    target: &ExecTarget,
    opts: SpawnOptions<'_>,
) -> Result<ExecOutput, ExecError> {
    block_on_sync("collect_blocking_with", collect_core(target, opts))?
}

/// Blocking, fire-and-forget launch of a GUI / long-lived process (IDE,
/// default browser, `wsl.exe`, …). The child keeps running after this returns;
/// stdio is nulled and the process is detached (Unix process group / Windows
/// `DETACHED_PROCESS`).
#[track_caller]
pub fn spawn_detached(target: &ExecTarget, cmd: &str, args: &[&str]) -> Result<(), ExecError> {
    let opts = SpawnOptions::new(cmd, args);
    block_on_sync("spawn_detached", async move {
        let executor = create_executor(target);
        executor.spawn_detached(opts.cmd, opts.args).await
    })?
}

fn shell_quote(s: &str) -> String {
    crate::common::utils::command::local::quote_shell_arg(s)
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    /// 典型同步调用点：无 Tokio 上下文的线程（普通 `#[test]` 线程即满足）。
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

    /// async 变体必须在 Tokio 运行时内正常完成（与同步桥相反，后者禁止在
    /// driver 线程调用）。
    #[tokio::test]
    async fn collect_runs_inside_tokio_runtime() {
        let output = collect(&ExecTarget::Local, "sh", &["-c", "printf runtime-ok"], None)
            .await
            .unwrap();

        assert_eq!(output.stdout, b"runtime-ok");
        assert_eq!(output.exit_code, 0);
    }

    /// `collect` 是**短命令**入口，不得把子进程挪进新进程组
    /// （`process_group(0)` 只在 `kill_tree` 长驻受管进程路径成立）。
    ///
    /// 回归守卫：`collect_in_dir` 曾经误走 `spawn_with`（强制 `kill_tree`），
    /// 使 git 等短命令脱离终端进程组、收不到终端信号。
    #[cfg(unix)]
    #[tokio::test]
    async fn collect_keeps_child_in_parent_process_group() {
        let output = collect(&ExecTarget::Local, "sh", &["-c", "ps -o pgid= -p $$"], None)
            .await
            .unwrap();

        let child_pgid: i32 = String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse()
            .expect("ps should print the pgid");
        // SAFETY: getpgrp 无参数、无副作用，恒返回调用进程的进程组 id。
        let parent_pgid = unsafe { libc::getpgrp() };
        assert_eq!(
            child_pgid, parent_pgid,
            "collect 不得改变子进程组（收到 {child_pgid}，期望 {parent_pgid}）"
        );
    }

    /// stdin 必须立刻关闭：等待 EOF 的命令（`cat`）不得让采集永远挂起。
    #[tokio::test]
    async fn collect_closes_stdin_for_eof_waiting_command() {
        let output = tokio::time::timeout(
            Duration::from_secs(3),
            collect(
                &ExecTarget::Local,
                "sh",
                &["-c", "cat >/dev/null; printf eof"],
                None,
            ),
        )
        .await
        .expect("collection should not wait indefinitely for stdin EOF")
        .unwrap();

        assert_eq!(output.stdout, b"eof");
    }

    /// 大量 stdout/stderr 必须并发抽干，否则管道缓冲写满即死锁。
    #[tokio::test]
    async fn collect_drains_large_stdout_and_stderr_concurrently() {
        let output = tokio::time::timeout(
            Duration::from_secs(5),
            collect(
                &ExecTarget::Local,
                "sh",
                &[
                    "-c",
                    "yes o | head -c 1048576 & yes e | head -c 1048576 >&2 & wait",
                ],
                None,
            ),
        )
        .await
        .expect("collection should not deadlock on full stdio pipes")
        .unwrap();

        assert_eq!(output.stdout.len(), 1_048_576);
        assert_eq!(output.stderr.len(), 1_048_576);
    }

    /// `run` 非零退出必须返回结构化 `CommandFailed`（保留原始字节），
    /// 且 Display 走 UTF-8 stderr 文本而非字节数组。
    #[tokio::test]
    async fn run_returns_structured_command_failure() {
        let error = run(
            &ExecTarget::Local,
            "sh",
            &["-c", "printf out; printf err >&2; exit 9"],
        )
        .await
        .unwrap_err();

        match &error {
            ExecError::CommandFailed {
                code,
                stdout,
                stderr,
            } => {
                assert_eq!(*code, 9);
                assert_eq!(stdout, b"out");
                assert_eq!(stderr, b"err");
            }
            other => panic!("expected CommandFailed, got {other:?}"),
        }
        let display = error.to_string();
        assert!(
            display.contains("Command failed with code 9: err"),
            "display should use UTF-8 stderr text, got: {display}"
        );
        assert!(
            !display.contains("stderr=["),
            "display must not dump raw byte arrays, got: {display}"
        );
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

    #[test]
    fn command_exists_hermetic_via_explicit_path() {
        use crate::common::utils::command::local::command_exists_on_path;
        let dir = tempfile::tempdir().expect("tempdir");
        let bin_name = if cfg!(target_os = "windows") {
            "hermetic_exec_bin.exe"
        } else {
            "hermetic_exec_bin"
        };
        let bin_path = dir.path().join(bin_name);
        std::fs::write(&bin_path, b"#!/bin/sh\necho hi").expect("write");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perm = std::fs::metadata(&bin_path)
                .expect("metadata")
                .permissions();
            perm.set_mode(0o755);
            std::fs::set_permissions(&bin_path, perm).expect("chmod");
        }
        let path = dir.path().to_string_lossy().to_string();
        // 显式 PATH 隔离：与全局 PATH / 是否装 sh/opencode 无关
        assert!(command_exists_on_path(bin_name, &path));
        assert!(!command_exists_on_path(bin_name, ""));
        assert!(!command_exists_on_path(
            "definitely-not-a-real-command-987654",
            &path
        ));
    }

    // ── 同步桥（永不 panic）───────────────────────────────────────────────

    /// 无 runtime 上下文（普通测试线程）→ 临时 runtime，正常工作。
    #[test]
    fn block_on_sync_works_on_plain_os_thread() {
        assert_eq!(block_on_sync("test_plain", async { 7 }).expect("ok"), 7);
    }

    /// `spawn_blocking` 是同步桥的**合法**调用点 → 必须正常工作。
    #[test]
    fn block_on_sync_works_in_spawn_blocking_context() {
        let join = crate::common::runtime::AppRuntime::from_tauri()
            .spawn_blocking(|| block_on_sync("test_blocking", async { 11 }));
        let value = tauri::async_runtime::block_on(join).expect("join");
        assert_eq!(value.expect("ok"), 11);
    }

    /// **核心保证**：多线程 runtime 的 async 任务体内调用 —— 不再 panic，
    /// 自动改到独立线程执行并返回原值。
    #[test]
    fn block_on_sync_does_not_panic_inside_async_task() {
        let join = crate::common::runtime::AppRuntime::from_tauri()
            .spawn(async { block_on_sync("test_in_async", async { 13 }).expect("must not panic") });
        let value = tauri::async_runtime::block_on(join).expect("join");
        assert_eq!(value, 13);
    }

    /// **核心保证**：current_thread runtime（`#[tokio::test]` 默认）内同样不 panic。
    #[tokio::test]
    async fn block_on_sync_works_inside_current_thread_runtime() {
        assert_eq!(
            block_on_sync("test_current_thread", async { 17 }).unwrap(),
            17
        );
    }

    /// 端到端：真实同步桥在 async 任务体内也能跑通
    /// （不再因 tokio 拒绝阻塞当前线程而 panic）。
    #[test]
    fn collect_blocking_does_not_panic_inside_async_task() {
        let join = crate::common::runtime::AppRuntime::from_tauri().spawn(async {
            let out = collect_blocking(&ExecTarget::Local, "sh", &["-c", "printf bridged"])
                .expect("must not panic");
            String::from_utf8_lossy(&out.stdout).into_owned()
        });
        let value = tauri::async_runtime::block_on(join).expect("join");
        assert_eq!(value, "bridged");
    }
}
