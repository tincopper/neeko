//! 子进程退出收敛登记表：登记**同一个**可重调 kill 动作，退出时统一驱动。
//!
//! git 传输层用 `SpawnOptions::with_kill_tree()` 自组 spawn（`git` → pre-push hook →
//! `pnpm` → `vitest` / `cargo` 一棵树）。取消路径能杀它，但**应用退出 / 运行时空停**时
//! 该 future 被丢弃、`kill` 动作不会执行 —— 整棵树会孤儿化（父进程退出不回收子进程）。
//!
//! 本模块让传输层在子进程**存活期**把它的 [`KillFn`]（与取消共用的**同一个**动作）登记进来；
//! `ChildLease` 在正常完成 / 取消后注销 ⇒ 退出快照基本只含存活项。
//! 退出时 `kill_all_live` 逐个驱动该动作（宿主本地树杀 / SSH 远端 kill 的差异已由 executor
//! 在构造 `KillFn` 时决定，本模块与传输层都不再分支执行目标）。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};

use super::KillFn;

type Slots = HashMap<u64, KillFn>;

fn slots() -> &'static Mutex<Slots> {
    static LIVE: OnceLock<Mutex<Slots>> = OnceLock::new();
    LIVE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 短临界锁；中毒 tolerant（登记表仍可用，与 `AppStateWrapper::main_window` 同风格）。
fn lock_slots() -> MutexGuard<'static, Slots> {
    slots()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// 存活子进程的登记句柄；`Drop` 时注销（RAII）。
#[must_use = "绑到一个变量：它 drop 时会注销该子进程"]
pub(crate) struct ChildLease {
    id: u64,
}

impl ChildLease {
    #[cfg(test)]
    pub(crate) const fn id(&self) -> u64 {
        self.id
    }
}

impl Drop for ChildLease {
    fn drop(&mut self) {
        lock_slots().remove(&self.id);
    }
}

/// 登记一个存活子进程的 kill 动作（与取消共用），返回 RAII 守卫。
pub(crate) fn register(kill: KillFn) -> ChildLease {
    static NEXT_ID: AtomicU64 = AtomicU64::new(1);
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    lock_slots().insert(id, kill);
    ChildLease { id }
}

/// 该登记号是否在册（仅测试可观测）。
#[cfg(test)]
#[must_use]
pub(crate) fn is_registered(id: u64) -> bool {
    lock_slots().contains_key(&id)
}

/// 退出时收敛：对每个登记项驱动其 kill 动作（同步，界内 5s）。
pub(crate) fn kill_all_live() {
    kill_all_with(&drive_kill);
}

/// 锁内快照 → 锁外驱动（kill 会阻塞，不能持锁）。
fn kill_all_with(killer: &dyn Fn(&KillFn)) {
    let kills: Vec<KillFn> = lock_slots().values().cloned().collect();
    dispatch(&kills, killer);
}

/// 纯分派核心（可测；不触碰全局表）。
fn dispatch(kills: &[KillFn], killer: &dyn Fn(&KillFn)) {
    for kill in kills {
        killer(kill);
    }
}

/// 同步驱动一个 kill 动作（退出清理线程非 runtime 内 → 借全局 runtime）。
fn drive_kill(kill: &KillFn) {
    crate::common::runtime::block_on_shutdown(async {
        let _ = tokio::time::timeout(KILL_GRACE, kill()).await;
    });
}

/// 单条 kill 动作的确认上界；超时只放弃等待（信号已尽力发出），不阻塞退出。
const KILL_GRACE: std::time::Duration = std::time::Duration::from_secs(5);

#[cfg(test)]
mod tests {
    use super::super::{KillFn, KillFuture};
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
    use std::sync::Arc;

    /// 调用即置位（便于同步断言），并返回一个完成的 KillFuture。
    fn recording_kill(flag: Arc<AtomicBool>) -> KillFn {
        Arc::new(move || {
            flag.store(true, AtomicOrdering::SeqCst);
            Box::pin(async { Ok(()) }) as KillFuture
        })
    }

    #[test]
    fn register_then_lease_drop_unregisters() {
        let lease = register(recording_kill(Arc::new(AtomicBool::new(false))));
        let id = lease.id();
        assert!(is_registered(id));
        drop(lease);
        assert!(!is_registered(id));
    }

    #[test]
    fn dispatch_invokes_every_registered_kill_action() {
        let flag = Arc::new(AtomicBool::new(false));
        let kills = vec![recording_kill(Arc::clone(&flag))];

        // 只驱动「构造 KILL future」这一步（调用动作），不 await —— recorder 在动作调用时置位。
        dispatch(&kills, &|kill| {
            let _ = kill();
        });

        assert!(flag.load(AtomicOrdering::SeqCst));
    }

    #[test]
    fn dispatch_on_empty_is_noop() {
        let kills: Vec<KillFn> = Vec::new();
        dispatch(&kills, &|kill| {
            let _ = kill();
        });
    }
}
