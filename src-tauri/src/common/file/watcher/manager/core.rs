//! `WatcherManager` 编排：为每个项目启动文件监听，计算 git status 快照并聚合子模块。

use super::super::debounce::{DebounceSender, ThrottleScheduler, TreeChangeDebounceSender};
use super::super::git_meta::{create_git_meta_watcher, resolve_git_meta_paths};
use super::super::gitignore::GitIgnoreFilter;
use super::super::registration::{spawn_maintenance_thread, WatchRegistration};
use super::super::types::{
    GitPerfSuggestionEvent, GIT_CHANGED_EVENT, GIT_PERF_SUGGESTION_EVENT, GIT_STATUS_SNAPSHOT_EVENT,
};
use super::callbacks::build_notify_callback;
use super::handle::WatcherHandle;
use crate::common::git::local::is_git_repo;
use crate::common::git::status_worker::{GitStatusSnapshot, GitStatusWorker};
use notify::{Config, RecommendedWatcher, Watcher};
use std::path::PathBuf;
use std::sync::mpsc;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter};

/// Manages file-system watchers for multiple projects.
///
/// Each project gets a dedicated watcher thread that monitors file changes,
/// computes authoritative git status snapshots, and emits them to the frontend.
#[derive(Clone)]
pub struct WatcherManager {
    /// Map of project IDs to active watcher handles.
    watchers: Arc<Mutex<HashMap<String, WatcherHandle>>>,
    /// G2 单一权威化：每项目最新 versioned 快照（worker 产出，invoke 读接口走这里，
    /// 不再跑第二套 libgit2 status —— D2 收编）。
    snapshots: Arc<Mutex<HashMap<String, Arc<GitStatusSnapshot>>>>,
}

impl Default for WatcherManager {
    fn default() -> Self {
        Self::new()
    }
}

