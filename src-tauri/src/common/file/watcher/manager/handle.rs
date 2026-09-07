//! 单项目 watcher 句柄：聚合该项目的全部运行资源（watcher / 线程 / 发送端）。

use super::super::debounce::{DebounceSender, TreeChangeDebounceSender};
use super::super::git_meta::GitMetaWatcherHandle;
use super::super::gitignore::GitIgnoreFilter;
use super::super::registration::WatchRegistration;
use crate::common::git::status_worker::GitStatusWorker;
use notify::RecommendedWatcher;
use std::sync::mpsc;
use std::sync::{atomic::AtomicBool, Arc};

/// 单项目的 watcher 资源聚合（drop 即释放：debounce channel 关闭、停止信号置位）。
pub(in crate::common::file::watcher) struct WatcherHandle {
    /// Arc<Mutex> 包装：注册维护线程需要 &mut 执行 watch/unwatch
    pub(super) _watcher: Arc<std::sync::Mutex<RecommendedWatcher>>,
    /// S2 注册状态（策略/已注册集合）与维护消息发送端
    pub(super) _registration: Arc<std::sync::Mutex<WatchRegistration>>,
    pub(super) _maintenance_tx: Option<mpsc::Sender<super::super::registration::WatchMaintenance>>,
    // scheduler / worker / heartbeat：仅 git 项目持有，非 git 项目为 None
    pub(super) _scheduler: Option<super::super::debounce::ThrottleScheduler>,
    pub(super) _worker: Option<GitStatusWorker>,
    // .git 元数据监听器（HEAD 分支切换 + index 暂存/取消暂存 + worktree HEAD），
    pub(super) _head_watcher: Option<GitMetaWatcherHandle>,
    // file-changed debounce sender（drop 时关闭 channel，结束 debounce 线程）
    pub(super) _debounce: DebounceSender,
    // file-tree-changed debounce sender（Create/Remove/Rename 事件触发）
    pub(super) _tree_debounce: TreeChangeDebounceSender,
    // git 语义忽略过滤器（仅 git 项目；Arc 共享给回调/维护线程/读目录层）
    pub(super) _gitignore: Option<Arc<GitIgnoreFilter>>,
    pub(super) stop_signal: Arc<AtomicBool>,
    // 心跳线程：仅 git 项目持有
    pub(super) _heartbeat: Option<std::thread::JoinHandle<()>>,
}
