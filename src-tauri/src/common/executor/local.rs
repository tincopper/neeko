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

use super::{
    BoxAsyncRead, BoxAsyncWrite, CommandExecutor, ExecChild, ExecError, ScriptOptions, SpawnOptions,
};

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
            stdin, stdout, stderr, wait, kill, pid, kill_tree,
        ))
    }

    /// Script form: Local decides the shell by platform (`cmd /C` / `sh -c`) and
    /// delegates to [`Self::spawn_with`] — argv, `current_dir`, `env` 都走同一条
    /// 直启路径（原生吃 Windows verbatim 路径，不经 shell 解析）。
    async fn spawn_script(&self, opts: ScriptOptions<'_>) -> Result<ExecChild, ExecError> {
        let (program, argv) = crate::platform::shell_launch::shell_argv(opts.script);
        self.spawn_with(
            SpawnOptions::new(program, &argv)
                .with_current_dir_if(opts.current_dir)
                .with_env(opts.env)
                .with_kill_tree_if(opts.kill_tree),
        )
        .await
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
    use std::time::Duration;

    /// **进程级全局收敛表的串行闸**（照 `scan_cache` / `ENV_LOCK` 的先例）。
    ///
    /// `child_registry` 是整个进程共享的：`kill_all_live()` 会杀掉**任何**已登记的
    /// `kill_tree` 子进程 —— 包括**别的用例**刚 spawn 的那个。本模块四个用例都会
    /// spawn 子进程，其中一个还直接调 `kill_all_live()`，于是「谁先跑」决定了
    /// 别人家的 fixture 是否被提前杀掉（实测：包装器 + 孙进程那条用例因此拿到
    /// 空 stdout / 假绿，表现成「偶发红」）。
    ///
    /// 修法不是加 sleep，而是把「复位 + 独占」做成一次调用：拿闸就丢在
    /// `-D warnings` 下编译失败（`#[must_use]`），用例之间不再互相杀。
    /// 用 `tokio::sync::Mutex` 而不是 `std::sync::Mutex`：async 用例本就要跨 `await`
    /// 持有（`clippy::await_holding_lock` 会拒绝 std 守卫跨 await，且那本来是错的用法）。
    static CHILD_REGISTRY_GUARD: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    #[must_use = "持闸到用例结束：跨用例杀子进程会让别人的 fixture 变成死进程"]
    async fn child_registry_guard() -> tokio::sync::MutexGuard<'static, ()> {
        CHILD_REGISTRY_GUARD.lock().await
    }

    /// 同步用例（`#[test]`，不在 runtime 内）的取闸形态。
    #[must_use = "持闸到用例结束：跨用例杀子进程会让别人的 fixture 变成死进程"]
    fn child_registry_guard_blocking() -> tokio::sync::MutexGuard<'static, ()> {
        CHILD_REGISTRY_GUARD.blocking_lock()
    }

    /// 退出收敛会在 wait future **仍存活**时直接驱动 kill 动作；Local 的 wait 若跨
    /// `await` 持 `Mutex<Child>`，kill 动作会抢不到锁而死锁 —— 回归钉子。
    #[tokio::test]
    async fn kill_action_does_not_deadlock_while_wait_is_polling() {
        let _guard = child_registry_guard().await;
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

    /// `kill()` 必须连带杀死**后代**进程。回归背景：jdtls 的包装器脚本被杀后，
    /// 它拉起的 JVM 孤儿化，堆积后互抢 Eclipse workspace 锁导致服务器永不初始化。
    /// **声明 `kill_tree`** 后子进程自成进程组，组杀应覆盖后代。
    ///
    /// **判据是事件，不是时间**：包装器与孙进程都继承同一条 stdout 管道（同一写端），
    /// 两者的写端全部关闭才 EOF。于是
    /// - 就绪 = 读到 `ready` 行（此刻 `sleep` 已 spawn，必然也持着写端）；
    /// - 收口 = `kill()` 之后管道 EOF。
    /// 若组杀漏掉孙进程，写端就仍被它持有 ⇒ 永远等不到 EOF（超时即失败信号）。
    /// 这里没有 sleep 轮询，也没有 `kill(pid, 0)` 采样 —— 不猜「多久算死了」，
    /// 只等事实（超时值只是失败预算，不是调度窗口）。
    #[tokio::test]
    async fn kill_kills_descendant_processes() {
        let _guard = child_registry_guard().await;
        use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};

        // `sleep` 继承 sh 的 stdout；`wait $!` 让包装器保持存活（模拟包装器 + 服务进程）。
        let mut child = LocalExecutor
            .spawn_with(
                SpawnOptions::new("sh", &["-c", "sleep 300 & echo ready; wait $!"])
                    .with_kill_tree(),
            )
            .await
            .expect("spawn sh");
        let (_, stdout, _) = child.take_stdio();
        let mut stdout = BufReader::new(stdout.expect("stdout is piped"));

        // 就绪：孙进程已 spawn 且持有写端（读一行即可，无轮询）。
        let mut ready = String::new();
        tokio::time::timeout(Duration::from_secs(5), stdout.read_line(&mut ready))
            .await
            .expect("wrapper must report readiness")
            .expect("read readiness line");
        assert_eq!(
            ready.trim(),
            "ready",
            "fixture must spawn the descendant first"
        );

        child.kill().await.expect("kill");

        // 收口：两个写端都关闭 ⇒ EOF。超时 = 有后代仍持有管道（漏杀）。
        let mut rest = Vec::new();
        tokio::time::timeout(Duration::from_secs(5), stdout.read_to_end(&mut rest))
            .await
            .unwrap_or_else(|_| {
                panic!("descendant still holds the stdout pipe after kill — group kill missed it")
            })
            .expect("read to EOF");
    }

    /// **端到端：登记表驱动的退出收敛真的能杀掉一个活着的进程。**
    ///
    /// 这是机制层的钉子。之前登记是可选动作（16 个 spawn 点只有 git 做了），
    /// 现在 `kill_tree` 自动登记。本用例验证从「spawn」到「登记表驱动」的整个链条：
    /// 不必经过 `save_app_state` / Tauri 运行时，直接调 `kill_all_live`。
    ///
    /// **判据是事件**：本用例的子进程就是被收敛的那一个，所以直接等它的 `wait` future
    /// 完成 —— 进程真退出才 resolve，不需要 `kill(pid, 0)` 采样或 sleep 轮询。
    ///
    /// 变异验证：把 `new_with_pid` 的 `kill_tree` 分支改成不登记 → 本用例红。
    ///
    /// 不写成 `#[tokio::test]`：`kill_all_live` 是**同步**入口（它借用全局 runtime
    /// 做 `block_on`），在 async 上下文里调会得 "Cannot start a runtime from within
    /// a runtime"。这也正是它在 shutdown 线程（非 runtime）里的正确用法。
    #[test]
    #[cfg(unix)]
    fn kill_all_live_actually_kills_a_registered_child() {
        let _guard = child_registry_guard_blocking();
        let child = crate::common::runtime::block_on_shutdown(async {
            LocalExecutor
                .spawn_with(SpawnOptions::new("sh", &["-c", "sleep 300"]).with_kill_tree())
                .await
                .expect("spawn sh")
        });
        let pid = child.pid.expect("local child has a pid");
        let pid_i32 = i32::try_from(pid).expect("pid fits i32");

        // 瞬时事实（不是等待）：刚 spawn 的进程必须活着。
        assert!(
            unsafe { libc::kill(pid_i32, 0) } == 0,
            "child must be alive right after spawn"
        );

        // 拆出 wait future；**kill 句柄必须活到 `kill_all_live` 之后** —— 登记表的
        // lease 由它（及其克隆）持有，提前 drop 会把该子进程从收敛表里注销。
        let (wait, kill_handle) = child.into_wait_and_kill();

        // 退出收敛驱动（同步入口，与 shutdown 路径同一个动作）。
        crate::common::executor::kill_all_live();

        // 事件：进程真退出时 wait 才 resolve（SIGKILL 后是毫秒级，超时只是失败预算）。
        // `wait` 的内层结果**不参与判据**：被 SIGKILL 的进程按 POSIX 报 `Killed`
        // （`Err`），正常的退出码则是 `Ok(_)` —— 两者都证明「进程已经结束」。
        let exited = crate::common::runtime::block_on_shutdown(async {
            tokio::time::timeout(Duration::from_secs(5), wait).await
        });
        assert!(
            exited.is_ok(),
            "child {pid} still alive after kill_all_live — 登记表没驱动 kill 动作"
        );

        drop(kill_handle);
    }

    /// L8：进程组只在**显式声明** `kill_tree` 时建立 —— 普通短命令（git / 探测 /
    /// 克隆）不再被无条件改进程组（那会改变信号传播语义）。
    #[tokio::test]
    #[cfg(unix)]
    async fn process_group_is_opt_in() {
        let _guard = child_registry_guard().await;
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
