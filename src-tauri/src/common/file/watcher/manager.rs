//! `WatcherManager` 编排：为每个项目启动文件监听，聚合各子模块。

use super::debounce::{
    DebounceSender, GitChangedDebounceSender, ThrottleScheduler, TreeChangeDebounceSender,
};
use super::git_meta::{create_git_meta_watcher, resolve_git_meta_paths, GitMetaWatcherHandle};
use super::gitignore::GitIgnoreFilter;
use super::types::{GIT_CHANGED_EVENT, GIT_STATUS_DIFF_EVENT};
use crate::common::git::local::is_git_repo;
use crate::common::git::status_worker::{GitStatusDiff, GitStatusWorker};
use notify::event::ModifyKind;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter};

// ── WatcherHandle & WatcherManager ───────────────────────────────────────────

struct WatcherHandle {
    _watcher: RecommendedWatcher,
    // scheduler / worker / heartbeat：仅 git 项目持有，非 git 项目为 None
    _scheduler: Option<ThrottleScheduler>,
    _worker: Option<GitStatusWorker>,
    // .git 元数据监听器（HEAD 分支切换 + index 暂存/取消暂存 + worktree HEAD），
    _head_watcher: Option<GitMetaWatcherHandle>,
    // file-changed debounce sender（drop 时关闭 channel，结束 debounce 线程）
    _debounce: DebounceSender,
    // file-tree-changed debounce sender（Create/Remove/Rename 事件触发）
    _tree_debounce: TreeChangeDebounceSender,
    // git 语义忽略过滤器（仅 git 项目）
    _gitignore: Option<GitIgnoreFilter>,
    stop_signal: Arc<AtomicBool>,
    // 心跳线程：仅 git 项目持有
    _heartbeat: Option<std::thread::JoinHandle<()>>,
}

