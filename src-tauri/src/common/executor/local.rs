//! Local command executor.
//!
//! Spawns processes on the local machine using `tokio::process::Command`
//! with host PATH resolution (process PATH after `core::exec_env` init,
//! plus common package-manager extras via `resolve_full_path`).

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use futures::FutureExt;
use tokio::process::Command;
use tokio::sync::Mutex;

use super::{BoxAsyncRead, BoxAsyncWrite, CommandExecutor, ExecChild, ExecError, SpawnOptions};

/// wait 轮询 `try_wait` 的间隔：**不得**跨 `await` 持有 `Mutex<Child>` —— 退出收敛会在本 wait
/// future 仍存活时直接驱动共享 kill 动作，持锁等待会死锁。短锁轮询使 kill 总能拿到锁。
const WAIT_POLL_INTERVAL: Duration = Duration::from_millis(20);

/// Executor that runs commands on the local machine.
///
/// Binary resolution uses [`crate::common::utils::command::local::resolve_command_path`]
/// with [`crate::common::utils::command::local::resolve_full_path`]. The resolved
/// PATH is also injected into the child env so shebang scripts (`#!/usr/bin/env node`)
/// keep working.
pub struct LocalExecutor;

#[async_trait]
impl CommandExecutor for LocalExecutor {
    async fn spawn_with(&self, opts: SpawnOptions<'_>) -> Result<ExecChild, ExecError> {
        let path = crate::common::utils::command::local::resolve_full_path();
        let resolved = crate::common::utils::command::local::resolve_command_path(opts.cmd, &path);

        let mut command = Command::new(&resolved);
        command
            .args(opts.args)
            .env("PATH", &path)
            .envs(opts.env.iter().copied())
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        // 平台差异(Windows CREATE_NO_WINDOW)集中化于 crate::platform::process_spawn。
        crate::platform::process_spawn::apply_child_flags(&mut command, opts.kill_tree);
        if let Some(dir) = opts.current_dir {
            command.current_dir(dir);
        }

        let mut child = command.spawn().map_err(ExecError::Io)?;
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
        let kill_tree = opts.kill_tree;
        let kill = move || {
            let kill_child = Arc::clone(&kill_child);
            async move {
                let mut guard = kill_child.lock().await;
                // 仅当调用方声明 kill_tree(该 spawn 已自成进程组)才组杀:
                // 子进程仍存活时其 pid 不会被复用,按组杀覆盖包装器脚本
                // (如 jdtls -> python -> JVM)拉起的全部后代;已退出的直接跳过,
                // 避免组号复用误伤。
                if kill_tree && guard.try_wait().map_err(ExecError::Io)?.is_none() {
                    if let Some(kill_pid) = kill_pid {
                        crate::platform::process_spawn::kill_process_tree(kill_pid);
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

    /// Detached GUI / long-lived process launch (IDE, default browser, …).
    ///
    /// Stdio is nulled (no pipes to leak), Unix spawns a new process group so
    /// signals to the parent don't propagate, Windows detaches the process so
    /// it outlives the parent console / lifetime.
    async fn spawn_detached(&self, cmd: &str, args: &[&str]) -> Result<(), ExecError> {
        let path = crate::common::utils::command::local::resolve_full_path();
        let resolved = crate::common::utils::command::local::resolve_command_path(cmd, &path);

        let mut command = Command::new(&resolved);
        command
            .args(args)
            .env("PATH", &path)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        // 平台差异(Windows 分离进程 / Unix 新进程组)集中化于 crate::platform::process_spawn。
        crate::platform::process_spawn::apply_detached_flags(&mut command);

        command.spawn().map_err(ExecError::Io)?;
        Ok(())
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::common::executor::collect_child_output_streaming_cancellable;
    use std::time::{Duration, Instant};

    /// 退出收敛会在 wait future **仍存活**时直接驱动 kill 动作；Local 的 wait 若跨
    /// `await` 持 `Mutex<Child>`，kill 动作会抢不到锁而死锁 —— 回归钉子。
    #[tokio::test]
    async fn kill_action_does_not_deadlock_while_wait_is_polling() {
        let child = LocalExecutor
            .spawn_with(SpawnOptions::new("sh", &["-c", "sleep 30"]).with_kill_tree())
            .await
            .expect("spawn sh");
        let kill = child.kill_action();

        // wait future 在后台轮询（模拟退出收敛时该 future 仍存活）。
        let collect =
            collect_child_output_streaming_cancellable(child, None, std::future::pending::<()>());
        let task = tokio::spawn(async move {
            let _ = collect.await;
        });

        // 给 wait future 足够时间获取锁并进入等待。
        tokio::time::sleep(Duration::from_millis(200)).await;

        let killed = tokio::time::timeout(Duration::from_secs(2), kill()).await;
        assert!(
            killed.is_ok(),
            "kill 动作在 wait 轮询期间必须可执行（不得死锁）"
        );
        let _ = task.await;
    }

    /// `kill()` 必须连带杀死后代进程。回归背景:jdtls 的包装器脚本被杀后,
    /// 它拉起的 JVM 孤儿化,堆积后互抢 Eclipse workspace 锁导致服务器永不
    /// 初始化。**声明 `kill_tree`** 后子进程自成进程组,组杀应覆盖后代。
    #[tokio::test]
    async fn kill_kills_descendant_processes() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let pid_file = tmp.path().join("grandchild_pid");
        // sh 保持存活等待后台 sleep,模拟"包装器 + 服务进程"树。
        let script = format!("sleep 300 & echo $! > {}; wait $!", pid_file.display());
        let child = LocalExecutor
            .spawn_with(SpawnOptions::new("sh", &["-c", &script]).with_kill_tree())
            .await
            .expect("spawn sh");

        let grandchild: u32 = {
            let deadline = Instant::now() + Duration::from_secs(3);
            loop {
                if let Ok(content) = std::fs::read_to_string(&pid_file) {
                    if let Ok(pid) = content.trim().parse() {
                        break pid;
                    }
                }
                assert!(Instant::now() < deadline, "grandchild pid not written");
                std::thread::sleep(Duration::from_millis(50));
            }
        };

        child.kill().await.expect("kill");

        // 后代必须死亡:kill(pid, 0) 返回 ESRCH(孙进程被孤儿化后由 launchd 收割)。
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let alive = unsafe { libc::kill(grandchild as i32, 0) } == 0;
            if !alive {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "grandchild {grandchild} still alive after kill"
            );
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    /// L8：进程组只在**显式声明** `kill_tree` 时建立 —— 普通短命令（git / 探测 /
    /// 克隆）不再被无条件改进程组（那会改变信号传播语义）。
    #[tokio::test]
    #[cfg(unix)]
    async fn process_group_is_opt_in() {
        use tokio::io::AsyncReadExt;

        /// 子进程报告自己的 pgid（`$$` = sh 的 pid）。
        async fn pgid_of(kill_tree: bool) -> i32 {
            let opts = SpawnOptions::new("sh", &["-c", "ps -o pgid= -p $$"]);
            let opts = if kill_tree {
                opts.with_kill_tree()
            } else {
                opts
            };
            let mut child = LocalExecutor.spawn_with(opts).await.expect("spawn sh");
            let mut out = String::new();
            child
                .stdout
                .take()
                .expect("stdout")
                .read_to_string(&mut out)
                .await
                .expect("read pgid");
            let _ = child.wait.await;
            out.trim().parse().expect("pgid int")
        }

        let ours = unsafe { libc::getpgid(0) };
        assert_eq!(
            pgid_of(false).await,
            ours,
            "未声明 kill_tree 时不得改进程组（应沿用父进程组）"
        );
        assert_ne!(
            pgid_of(true).await,
            ours,
            "声明 kill_tree 时必须自成进程组（组号 = 自身 pid）"
        );
    }
}
