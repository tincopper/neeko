//! 注册维护线程：消费结构变化消息，串行执行注册维护。
//!
//! **生命周期契约（与 `manager/core.rs` 的所有权约定配套）**：本线程**不得**强持有
//! `RecommendedWatcher` —— 唯一强所有者是 `WatcherHandle`。持强引用会与「watcher 内的
//! notify 闭包持有本线程的 `maintenance_tx`」构成互相保活：watcher 不掉 → 闭包不掉 →
//! `tx` 不掉 → 本线程的 `rx.recv()` 永不返回 `Err` → 线程不退、它持有的 `Arc` 也不掉。
//! （2026-09-24 实测：同项目被 watch 4 次、单次变更被 emit 3 次。）
//! 改用 `Weak` 后，句柄 drop ⇒ watcher drop ⇒ 闭包与各 tx drop ⇒ 本线程既有的
//! "recv 断开即退出"语义自然生效，无需另设停机消息。

use super::super::gitignore::GitIgnoreFilter;
use super::strategy::{WatchMaintenance, WatchRegistration};
use notify::RecommendedWatcher;
use std::path::PathBuf;
use std::sync::{mpsc, Arc, Weak};

/// 维护线程入口：消费结构变化消息，串行执行注册维护（持 watcher 锁）。
/// notify 回调内禁止 watch（FSEvents 死锁），故经此线程中转。
pub(in crate::common::file::watcher) fn spawn_maintenance_thread(
    watcher: Weak<std::sync::Mutex<RecommendedWatcher>>,
    root: PathBuf,
    filter: Option<Arc<GitIgnoreFilter>>,
    registration: Arc<std::sync::Mutex<WatchRegistration>>,
    rx: mpsc::Receiver<WatchMaintenance>,
) {
    let _ = std::thread::Builder::new()
        .name("watch-registration".to_string())
        .spawn(move || {
            while let Ok(msg) = rx.recv() {
                // 强所有者（句柄）已释放 ⇒ 无需再维护任何目录，直接退出。
                // 注意：upgrade 失败与「tx 全部断开」是同一件事的两面，此处显式退出
                // 以免依赖 drop 顺序的偶然性。
                let Some(watcher) = watcher.upgrade() else {
                    log::debug!(
                        "[WatchRegistration] watcher owner released, stopping maintenance thread"
                    );
                    break;
                };
                let Ok(mut watcher) = watcher.lock() else {
                    break;
                };
                let filter_ref = filter.as_deref();
                let mut reg = match registration.lock() {
                    Ok(reg) => reg,
                    Err(e) => {
                        log::warn!("[WatchRegistration] registration mutex poisoned: {}", e);
                        break;
                    }
                };
                // MutexGuard 不实现 Watcher：显式解引用到内层
                match msg {
                    WatchMaintenance::AddDir(dir) => {
                        reg.on_dir_added(&mut *watcher, &root, &dir, filter_ref);
                    }
                    WatchMaintenance::RemoveDir(dir) => {
                        reg.on_dir_removed(&mut *watcher, &dir);
                    }
                    WatchMaintenance::ReloadAll => {
                        reg.on_rules_changed(&mut *watcher, &root, filter_ref);
                    }
                }
            }
        });
}