/// Manages file-system watchers for multiple projects.
///
/// Each project gets a dedicated watcher thread that monitors file changes,
/// computes git status diffs, and emits events to the frontend.
#[derive(Clone)]
pub struct WatcherManager {
    /// Map of project IDs to active watcher handles.
    watchers: Arc<Mutex<HashMap<String, WatcherHandle>>>,
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
        }
    }

    /// Start watching the given project directory for file changes.
    pub fn watch(&self, project_id: String, path: PathBuf, app_handle: AppHandle) {
        let app_for_diff = app_handle.clone();

        // 非 git 项目：跳过所有 git 相关资源（worker / scheduler / heartbeat / git meta watcher），
        // 仅保留文件监听 + 文件树变更事件。避免对非 git 仓库启动 git status worker 执行 git rev-parse 等命令。
        let git_repo = is_git_repo(&path);

        // 1. 创建 GitStatusWorker -- 有变化时发增量 diff 事件
        // 非 git 项目跳过：避免对非 git 仓库启动 git status worker 执行 git rev-parse 等命令
        let (worker, scheduler) = if git_repo {
            let pid_emit = project_id.clone();
            // git-changed 全量 fallback 节流 sender：worker 闭包持有其 clone 即可
            // 保证 channel 存活，原始 sender 无需在 WatcherHandle 中冗余保存。
            let git_changed_signal =
                GitChangedDebounceSender::new(project_id.clone(), app_handle.clone());
            let worker = GitStatusWorker::start(path.clone(), move |mut diff: GitStatusDiff| {
                diff.project_id = pid_emit.clone();
                // 增量 diff 事件（即时、轻量，前端直接 patch store）
                let _ = app_for_diff.emit(GIT_STATUS_DIFF_EVENT, &diff);
                // 全量刷新 fallback：经节流器合并，静默 500ms 后才 emit 一次
                git_changed_signal.signal();
            });

            // 2. 创建 ThrottleScheduler -- 合并 notify 事件，驱动 worker.check()
            let worker_clone = worker.clone();
            let scheduler = ThrottleScheduler::new(move || {
                worker_clone.check();
            });

            // 立即触发一次 git status 检查，获取初始状态
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

        // 3b. 创建 file-tree-changed debounce sender（专门处理 Create/Remove/Rename）
        let tree_debounce = TreeChangeDebounceSender::new(project_id.clone(), app_handle.clone());

        // 4. 创建 notify watcher -- 递归监听 + 路径过滤
        // 从 scheduler 克隆 Sender 传给 notify 闭包（非 git 项目时为 None）
        let scheduler_tx = scheduler.as_ref().map(|s| s.sender());
        let debounce_tx_for_notify = debounce.tx.clone();
        let tree_debounce_tx = tree_debounce.tx.clone();
        let pid_log = project_id.clone();
        // git 语义忽略过滤器：编译 .gitignore / .git/info/exclude 规则，
        // 与 git 自身行为一致（不再是硬编码目录名黑名单）。
        // 非 git 项目时为 None，不做 gitignore 过滤。
        let gitignore_filter = if git_repo {
            Some(GitIgnoreFilter::new(path.clone()))
        } else {
            None
        };
        // 为 notify 闭包克隆一份（闭包会 move），原值保留给 WatcherHandle
        let gitignore_filter_for_notify = gitignore_filter.clone();
        let notify_result = RecommendedWatcher::new(
            move |result: Result<Event, notify::Error>| {
                let event = match result {
                    Ok(ev) => ev,
                    Err(e) => {
                        log::warn!("[Watcher:{}] notify error: {}", pid_log, e);
                        return;
                    }
                };

                // 路径过滤：git 项目走 gitignore 规则，非 git 项目仅硬过滤 .DS_Store/.git
                let relevant_paths: Vec<PathBuf> = match gitignore_filter_for_notify {
                    Some(ref filter) => {
                        // .gitignore / .git/info/exclude 自身变更时重载规则
                        let rules_changed = event.paths.iter().any(|p| {
                            let name = p.file_name().map(|n| n.to_string_lossy().to_string());
                            matches!(name.as_deref(), Some(".gitignore") | Some("exclude"))
                        });
                        if rules_changed {
                            filter.reload();
                        }
                        event
                            .paths
                            .iter()
                            .filter(|p| !filter.should_ignore(p))
                            .cloned()
                            .collect()
                    }
                    None => event
                        .paths
                        .iter()
                        .filter(|p| {
                            !p.file_name()
                                .and_then(|n| n.to_str())
                                .is_some_and(|n| n == ".DS_Store" || n == ".git")
                        })
                        .cloned()
                        .collect(),
                };

                if relevant_paths.is_empty() {
                    return;
                }

                // 每个 FS 事件都会触发，高频；降为 trace 避免刷爆日志
                log::trace!(
                    "[Watcher:{}] FS event {:?}, paths={:?}, relevant={}",
                    pid_log,
                    event.kind,
                    event.paths,
                    !relevant_paths.is_empty()
                );

                if git_repo {
                    // 驱动 git worker（仅 git 项目有 scheduler）
                    if let Some(ref tx) = scheduler_tx {
                        let _ = tx.send(());
                    }
                }
                // 发送变更路径给 debounce sender（用于文件 tab 刷新）
                for p in &relevant_paths {
                    let _ = debounce_tx_for_notify.send(p.clone());
                }
                // 文件树结构变更（新增/删除/重命名）时额外触发 tree-changed 防抖。
                let is_structure_change = matches!(
                    event.kind,
                    EventKind::Create(_)
                        | EventKind::Remove(_)
                        | EventKind::Modify(ModifyKind::Name(_))
                );
                if is_structure_change {
                    let _ = tree_debounce_tx.send(());
                }
            },
            Config::default(),
        );

        let mut watcher = match notify_result {
            Ok(w) => w,
            Err(e) => {
                log::warn!("[Watcher] create error for {}: {}", path.display(), e);
                return;
            }
        };

        // 递归监听：捕获深层文件变化（src/nested/file.rs 等）
        // 通过 git 语义忽略过滤（.gitignore 规则）滤掉不需要的目录
        if let Err(e) = watcher.watch(&path, RecursiveMode::Recursive) {
            log::warn!("[Watcher] watch error for {}: {}", path.display(), e);
            return;
        }

        log::info!(
            "[Watcher] Started watching project {} at {}",
            project_id,
            path.display()
        );

        // 4b. 创建 git 元数据 watcher -- 单独监听 .git（HEAD / index / worktrees），
        // 绕过 git 忽略过滤（该过滤会丢弃 .git 内事件，导致 checkout 后
        // git worker 无法感知分支变化，changes 列表残留旧分支数据）。
        let head_watcher = if git_repo {
            resolve_git_meta_paths(&path).and_then(|meta| {
                let scheduler_tx = scheduler.as_ref().map(|s| s.sender());
                let scheduler_tx_for_head = scheduler_tx.clone();
                let pid_index = project_id.clone();
                let pid_head = project_id.clone();
                let app_for_head = app_handle.clone();
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

        if let Ok(mut watchers) = self.watchers.lock() {
            watchers.insert(
                project_id,
                WatcherHandle {
                    _watcher: watcher,
                    _scheduler: scheduler,
                    _worker: worker,
                    _head_watcher: head_watcher,
                    _debounce: debounce,
                    _tree_debounce: tree_debounce,
                    _gitignore: gitignore_filter,
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
    }

    /// Stop all active file watchers.
    pub fn stop_all(&self) {
        log::info!("[Watcher] Stopping all watchers...");
        if let Ok(mut watchers) = self.watchers.lock() {
            for (_id, watcher) in watchers.drain() {
                watcher.stop_signal.store(true, Ordering::Relaxed);
            }
        }
        log::info!("[Watcher] All watchers stopped");
    }
}
