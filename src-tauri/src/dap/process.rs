//! Spawn debug adapter processes via [`crate::core::exec`] only.
//!
//! DAP never calls `common::executor` or host-local shortcuts directly.

use std::time::Duration;

use tokio::sync::oneshot;

use super::transport::{self, DapIo};
use super::types::AdapterSpawn;
use crate::common::executor::factory::ExecTarget;
use crate::core::exec;
use crate::AppError;

/// Running adapter: DAP I/O plus a kill callback.
pub struct AdapterProcess {
    pub io: DapIo,
    /// Best-effort terminate adapter process.
    pub kill: Box<dyn FnOnce() + Send>,
}

/// Spawn the adapter in the project environment and open DAP transport.
pub async fn spawn_adapter(
    target: &ExecTarget,
    project_path: &str,
    spawn: &AdapterSpawn,
) -> Result<AdapterProcess, AppError> {
    let args_refs: Vec<&str> = spawn.args.iter().map(|s| s.as_str()).collect();
    let mut child = exec::spawn_with(
        target,
        &spawn.program,
        &args_refs,
        Some(project_path),
    )
    .await
    .map_err(|e| AppError::Dap(format!("Failed to spawn {}: {e}", spawn.program)))?;

    let (async_stdin, async_stdout, async_stderr) = child.take_stdio();
    let async_stdin = async_stdin.ok_or_else(|| AppError::Dap("adapter has no stdin".into()))?;
    let async_stdout =
        async_stdout.ok_or_else(|| AppError::Dap("adapter has no stdout".into()))?;
    let async_stderr =
        async_stderr.ok_or_else(|| AppError::Dap("adapter has no stderr".into()))?;
    let (wait_fut, kill_fn) = child.into_wait_and_kill();

    let (kill_tx, kill_rx) = oneshot::channel::<()>();
    let (done_tx, done_rx) = std::sync::mpsc::channel::<()>();
    tokio::spawn(async move {
        tokio::select! {
            _ = kill_rx => { let _ = kill_fn().await; }
            _ = wait_fut => {}
        }
        let _ = done_tx.send(());
    });

    let (io, kill_tx) =
        transport::connect_transport(spawn, async_stdout, async_stderr, async_stdin, kill_tx)
            .await?;

    let kill = Box::new(move || {
        let _ = kill_tx.send(());
        let _ = done_rx.recv_timeout(Duration::from_secs(2));
    });

    Ok(AdapterProcess { io, kill })
}

/// Run optional preLaunchTask in the project environment (login shell).
pub async fn run_pre_launch_task(target: &ExecTarget, task: &str) -> Result<(), AppError> {
    let task = task.trim();
    if task.is_empty() {
        return Ok(());
    }
    log::info!("[DAP] preLaunchTask: {task}");
    let output = exec::collect(target, "bash", &["-lc", task])
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
