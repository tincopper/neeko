//! per-Workspace **重算单飞**闸门：同一单元同时只有一轮重算在飞。
//!
//! 为什么需要（第一性原理）：`git status` 的读是**按需**的（面板挂载 / 聚焦 / 事件刷新
//! 常常在同一帧内多次请求同一个单元）。没有单飞时，10 个并发读会跑 10 个 `git` 子进程，
//! 而它们的结果几乎相同 —— 成本线性放大、收益为零。单飞把「并发读」折叠成「一次算 + 九次
//! 复用」，且不改变语义：读到的东西仍然是**算完之后**的权威值（后者在拿到闸门后重新判
//! `needs_recompute`，已是干净条目就直接返回）。
//!
//! 为什么不是 `GitSyncSlots`（`common/git/transport/cancel.rs`）：那是**用户可取消的写操作**
//! 的互斥，语义是「同一单元已有操作在跑 ⇒ 显式拒绝（`AppError::Conflict`）」。读路径不能拒绝
//! —— 拒绝会让 UI 拿到错误而不是数据。这里的语义是**排队**（等待而非报错）。
//!
//! 锁纪律：`std::sync::Mutex` 只保护「取/建这条 key 的闸门」这一小段，**绝不跨 await 持有**；
//! 等待发生在 `tokio::sync::Mutex` 上（异步友好，不占线程）。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};

/// 单飞闸门表（一个 `WatcherManager` 一份）。
#[derive(Default)]
pub struct RecomputeGate {
    /// 单元 key → 该单元的闸门。只在需要时创建，规模与「被读过的单元数」同阶
    /// （每次重算都会登记快照，因此与登记表容量同阶）。
    gates: Mutex<HashMap<String, Arc<AsyncMutex<()>>>>,
}

impl RecomputeGate {
    /// 空闸门表。
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// 取得 `key` 的重算许可：已有在飞的一轮时**等待**它结束，而不是拒绝。
    ///
    /// 返回的守卫 drop 即释放；调用方必须在拿到它之后**重新判定** `needs_recompute`
    /// （等到的这一轮可能已经把数据算新了，此时再算一次纯属浪费）。
    pub async fn acquire(&self, key: &str) -> OwnedMutexGuard<()> {
        // 只在这一小段持 std 锁：取 Arc 后立刻释放，等待发生在下面（不跨 await 持锁）。
        let gate = {
            let mut gates = self
                .gates
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            Arc::clone(
                gates
                    .entry(key.to_string())
                    .or_insert_with(|| Arc::new(AsyncMutex::new(()))),
            )
        };
        gate.lock_owned().await
    }

    /// 丢弃某单元的闸门（该单元已不存在时调用，避免表无界增长）。
    pub fn forget(&self, key: &str) {
        let removed = self
            .gates
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(key);
        // 显式 drop：若此刻仍有持有者在飞，它会安全地跑完（Arc 由它持有）。
        drop(removed);
    }

    /// 当前闸门条目数（测试观测口）。
    #[must_use]
    pub fn len(&self) -> usize {
        self.gates.lock().map_or(0, |gates| gates.len())
    }

    /// 是否没有任何闸门（测试观测口）。
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    /// 同一 key 的并发持锁数**从不超过 1**，且后到者排队而不是失败。
    #[tokio::test]
    async fn same_key_is_mutually_exclusive_and_queues() {
        let gate = Arc::new(RecomputeGate::new());
        let concurrent = Arc::new(AtomicUsize::new(0));
        let max_concurrent = Arc::new(AtomicUsize::new(0));
        let finished = Arc::new(AtomicUsize::new(0));

        let mut handles = Vec::new();
        for _ in 0..10 {
            let gate = Arc::clone(&gate);
            let concurrent = Arc::clone(&concurrent);
            let max_concurrent = Arc::clone(&max_concurrent);
            let finished = Arc::clone(&finished);
            handles.push(tokio::spawn(async move {
                let _guard = gate.acquire("k1").await;
                let now = concurrent.fetch_add(1, Ordering::SeqCst) + 1;
                max_concurrent.fetch_max(now, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(5)).await;
                concurrent.fetch_sub(1, Ordering::SeqCst);
                finished.fetch_add(1, Ordering::SeqCst);
            }));
        }
        for handle in handles {
            handle.await.expect("task");
        }

        assert_eq!(
            max_concurrent.load(Ordering::SeqCst),
            1,
            "同一单元不得并行重算"
        );
        assert_eq!(
            finished.load(Ordering::SeqCst),
            10,
            "后到者排队完成，不拒绝"
        );
    }

    /// 不同 key 互不阻塞（单飞的粒度是 Workspace，不是全局）。
    #[tokio::test]
    async fn different_keys_do_not_block_each_other() {
        let gate = RecomputeGate::new();
        let _held = gate.acquire("k1").await;
        // 另一个单元可以立刻拿到许可（若被阻塞，这里会挂住 ⇒ 由超时兜底）
        let other = tokio::time::timeout(Duration::from_millis(200), gate.acquire("k2")).await;
        assert!(other.is_ok(), "不同单元的重算不得互相阻塞");
    }

    #[test]
    fn forget_removes_the_slot() {
        let gate = RecomputeGate::new();
        let _ = futures_block_on(gate.acquire("k1"));
        assert_eq!(gate.len(), 1);
        gate.forget("k1");
        assert!(gate.is_empty());
    }

    /// 测试用的最小阻塞驱动（仅测试码；生产路径始终在 tokio 上下文里 await）。
    fn futures_block_on<F: std::future::Future>(future: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime")
            .block_on(future)
    }
}
