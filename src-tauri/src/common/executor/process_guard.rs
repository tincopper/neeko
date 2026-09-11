//! 子进程清理守卫：信号触发 + reaper 收敛 + RAII 兜底。
//!
//! 与 [`CommandExecutor::into_wait_and_kill`](super::CommandExecutor::into_wait_and_kill)
//! 配套使用。DAP 的两类子进程（debug adapter 本体、Java attach-first 的
//! debuggee 测试 JVM）共用同一生命周期模型：
//!
//! - `terminate` 是**异步**的 —— 旧实现在 async 上下文用
//!   `std::sync::mpsc::recv_timeout` 同步等待，最长 2s 堵住 tokio worker；
//! - kill 信号可共享（transport 需要在自身错误路径上主动终止进程）；
//! - `Drop` 兜底：任何提前返回 / 条目移除 / 进程退出都不泄漏子进程。

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Notify;
use tokio::task::JoinHandle;

use super::ExecError;

/// `terminate` 等待 reaper 收敛的宽限；超时只告警，不再阻塞更久。
const REAPER_GRACE: Duration = Duration::from_secs(5);

/// reaper 待等待的退出 future（[`into_wait_and_kill`](super::CommandExecutor::into_wait_and_kill) 的产物）。
type WaitFuture = Pin<Box<dyn Future<Output = Result<i32, ExecError>> + Send>>;
/// 强制终止回调（同上）。
type KillFn =
    Box<dyn FnOnce() -> Pin<Box<dyn Future<Output = Result<(), ExecError>> + Send>> + Send>;

/// 子进程清理守卫。
pub struct ProcessGuard {
    /// kill 触发器；`Arc` 使 transport 等路径能共享同一信号。
    signal: Arc<Notify>,
    /// reaper 任务句柄；`terminate` 取走以等待收敛，`Drop` 则任其 detached 收尾。
    reaper: Option<JoinHandle<()>>,
}

impl ProcessGuard {
    /// 以子进程的「退出 future + 强制终止回调」构造守卫并启动 reaper：
    /// 收到 kill 信号 → 调回调终止；子进程自行退出 → 直接收敛。
    #[must_use]
    pub fn new(wait: WaitFuture, kill: KillFn) -> Self {
        let signal = Arc::new(Notify::new());
        let reaper_signal = Arc::clone(&signal);
        let reaper = tokio::spawn(async move {
            tokio::select! {
                _ = reaper_signal.notified() => { let _ = kill().await; }
                _ = wait => {}
            }
        });
        Self {
            signal,
            reaper: Some(reaper),
        }
    }

    /// 共享的 kill 触发器（transport 错误路径持有克隆以主动终止进程）。
    #[must_use]
    pub fn kill_handle(&self) -> Arc<Notify> {
        Arc::clone(&self.signal)
    }

    /// 请求终止并等待 reaper 收敛。全异步 —— 不阻塞 runtime worker。
    pub async fn terminate(mut self) {
        self.signal();
        if let Some(mut reaper) = self.reaper.take() {
            if tokio::time::timeout(REAPER_GRACE, &mut reaper)
                .await
                .is_err()
            {
                log::warn!("[exec] child reaper did not settle within {REAPER_GRACE:?}");
            }
        }
    }

    /// 发出 kill 信号（`Notify` 幂等：无等待者时存一个 permit）。
    fn signal(&self) {
        self.signal.notify_one();
    }
}

impl Drop for ProcessGuard {
    fn drop(&mut self) {
        // RAII 兜底：只发信号不等待（Drop 不能 await）；实际清理由 reaper 异步完成。
        self.signal();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};

    fn pending_wait() -> WaitFuture {
        Box::pin(std::future::pending())
    }

    fn recording_kill(flag: Arc<AtomicBool>) -> KillFn {
        Box::new(move || {
            Box::pin(async move {
                flag.store(true, Ordering::SeqCst);
                Ok(())
            })
        })
    }

    /// `terminate` 触发 kill 回调并等待 reaper 收敛（不阻塞、不超时告警）。
    /// `wait` 永不完成，确保收敛只能走 kill 分支（无 select 竞态）。
    #[tokio::test]
    async fn terminate_runs_kill_and_converges() {
        let killed = Arc::new(AtomicBool::new(false));
        let guard = ProcessGuard::new(pending_wait(), recording_kill(Arc::clone(&killed)));
        tokio::time::timeout(Duration::from_secs(2), guard.terminate())
            .await
            .expect("terminate 必须在宽限内收敛");
        assert!(
            killed.load(Ordering::SeqCst),
            "terminate 必须触发 kill 回调"
        );
    }

    /// `Drop` 是 RAII 兜底：即使没有显式 `terminate`（启动失败 / 条目被移除 /
    /// 进程退出），也必须发出 kill 信号，reaper 异步执行清理。
    #[tokio::test]
    async fn drop_signals_kill_without_terminate() {
        let killed = Arc::new(AtomicBool::new(false));
        let guard = ProcessGuard::new(pending_wait(), recording_kill(Arc::clone(&killed)));
        drop(guard);
        let deadline = tokio::time::Instant::now() + Duration::from_secs(2);
        while !killed.load(Ordering::SeqCst) {
            assert!(
                tokio::time::Instant::now() < deadline,
                "Drop 必须发出 kill 信号"
            );
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    }
}
