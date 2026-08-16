//! `WatcherManager` 编排：为每个项目启动文件监听，聚合各子模块。

use super::debounce::{
    DebounceSender, GitChangedDebounceSender, ThrottleScheduler, TreeChangeDebounceSender,
};
use super::git_meta::{create_git_meta_watcher, resolve_git_meta_paths, GitMetaWatcherHandle};
use super::gitignore::GitIgnoreFilter;
use super::types::{GIT_CHANGED_EVENT, GIT_STATUS_DIFF_EVENT};
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
    _scheduler: ThrottleScheduler,
    // worker clone 保持 alive，与 scheduler 回调中的 clone 共享同一个 worker 线程
    _worker: GitStatusWorker,
    // .git 元数据监听器（HEAD 分支切换 + index 暂存/取消暂存 + worktree HEAD），
    // 单独 watch .git 目录绕过 git 忽略过滤；句柄内持 Arc watcher 供心跳自愈补挂
    _head_watcher: Option<GitMetaWatcherHandle>,
    // file-changed debounce sender（drop 时关闭 channel，结束 debounce 线程）
    _debounce: DebounceSender,
    // file-tree-changed debounce sender（Create/Remove/Rename 事件触发）
    _tree_debounce: TreeChangeDebounceSender,
    // git-changed 全量 fallback 节流 sender（drop 时关闭 channel，结束节流线程）
    _git_changed_debounce: GitChangedDebounceSender,
    // git 语义忽略过滤器（持有编译后的 .gitignore 规则）
    _gitignore: GitIgnoreFilter,
    stop_signal: Arc<AtomicBool>,
    // 心跳线程：定期触发 git status 作为 notify 事件丢失时的兜底
    _heartbeat: std::thread::JoinHandle<()>,
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

        // 1. 创建 GitStatusWorker -- 有变化时发增量 diff 事件
        let pid_emit = project_id.clone();
        // git-changed 全量 fallback 走 500ms 滑动窗口节流：增量 diff 仍是即时主路径
        let git_changed_debounce =
            GitChangedDebounceSender::new(project_id.clone(), app_handle.clone());
        let git_changed_signal = git_changed_debounce.clone();
        let worker = GitStatusWorker::start(path.clone(), move |mut diff: GitStatusDiff| {
            diff.project_id = pid_emit.clone();
            // 增量 diff 事件（即时、轻量，前端直接 patch store）
            let _ = app_for_diff.emit(GIT_STATUS_DIFF_EVENT, &diff);
            // 全量刷新 fallback：经节流器合并，静默 500ms 后才 emit 一次
            git_changed_signal.signal();
        });

        // 2. 创建 ThrottleScheduler -- 合并 notify 事件，驱动 worker.check()
        // worker.clone() 给 scheduler 回调，原始 worker 存入 WatcherHandle 保持 alive
        let worker_clone = worker.clone();
        let scheduler = ThrottleScheduler::new(move || {
            worker_clone.check();
        });

        // 3. 创建 file-changed debounce sender
        let debounce = DebounceSender::new(project_id.clone(), path.clone(), app_handle.clone());

        // 3b. 创建 file-tree-changed debounce sender（专门处理 Create/Remove/Rename）
        let tree_debounce = TreeChangeDebounceSender::new(project_id.clone(), app_handle.clone());

        // 4. 创建 notify watcher -- 递归监听 + 路径过滤
        // 从 scheduler 克隆 Sender 传给 notify 闭包
        let scheduler_tx = scheduler.sender();
        let debounce_tx_for_notify = debounce.tx.clone();
        let tree_debounce_tx = tree_debounce.tx.clone();
        let pid_log = project_id.clone();
        // git 语义忽略过滤器：编译 .gitignore / .git/info/exclude 规则，
        // 与 git 自身行为一致（不再是硬编码目录名黑名单）
        let gitignore_filter = GitIgnoreFilter::new(path.clone());
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

                // .gitignore / .git/info/exclude 自身变更时重载规则
                // （用户编辑 .gitignore 后新规则立即生效）
                // 注意：此检查在下方路径过滤之前执行——`.git/info/exclude` 的
                // 变更事件虽然会被过滤出 relevant_paths，但仍需先触发 reload。
                let rules_changed = event.paths.iter().any(|p| {
                    let name = p.file_name().map(|n| n.to_string_lossy().to_string());
                    matches!(name.as_deref(), Some(".gitignore") | Some("exclude"))
                });
                if rules_changed {
                    gitignore_filter_for_notify.reload();
                }

                // 过滤：git 语义忽略（.gitignore 规则）+ .git/.DS_Store 平台硬过滤
                let relevant_paths: Vec<PathBuf> = event
                    .paths
                    .iter()
                    .filter(|p| !gitignore_filter_for_notify.should_ignore(p))
                    .cloned()
                    .collect();

                let relevant = !relevant_paths.is_empty();
                // 每个 FS 事件都会触发，高频；降为 trace 避免刷爆日志
                // （Debug 级别下 watcher 曾单次会话产生数十万行）
                log::trace!(
                    "[Watcher:{}] FS event {:?}, paths={:?}, relevant={}",
                    pid_log,
                    event.kind,
                    event.paths,
                    relevant
                );

                if relevant {
                    // 驱动 git worker
                    let _ = scheduler_tx.send(());
                    // 发送变更路径给 debounce sender（用于文件 tab 刷新）
                    for p in &relevant_paths {
                        let _ = debounce_tx_for_notify.send(p.clone());
                    }
                    // 文件树结构变更（新增/删除/重命名）时额外触发 tree-changed 防抖。
                    // notify 6.x 中 Rename 表现为 Modify(Name(_))，必须包含否则文件移动不会触发刷新。
                    let is_structure_change = matches!(
                        event.kind,
                        EventKind::Create(_)
                            | EventKind::Remove(_)
                            | EventKind::Modify(ModifyKind::Name(_))
                    );
                    if is_structure_change {
                        let _ = tree_debounce_tx.send(());
                    }
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
        // 监听范围：
        // - HEAD：分支切换（checkout 改写 HEAD）；
        // - index：暂存 / 取消暂存（git add / git rm --cached / git reset / git commit），
        //   这类操作只改 .git/index 不碰工作区文件，主 watcher 无法感知——若不监听，
        //   ignored_files（文件树 .gitignore 灰色显示）与 staged 状态会残留旧值；
        // - .git/worktrees：linked worktree 内 checkout 会改写
        //   `.git/worktrees/<name>/HEAD`，主仓库 .git/HEAD 不变，需一并捕获。
        // watcher 创建逻辑抽离为 create_git_meta_watcher（可脱离 AppHandle 集成测试）。
        let head_watcher = resolve_git_meta_paths(&path).and_then(|meta| {
            // 两个回调各自持有独立 sender（mpsc::Sender 可克隆）
            let scheduler_tx = scheduler.sender();
            let scheduler_tx_for_head = scheduler_tx.clone();
            let pid_index = project_id.clone();
            let pid_head = project_id.clone();
            let app_for_head = app_handle.clone();
            // index 变更走 debounce 全量刷新 fallback（覆盖 ignored_files），
            // 与 worker 增量路径去重，避免全量刷新风暴。
            let git_changed_signal_for_meta = git_changed_debounce.clone();
            create_git_meta_watcher(
                project_id.clone(),
                &meta,
                move || {
                    log::debug!(
                        "[Watcher:{}] git index changed, triggering git status",
                        pid_index
                    );
                    let _ = scheduler_tx.send(());
                    // index 变更（git add / rm --cached / reset / commit）：
                    // 增量 diff 不含 ignored_files，必须走全量刷新 fallback，
                    // 否则文件树 .gitignore 灰色显示 / staged 状态残留旧值。
                    git_changed_signal_for_meta.signal();
                },
                move |has_wt| {
                    log::debug!("[Watcher:{}] HEAD changed, triggering git status", pid_head);
                    let _ = scheduler_tx_for_head.send(());
                    // worktree 场景：HEAD 变更无法区分来源（主仓库 / worktree），
                    // 直接全量刷新兜底，避免 worktree 内切分支残留旧 changes。
                    if has_wt {
                        let _ = app_for_head.emit(GIT_CHANGED_EVENT, &pid_head);
                    }
                },
            )
        });

        // 停止信号（供心跳线程使用）
        let stop = Arc::new(AtomicBool::new(false));

        // 立即触发一次 git status 检查，获取初始状态
        worker.check();

        // 自愈补挂：worktrees 目录可能在会话中途出现（git worktree add），
        // 心跳线程定期复查并补挂递归监听（notify 回调内禁止再调 watch）。
        let head_watcher_for_rearm = head_watcher.clone();

        // 5. 启动心跳线程：每 30s 主动触发一次 git status 检查
        // 作为 notify 在 Windows 下可能丢失事件时的兜底机制
        let heartbeat_worker = worker.clone();
        let heartbeat_stop = stop.clone();
        let heartbeat_pid = project_id.clone();
        let heartbeat = std::thread::Builder::new()
            .name(format!("git-heartbeat-{}", project_id))
            .spawn(move || {
                // 10s 心跳节奏，两件事务分离：
                // - git-status 兜底保持 30s（每 3 个 tick 一次）——worker.check()
                //   每次跑真实 git status，是高频 git 调用，必须封顶频率；
                // - worktrees 自愈补挂走 10s 节奏——仅一次 is_dir 探测（微秒级），
                //   把「git worktree add → 自动刷新生效」的窗口从 30s 压到 ≤10s。
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
                        heartbeat_worker.check();
                    }
                    // worktrees 自愈补挂：会话中途 git worktree add 后补挂
                    // .git/worktrees 递归监听，修复 worktree 状态永不自动刷新
                    if let Some(meta_watcher) = &head_watcher_for_rearm {
                        meta_watcher.rearm_worktrees_if_needed();
                    }
                }
            })
            .expect("Failed to spawn heartbeat thread");

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
                    _git_changed_debounce: git_changed_debounce,
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
