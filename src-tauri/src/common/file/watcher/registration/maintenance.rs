//! 注册维护线程：消费结构变化消息，串行执行注册维护。

use super::super::gitignore::GitIgnoreFilter;
use super::strategy::{WatchMaintenance, WatchRegistration};
use notify::RecommendedWatcher;
use std::path::PathBuf;
use std::sync::{mpsc, Arc};

/// 维护线程入口：消费结构变化消息，串行执行注册维护（持 watcher 锁）。
/// notify 回调内禁止 watch（FSEvents 死锁），故经此线程中转。
pub(in crate::common::file::watcher) fn spawn_maintenance_thread(
    watcher: Arc<std::sync::Mutex<RecommendedWatcher>>,
    root: PathBuf,
    filter: Option<Arc<GitIgnoreFilter>>,
    registration: Arc<std::sync::Mutex<WatchRegistration>>,
    rx: mpsc::Receiver<WatchMaintenance>,
) {
    let _ = std::thread::Builder::new()
        .name("watch-registration".to_string())
        .spawn(move || {
            while let Ok(msg) = rx.recv() {
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
