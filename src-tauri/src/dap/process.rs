//! Spawn debug adapter processes via [`crate::core::exec`] only.
//!
//! DAP never calls `common::executor` or host-local shortcuts directly.

use super::transport::{self, DapIo};
use super::types::AdapterSpawn;
use crate::common::executor::factory::ExecTarget;
use crate::common::executor::ProcessGuard;
use crate::core::exec;
use crate::AppError;

/// Running adapter: DAP I/O plus its process lifecycle guard.
pub struct AdapterProcess {
    /// DAP read/write I/O channels.
    pub io: DapIo,
    /// 适配器进程清理守卫（异步 `terminate` + RAII 兜底，不阻塞 runtime worker）。
    pub guard: ProcessGuard,
}

/// Spawn the adapter in the project environment and open DAP transport.
pub async fn spawn_adapter(
    target: &ExecTarget,
    project_path: &str,
    spawn: &AdapterSpawn,
) -> Result<AdapterProcess, AppError> {
    let args_refs: Vec<&str> = spawn.args.iter().map(|s| s.as_str()).collect();
    let mut child = exec::spawn_with(target, &spawn.program, &args_refs, Some(project_path))
        .await
        .map_err(|e| AppError::Dap(format!("Failed to spawn {}: {e}", spawn.program)))?;

    let (async_stdin, async_stdout, async_stderr) = child.take_stdio();
    let async_stdin = async_stdin.ok_or_else(|| AppError::Dap("adapter has no stdin".into()))?;
    let async_stdout = async_stdout.ok_or_else(|| AppError::Dap("adapter has no stdout".into()))?;
    let async_stderr = async_stderr.ok_or_else(|| AppError::Dap("adapter has no stderr".into()))?;
    // 适配器进程生命周期统一交给 ProcessGuard：terminate 是异步的（旧实现在
    // async 上下文用 recv_timeout 阻塞最长 2s），transport 错误路径共享同一
    // kill 信号，`Drop` 兜底（connect_transport 失败提前返回也不泄漏进程）。
    let (wait_fut, kill_fn) = child.into_wait_and_kill();
    let guard = ProcessGuard::new(wait_fut, kill_fn);
    let io = transport::connect_transport(
        spawn,
        async_stdout,
        async_stderr,
        async_stdin,
        guard.kill_handle(),
    )
    .await?;

    Ok(AdapterProcess { io, guard })
}

/// Run optional preLaunchTask in the project environment (login shell).
pub async fn run_pre_launch_task(target: &ExecTarget, task: &str) -> Result<(), AppError> {
    let task = task.trim();
    if task.is_empty() {
        return Ok(());
    }
    log::info!("[DAP] preLaunchTask: {task}");
    let output = exec::collect(target, "bash", &["-lc", task], None)
        .await
        .map_err(|e| AppError::Dap(format!("preLaunchTask failed to start: {e}")))?;
    if output.exit_code != 0 {
        let err = String::from_utf8_lossy(&output.stderr);
        let out = String::from_utf8_lossy(&output.stdout);
        let detail = if !err.trim().is_empty() {
            err.trim().to_string()
        } else {
            out.trim().to_string()
        };
        return Err(AppError::Dap(format!(
            "preLaunchTask exited {}: {detail}",
            output.exit_code
        )));
    }
    Ok(())
}