impl WatcherManager {
    /// Create a new empty `WatcherManager`.
    #[must_use]
    pub fn new() -> Self {
        Self {
            watchers: Arc::new(Mutex::new(HashMap::new())),
            snapshots: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// 该项目的 git 语义忽略过滤器（S5：读目录层复用做读前剪枝 + ignored 标记；
    /// 非 git 项目 / 尚未 watch 时为 None —— 读层退化为仅 .git 硬过滤）。
    #[must_use]
    pub fn gitignore_for(&self, project_id: &str) -> Option<Arc<GitIgnoreFilter>> {
        self.watchers
            .lock()
            .ok()?
            .get(project_id)?
            ._gitignore
            .clone()
    }

    /// 最新权威 status 快照（G2 D2 读接口数据源）。
    /// `None` = watcher 尚未产出（非 git 项目 / 尚未 watch / 启动初期首快照未到）。
    #[must_use]
    pub fn snapshot(&self, project_id: &str) -> Option<Arc<GitStatusSnapshot>> {
        self.snapshots
            .lock()
            .ok()
            .and_then(|m| m.get(project_id).cloned())
    }

    /// Start watching the given project directory for file changes.
    pub fn watch(&self, project_id: String, path: PathBuf, app_handle: AppHandle) {
        let app_for_diff = app_handle.clone();

        // 非 git 项目：跳过所有 git 相关资源（worker / scheduler / heartbeat / git meta watcher），
        // 仅保留文件监听 + 文件树变更事件。避免对非 git 仓库启动 git status worker 执行 git rev-parse 等命令。
        let git_repo = is_git_repo(&path);

        // 1. 创建 GitStatusWorker —— status 唯一计算路径（D1）。
        // 每次实质变化产出**完整 versioned 快照**：写共享注册表（invoke 读接口
        // 的数据源，D2 收编）+ 发 v2 事件整体替换（D3，替代增量 patch）。
        // 非 git 项目跳过：避免对非 git 仓库启动 git status worker 执行 git rev-parse 等命令
        let (worker, scheduler) = if git_repo {
            let pid_emit = project_id.clone();
            let snapshots_store = self.snapshots.clone();
            let worker =
                GitStatusWorker::start(path.clone(), move |mut snapshot: GitStatusSnapshot| {
                    snapshot.project_id = pid_emit.clone();
                    // 写共享快照：get_worktree_changed_files 读接口与事件同源同版本
                    if let Ok(mut map) = snapshots_store.lock() {
                        map.insert(pid_emit.clone(), Arc::new(snapshot.clone()));
                    }
                    // v2 事件：versioned 全量快照，前端整体替换（version gate 拒旧）
                    let _ = app_for_diff.emit(GIT_STATUS_SNAPSHOT_EVENT, &snapshot);
                });

            // 2. 创建 ThrottleScheduler -- 合并 notify 事件，驱动 worker.check()
            let worker_clone = worker.clone();
            let scheduler = ThrottleScheduler::new(move || {
                worker_clone.check();
            });

            // 立即触发一次 git status 检查，获取初始状态（首个快照由 worker 线程异步产出）
            worker.check();

            (Some(worker), Some(scheduler))
        } else {
            log::info!(
                "[Watcher] Skipping git status worker for non-git project {} at {}",
                project_id,
                path.display()
            );
            (None, None)
        };

        // 3. 创建 file-changed debounce sender
        let debounce = DebounceSender::new(project_id.clone(), path.clone(), app_handle.clone());

        // 3b. 创建 file-tree-changed debounce sender（专门处理 Create/Remove/Rename，
        // S2-1：收集变更路径的父目录集合，前端只重载命中桶）
        let tree_debounce =
            TreeChangeDebounceSender::new(project_id.clone(), path.clone(), app_handle.clone());

        // 4. 创建 notify watcher -- 递归监听 + 路径过滤
        // 从 scheduler 克隆 Sender 传给 notify 闭包（非 git 项目时为 None）
        let scheduler_tx = scheduler.as_ref().map(|s| s.sender());
        let debounce_tx_for_notify = debounce.tx.clone();
        let tree_debounce_tx = tree_debounce.tx.clone();
        let pid_log = project_id.clone();
        let app_for_watcher_error = app_handle.clone();
        // git 语义忽略过滤器：编译 .gitignore / .git/info/exclude 规则，
        // 与 git 自身行为一致（不再是硬编码目录名黑名单）。
        // 非 git 项目时为 None，不做 gitignore 过滤。
        let gitignore_filter = if git_repo {
            Some(GitIgnoreFilter::new(path.clone()))
        } else {
            None
        };
        // S2：filter 以 Option<Arc<..>> 共享给闭包（事件过滤 + 规则热重载）、
        // 注册维护线程、WatcherHandle —— 单一实例三方可见
        let gitignore_filter_for_notify: Option<Arc<GitIgnoreFilter>> =
            gitignore_filter.map(Arc::new);
        let gitignore_for_handle = gitignore_filter_for_notify.clone();
        // 注册维护通道：闭包（回调）只投递消息，独立线程执行 watch/unwatch
        let (maintenance_tx, maintenance_rx) =
            mpsc::channel::<super::super::registration::WatchMaintenance>();
        let maintenance_tx_for_closure = maintenance_tx.clone();
        let notify_result = RecommendedWatcher::new(
            build_notify_callback(
                pid_log,
                app_for_watcher_error,
                gitignore_filter_for_notify,
                maintenance_tx_for_closure,
                debounce_tx_for_notify,
                tree_debounce_tx,
                scheduler_tx,
                git_repo,
            ),
            Config::default(),
        );

        let watcher = match notify_result {
            Ok(w) => w,
            Err(e) => {
                log::warn!("[Watcher] create error for {}: {}", path.display(), e);
                return;
            }
        };
        // Arc<Mutex> 包装：S2 注册维护线程需要 &mut 执行 watch/unwatch
        //（notify 回调内禁止 watch —— FSEvents 死锁，故经独立线程中转）
        let watcher = Arc::new(std::sync::Mutex::new(watcher));

        // S2 注册：初始 watch + 结构维护通道（ignored 子树在注册层排除）
        let registration = Arc::new(std::sync::Mutex::new(WatchRegistration::default()));
        {
            let mut w = match watcher.lock() {
                Ok(watcher) => watcher,
                Err(e) => {
                    log::warn!(
                        "[Watcher:{}] watcher mutex poisoned during registration: {}",
                        project_id,
                        e
                    );
                    return;
                }
            };
            let mut reg = match registration.lock() {
                Ok(registration) => registration,
                Err(e) => {
                    log::warn!(
                        "[Watcher:{}] registration mutex poisoned during registration: {}",
                        project_id,
                        e
                    );
                    return;
                }
            };
            // MutexGuard 不实现 Watcher：显式解引用到内层 &mut RecommendedWatcher
            reg.register_root(&mut *w, &path, gitignore_for_handle.as_deref());
        }
        spawn_maintenance_thread(
            Arc::clone(&watcher),
            path.clone(),
            gitignore_for_handle.clone(),
            Arc::clone(&registration),
            maintenance_rx,
        );

        log::info!(
            "[Watcher] Started watching project {} at {}",
            project_id,
            path.display()
        );

        // 4b. 创建 git 元数据 watcher -- 单独监听 .git（HEAD / index / worktrees +
        // linked worktree 工作目录），绕过 git 忽略过滤（该过滤会丢弃 .git 内事件，
        // 导致 checkout 后 git worker 无法感知分支变化，changes 列表残留旧分支数据）。
        let head_watcher = if git_repo {
            resolve_git_meta_paths(&path).and_then(|meta| {
                let scheduler_tx = scheduler.as_ref().map(|s| s.sender());
                let scheduler_tx_for_head = scheduler_tx.clone();
                let pid_index = project_id.clone();
                let pid_head = project_id.clone();
                let pid_wt = project_id.clone();
                let app_for_head = app_handle.clone();
                let app_for_worktree = app_handle.clone();
                create_git_meta_watcher(
                    project_id.clone(),
                    &meta,
                    move || {
                        // 公理1（信号≠事实）：index 写入只作为查询调度提示，
                        // 交由 worker 查询-比较后决定是否通知——不再无条件触发
                        // 全量刷新。此前无条件 `signal()` 会与 git 命令写 index
                        // 形成自反馈回路（git-changed → 前端刷新命令写 index →
                        // index 事件 → 再 git-changed）。
                        log::debug!(
                            "[Watcher:{}] git index changed, hinting git status check",
                            pid_index
                        );
                        if let Some(tx) = &scheduler_tx {
                            let _ = tx.send(());
                        }
                    },
                    move |has_wt| {
                        log::debug!("[Watcher:{}] HEAD changed, triggering git status", pid_head);
                        if let Some(tx) = &scheduler_tx_for_head {
                            let _ = tx.send(());
                        }
                        if has_wt {
                            let _ = app_for_head.emit(GIT_CHANGED_EVENT, &pid_head);
                        }
                    },
                    // G3：worktree 区域（.git/worktrees/* HEAD/index）或 linked worktree
                    // 工作目录内的任何变更 → 前端按 activeWorktree 刷新（P4）。
                    // 无条件发 git-changed（不再依赖 has_wt 的 rearm 时机）；前端
                    // 500ms debounce 合并高频事件，无 activeWorktree 时读主快照幂等。
                    move || {
                        log::debug!(
                            "[Watcher:{}] worktree area changed, signaling frontend refresh",
                            pid_wt
                        );
                        let _ = app_for_worktree.emit(GIT_CHANGED_EVENT, &pid_wt);
                    },
                )
            })
        } else {
            None
        };

        // 停止信号（供心跳线程使用）
        let stop = Arc::new(AtomicBool::new(false));

        // 自愈补挂：worktrees 目录可能在会话中途出现（git worktree add），
        // 心跳线程定期复查并补挂递归监听（notify 回调内禁止再调 watch）。
        let head_watcher_for_rearm = head_watcher.clone();

        // 5. 启动心跳线程：每 30s 主动触发一次 git status 检查
        // 作为 notify 在 Windows 下可能丢失事件时的兜底机制。
        // 非 git 项目跳过心跳线程（无 worker 可驱动）。
        let heartbeat = if git_repo {
            let heartbeat_worker = worker.clone();
            let heartbeat_stop = stop.clone();
            let heartbeat_pid = project_id.clone();
            Some(
                std::thread::Builder::new()
                    .name(format!("git-heartbeat-{}", project_id))
                    .spawn(move || {
                        let mut tick: u32 = 0;
                        loop {
                            std::thread::sleep(Duration::from_secs(10));
                            if heartbeat_stop.load(Ordering::Relaxed) {
                                log::debug!("[Watcher] Heartbeat stopping for {}", heartbeat_pid);
                                break;
                            }
                            tick = (tick + 1) % 3;
                            if tick == 0 {
                                log::debug!("[Watcher] Heartbeat check for {}", heartbeat_pid);
                                if let Some(ref w) = heartbeat_worker {
                                    w.check();
                                }
                            }
                            if let Some(meta_watcher) = &head_watcher_for_rearm {
                                meta_watcher.rearm_worktrees_if_needed();
                            }
                        }
                    })
                    .expect("Failed to spawn heartbeat thread"),
            )
        } else {
            None
        };

        // 6. 一次性性能引导检测（G7，公理 3「借力 git 本身的优化」）：大仓库且
        // fsmonitor/untracked cache 未启用时发一次建议事件（独立线程，同步桥安全；
        // 只提示不代改用户仓库配置）。仅 git 项目：与 worker/heartbeat 同款门控，
        // 非 git 目录不启动 git 探测线程。
        if git_repo {
            let app_for_perf = app_handle.clone();
            let pid_perf = project_id.clone();
            let perf_root = path.clone();
            let _ = std::thread::Builder::new()
                .name(format!("git-perf-{}", project_id))
                .spawn(move || {
                    let suggestions = crate::common::git::perf::detect_perf_suggestions(&perf_root);
                    if suggestions.is_empty() {
                        return;
                    }
                    log::info!(
                        "[Watcher:{}] {} git perf suggestions",
                        pid_perf,
                        suggestions.len()
                    );
                    let _ = app_for_perf.emit(
                        GIT_PERF_SUGGESTION_EVENT,
                        &GitPerfSuggestionEvent {
                            project_id: pid_perf,
                            suggestions,
                        },
                    );
                });
        }

        if let Ok(mut watchers) = self.watchers.lock() {
            watchers.insert(
                project_id,
                WatcherHandle {
                    _watcher: watcher,
                    _registration: registration,
                    _maintenance_tx: Some(maintenance_tx),
                    _scheduler: scheduler,
                    _worker: worker,
                    _head_watcher: head_watcher,
                    _debounce: debounce,
                    _tree_debounce: tree_debounce,
                    _gitignore: gitignore_for_handle,
                    stop_signal: stop,
                    _heartbeat: heartbeat,
                },
            );
        }
    }

    /// Stop watching the given project and clean up resources.
    pub fn unwatch(&self, project_id: &str) {
        if let Ok(mut watchers) = self.watchers.lock() {
            if let Some(handle) = watchers.remove(project_id) {
                handle.stop_signal.store(true, Ordering::Relaxed);
            }
        }
        crate::common::file::services::invalidate_remote_ignored_cache(project_id);
    }

    /// Stop all active file watchers.
    pub fn stop_all(&self) {
        log::info!("[Watcher] Stopping all watchers...");
        let stopped_ids: Vec<String> = if let Ok(mut watchers) = self.watchers.lock() {
            let ids: Vec<String> = watchers.keys().cloned().collect();
            for (_id, watcher) in watchers.drain() {
                watcher.stop_signal.store(true, Ordering::Relaxed);
            }
            ids
        } else {
            Vec::new()
        };
        for project_id in stopped_ids {
            crate::common::file::services::invalidate_remote_ignored_cache(&project_id);
        }
        log::info!("[Watcher] All watchers stopped");
    }
}
