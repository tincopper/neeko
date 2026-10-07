//! WSL command executor.
//!
//! Bridges command execution into a Windows Subsystem for Linux distribution
//! by spawning `wsl.exe`. User tool PATH is obtained by running commands via a
//! login shell (`bash -lc`) inside the distro so profile-managed tools (nvm,
//! fnm, cargo, …) match an interactive WSL terminal.

#[cfg(target_os = "windows")]
use std::sync::Arc;
#[cfg(target_os = "windows")]
use std::time::Duration;

use async_trait::async_trait;
#[cfg(target_os = "windows")]
use futures::FutureExt;
#[cfg(target_os = "windows")]
use tokio::sync::Mutex;

#[cfg(target_os = "windows")]
use super::{BoxAsyncRead, BoxAsyncWrite};
use super::{CommandExecutor, ExecChild, ExecError, ScriptOptions, SpawnOptions};

/// wait 轮询 `try_wait` 的间隔：**不得**跨 `await` 持有 `Mutex<Child>` —— 退出收敛会在本 wait
/// future 仍存活时直接驱动共享 kill 动作，持锁等待会死锁。短锁轮询使 kill 总能拿到锁。
#[cfg(target_os = "windows")]
const WAIT_POLL_INTERVAL: Duration = Duration::from_millis(20);

/// Executor that runs commands inside a WSL distribution.
///
/// On Windows spawns `wsl.exe` with Windows `PATH` stripped so host PATH does
/// not leak into Linux, then runs `bash -lc '…'` for the user command.
#[cfg(not(target_os = "windows"))]
pub struct WslExecutor;

#[cfg(not(target_os = "windows"))]
impl WslExecutor {
    /// Create a new `WslExecutor` (stub — returns an error on non-Windows platforms).
    pub fn new(_distro: String) -> Self {
        Self
    }
}

#[cfg(target_os = "windows")]
pub struct WslExecutor {
    /// WSL distribution name (e.g. "Ubuntu-22.04"). `None` uses the default distro.
    distro: Option<String>,
}

#[cfg(target_os = "windows")]
impl WslExecutor {
    /// Create a new `WslExecutor` for the given distribution.
    pub const fn new(distro: String) -> Self {
        Self {
            distro: Some(distro),
        }
    }

    /// Spawn `wsl.exe -- bash -lc <script>` and wrap the child handle.
    ///
    /// argv / script 两种形态的唯一差异是 `script` 的内容（前缀渲染见
    /// [`super::login_script`]），spawn / 采集 / kill 生命周期完全同构 —— 收敛到
    /// 这里，避免两份复制。
    async fn spawn_login_script(
        &self,
        script: String,
        kill_tree: bool,
    ) -> Result<ExecChild, ExecError> {
        let mut wsl_args: Vec<String> = Vec::new();
        if let Some(ref d) = self.distro {
            wsl_args.push("-d".into());
            wsl_args.push(d.clone());
        }
        wsl_args.push("--".into());
        wsl_args.push("bash".into());
        wsl_args.push("-lc".into());
        wsl_args.push(script);

        let mut command = tokio::process::Command::new("wsl.exe");
        command
            .args(&wsl_args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        // Prevent Windows PATH entries from leaking into the WSL environment.
        command.env_remove("PATH");

        let mut child = command.spawn().map_err(ExecError::Io)?;
        // Host-side wsl.exe pid — may not match the Linux process, but is best-effort.
        let pid = child.id();

        let stdin: Option<BoxAsyncWrite> = child.stdin.take().map(|w| Box::pin(w) as BoxAsyncWrite);
        let stdout: Option<BoxAsyncRead> = child.stdout.take().map(|r| Box::pin(r) as BoxAsyncRead);
        let stderr: Option<BoxAsyncRead> = child.stderr.take().map(|r| Box::pin(r) as BoxAsyncRead);

        let child_lock = Arc::new(Mutex::new(child));
        let wait_child = Arc::clone(&child_lock);
        let wait = async move {
            loop {
                let status = {
                    let mut guard = wait_child.lock().await;
                    guard.try_wait().map_err(ExecError::Io)?
                };
                if let Some(status) = status {
                    return status.code().ok_or(ExecError::Killed);
                }
                tokio::time::sleep(WAIT_POLL_INTERVAL).await;
            }
        };
        let kill_child = Arc::clone(&child_lock);
        let kill_pid = pid;
        let kill = move || {
            let kill_child = Arc::clone(&kill_child);
            async move {
                let mut guard = kill_child.lock().await;
                // 宿主侧(`wsl.exe`)按进程树杀,覆盖其 Windows 侧子进程;
                // Linux 侧后代无跨内核 pgid 可寻,由 WSL 会话回收(尽力而为)。
                if kill_tree && guard.try_wait().map_err(ExecError::Io)?.is_none() {
                    if let Some(pid) = kill_pid {
                        crate::platform::process_spawn::kill_process_tree(pid);
                    }
                }
                guard.kill().await?;
                Ok(())
            }
            .boxed()
        };

        Ok(ExecChild::new_with_pid(
            stdin, stdout, stderr, wait, kill, pid,
        ))
    }
}

#[cfg(target_os = "windows")]
#[async_trait]
impl CommandExecutor for WslExecutor {
    async fn spawn_with(&self, opts: SpawnOptions<'_>) -> Result<ExecChild, ExecError> {
        let script = super::login_script::render_argv_script(
            opts.env,
            opts.current_dir,
            opts.cmd,
            opts.args,
        );
        self.spawn_login_script(script, opts.kill_tree).await
    }

    async fn spawn_script(&self, opts: ScriptOptions<'_>) -> Result<ExecChild, ExecError> {
        let script = super::login_script::render_script(opts.env, opts.current_dir, opts.script);
        self.spawn_login_script(script, opts.kill_tree).await
    }
}

#[cfg(not(target_os = "windows"))]
#[async_trait]
impl CommandExecutor for WslExecutor {
    async fn spawn_with(&self, _opts: SpawnOptions<'_>) -> Result<ExecChild, ExecError> {
        Err(ExecError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }

    async fn spawn_script(&self, _opts: ScriptOptions<'_>) -> Result<ExecChild, ExecError> {
        Err(ExecError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}
