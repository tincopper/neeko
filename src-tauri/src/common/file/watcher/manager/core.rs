//! `WatcherManager` 编排：为每个**仓库单元**挂载文件监听，计算 git status 快照。
//!
//! 身份维度（本次结构性变更的核心）：资源与快照的键是 [`RepoRef::key`]，不是 project_id。
//! 一个 project 在 git 语义下承载 `1 + N` 个仓库单元（主仓 + linked worktree，各自的
//! HEAD / index / workdir 全都独立），只以 project_id 为身份时，worktree 视图既没有权威
//! 生产者（列表不更新）、又与主仓共用一个槽（串 main 内容）。
//!
//! 生命周期（决策 D-B）：**只挂载当前视图所在的那个单元** —— 激活即挂、离开即释放，
//! 每项目常驻至多一套资源。代价是冷启动窗口与非激活单元不实时，由「未挂载 = 未知」
//! 的显式空态承担（见 `snapshot` 返回 `None` 的语义与前端 `statuses[key] === undefined`）。

use super::super::debounce::{DebounceSender, ThrottleScheduler, TreeChangeDebounceSender};
use super::super::git_meta::create_git_meta_watcher;
use super::super::gitignore::GitIgnoreFilter;
use super::super::registration::{spawn_maintenance_thread, WatchRegistration};
use super::super::sink::{WatcherEvent, WatcherEventSink};
use super::super::types::{GitChangedEvent, GitPerfSuggestionEvent};
use super::callbacks::build_notify_callback;
use super::handle::WatcherHandle;
use crate::common::git::local::is_git_repo;
use crate::common::git::status_worker::{GitStatusSnapshot, GitStatusWorker};
use crate::common::git::RepoRef;
use notify::{Config, RecommendedWatcher, Watcher};
#[cfg(test)]
use std::sync::atomic::AtomicUsize;
use std::sync::mpsc;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

/// Manages file-system watchers per repository unit (main repo or one linked worktree).
///
/// Each mounted unit gets a dedicated watcher thread that monitors file changes,
/// computes authoritative git status snapshots, and emits them to the frontend.
#[derive(Clone)]
pub struct WatcherManager {
    /// Map of `RepoRef::key()` to active watcher handles.
    watchers: Arc<Mutex<HashMap<String, WatcherHandle>>>,
    /// G2 单一权威化：每单元最新 versioned 快照（push 生产者 = worker 写入；
    /// pull 生产者 = [`Self::record_computed`] 写入。同一张表、同一套 version 语义）。
    snapshots: Arc<Mutex<HashMap<String, Arc<GitStatusSnapshot>>>>,
    /// 每单元**已用到的最高 version**（号段水位）。与 `snapshots` 分开存，因为两者的
    /// 生命周期不同：快照随挂载释放作废（I1-b 要求「未挂载 = 无权威数据」），号段必须
    /// 活得更久 —— 从 1 重新起号会让「切走再切回」的第一份新快照被前端闸门
    /// （`version <= prev`）静默丢弃，界面继续显示离开时的旧数据（2026-09-29 真 app
    /// 手测日志：13 次推送全是 v1）。仅在**项目本身被移除**时回收（[`Self::unwatch_project`]），
    /// 规模因此以「项目 × 该项目的单元数」为界。
    version_floors: Arc<Mutex<HashMap<String, u64>>>,
    /// 挂载临界区（D-B 不变量）：`release_except` 与 `watch` 必须成对原子发生，
    /// 否则并发 `activate` 能交错出两套挂载（见 [`Self::mount_only`] 的说明）。
    mount_lock: Arc<Mutex<()>>,
    /// 已创建的 watcher 套数（幂等契约观测口，见 `lifecycle_tests.rs`）：
    /// 「重复 watch 只建一套」用创建计数断言，不用事件批次计数 —— 单次写入的
    /// 多个 FS 事件在负载下可跨 debounce 窗口分多批投递（合法生产行为），
    /// 批次 == 1 的断言在高负载 CI 上会误报。
    #[cfg(test)]
    watcher_set_creations: Arc<AtomicUsize>,
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
            version_floors: Arc::new(Mutex::new(HashMap::new())),
            mount_lock: Arc::new(Mutex::new(())),
            #[cfg(test)]
            watcher_set_creations: Arc::new(AtomicUsize::default()),
        }
    }

    /// 已创建的 watcher 套数（`#[cfg(test)]` 观测口：直接测量「重复 watch 是否被
    /// 入口护栏拦截」—— map 尺寸测不出来，因为重复 insert 会覆盖旧 handle）。
    #[cfg(test)]
    pub(crate) fn watcher_set_creations(&self) -> usize {
        self.watcher_set_creations.load(Ordering::Relaxed)
    }

    /// 该单元的 git 语义忽略过滤器（S5：读目录层复用做读前剪枝 + ignored 标记；
    /// 非 git 单元 / 尚未挂载时为 None —— 读层退化为仅 .git 硬过滤）。
    #[must_use]
    pub fn gitignore_for(&self, repo: &RepoRef) -> Option<Arc<GitIgnoreFilter>> {
        self.watchers
            .lock()
            .ok()?
            .get(&repo.key())?
            ._gitignore
            .clone()
    }

    /// 请求一次 git status 重算并**有界等待其落地**（返回时快照已反映本调用前
    /// 的全部写入）。
    ///
    /// **为什么必须有这个入口**：`snapshot()` 是状态读接口的唯一数据源，而 worker 只在
    /// 「被信号触发」时重算。任何不走 watcher 的写操作（discard / stage / commit 由 IPC
    /// 直接跑 git 命令改工作区）都不会自动 reflex 到 worker —— 快照于是停留在写前的状态，
    /// 读接口把它当成权威数据返回给前端，覆盖掉我们刚刚拿到的真实结果。
    /// 这正是「操作成功但列表要手动刷新才更新」的根因。
    ///
    /// **单元维度**：旧实现按 project_id 取 worker，于是在 worktree 里做完写操作，
    /// 戳的却是主仓的 worker —— 主仓 status 没变 → 闸门吞掉 → 什么也不会更新。
    ///
    /// 契约：调用方必须在 **git 写操作成功之后** 调用（worker 重算必须晚于写入）。
    ///
    /// **阻塞方法**：Condvar 等待原语 —— async 上下文必须经 `run_blocking` /
    /// `spawn_blocking` 调用（见 `git/commands/index.rs` 的 `wait_status_fresh`）。
    ///
    /// **等待而非仅投递信号的原因**：信号是异步的，写操作返回后前端立即刷新读到的
    /// 仍是写前快照（首刷旧值窗口）；等待重算落地后，读接口天然拿到写后数据
    /// （超时场景由快照事件推送最终收敛）。
    /// 非 git 单元 / 尚未挂载 / 超时 → `false`。
    #[must_use]
    pub fn poke_status_worker_and_wait(&self, repo: &RepoRef, timeout: Duration) -> bool {
        let Some(handle) = self
            .watchers
            .lock()
            .ok()
            .and_then(|m| m.get(&repo.key()).and_then(|h| h.worker.as_ref().cloned()))
        else {
            return false;
        };
        handle.check_and_wait(timeout)
    }

    /// 最新权威 status 快照（G2 D2 读接口数据源）。
    /// `None` = 该单元当前没有权威生产者（未挂载 / 非 git 单元 / 启动初期首快照未到）。
    ///
    /// **调用方不得把 `None` 当作「无变更」** —— 那是「未知」，渲染成空列表等于伪造事实。
    #[must_use]
    pub fn snapshot(&self, repo: &RepoRef) -> Option<Arc<GitStatusSnapshot>> {
        self.snapshots.lock().ok()?.get(&repo.key()).cloned()
    }

    /// 登记一次 **pull 生产者**算出的快照（WSL / SSH 等无法挂载 watcher 的单元）。
    ///
    /// 与 worker 产出的是同一种东西、进同一张表、共用同一套 version 单调语义 —— 读接口
    /// 因此只有一种形态（旧现实：worktree / 远程返回 `version: 0`，前端只能「恒放行」，
    /// 于是任何一次 pull 都能覆盖任何时刻的 push 快照）。
    /// 生产者的差别（push vs pull）只影响**新鲜度**，不再影响**寻址与竞态**。
    ///
    /// **例外：挂载中且 worker 已产出过快照 ⇒ 本次 pull 必然更旧**（pull 期间 worker 随时
    /// 可能推送更新的数据），此时回读槽位、不写入。该裁决在 [`store_snapshot`] 的**同一
    /// 临界区内**完成 —— 守卫若留在锁外就是 check-then-act：pull 的 git 子进程耗时以百毫秒
    /// 计，worker 完全可能在守卫通过后、写入前推完一整轮，晚到的 pull 拿着注册表盖的更大
    /// 号覆盖更新的 push（前端 version 闸门对这份旧数据只能放行）。
    /// 挂载中但尚无快照（冷启动窗口）仍然登记：那正是 pull 存在的意义，且 worker 首个推送
    /// 会拿到更大的号自然接管。
    #[must_use]
    pub fn record_computed(
        &self,
        repo: &RepoRef,
        entries: Vec<crate::project::types::FileChange>,
        branch: String,
    ) -> Arc<GitStatusSnapshot> {
        const MAX_STATUS_ENTRIES: usize = 1000;
        let truncated = entries.len() > MAX_STATUS_ENTRIES;
        let mut entries = entries;
        entries.truncate(MAX_STATUS_ENTRIES);
        let mut snapshot = GitStatusSnapshot::for_unit(repo, 0);
        snapshot.entries = entries;
        snapshot.branch = branch;
        snapshot.truncated = truncated;
        store_snapshot(
            &self.snapshots,
            &self.version_floors,
            &self.watchers,
            SnapshotSource::Pull,
            snapshot,
        )
    }

    /// Start watching one repository unit for file changes and maintain its snapshot.
    pub fn watch(&self, repo: RepoRef, sink: Arc<dyn WatcherEventSink>) {
        let unit = repo.key();
        let path = repo.work_dir_pathbuf();
        // 入口不变量：同一单元只允许一套 watcher。重复注册会**翻倍投递事件**并再泄漏
        // 一套后台线程（实测：同项目被 watch 4 次 → 单次变更 emit 3 次）。
        // 「配置变更」不需要重建 watcher —— 它走 `WatchMaintenance::ReloadAll`。
        if let Ok(watchers) = self.watchers.lock() {
            if watchers.contains_key(&unit) {
                log::warn!(
                    "[Watcher] unit {} is already watched at {}, ignoring duplicate watch",
                    unit,
                    path.display()
                );
                return;
            }
        }

        let sink_for_diff = Arc::clone(&sink);

        // 该单元先前若存在快照（切走过），必须先作废**再**发起首轮重算：未挂载期间没有任何
        // 生产者，残留快照会被当成权威数据渲染（= 本次要根治的症状形态）。
        // 顺序不能颠倒 —— worker 在下面的 `check()` 里就可能在**本函数返回前**插入新快照，
        // 那句 drop 若留在尾部会把刚产出的首个快照一起删掉（表现为「已挂载却读不到权威数据」）。
        drop_snapshot_if_present(&self.snapshots, &unit);

        // 非 git 单元：跳过所有 git 相关资源（worker / scheduler / heartbeat / git meta watcher），
        // 仅保留文件监听 + 文件树变更事件。避免对非 git 目录启动 git status worker 执行 git rev-parse 等命令。
        let git_repo = is_git_repo(&path);

        // 1. 创建 GitStatusWorker —— status 的 push 生产者（D1）。
        // 每次实质变化产出**完整 versioned 快照**：写共享注册表（invoke 读接口
        // 的数据源，D2 收编）+ 发 v2 事件整体通知（D3）。
        let (worker, scheduler) = if git_repo {
            let snapshots_store = self.snapshots.clone();
            let floors_store = self.version_floors.clone();
            let watchers_store = self.watchers.clone();
            let unit_for_cb = unit.clone();
            let worker = GitStatusWorker::start(repo.clone(), move |snapshot| {
                // 写共享快照：读接口与事件同源同版本（key 由快照自带，不再二次赋值）
                debug_assert_eq!(snapshot.repo_key, unit_for_cb);
                // version 由注册表盖章后**再**推送：事件里的 version 必须与槽位里的一致，
                // 否则前端的乱序闸门会拿两套序号互比（见 `store_snapshot`）。
                let stamped = store_snapshot(
                    &snapshots_store,
                    &floors_store,
                    &watchers_store,
                    SnapshotSource::Push,
                    snapshot,
                );
                sink_for_diff.emit(WatcherEvent::StatusSnapshot(&stamped));
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
                "[Watcher] Skipping git status worker for non-git unit {} at {}",
                unit,
                path.display()
            );
            (None, None)
        };

        // 3. 创建 file-changed debounce sender
        let debounce = DebounceSender::new(repo.clone(), Arc::clone(&sink));

        // 3b. 创建 file-tree-changed debounce sender（专门处理 Create/Remove/Rename，
        // S2-1：收集变更路径的父目录集合，前端只重载命中桶）
        let tree_debounce = TreeChangeDebounceSender::new(repo.clone(), Arc::clone(&sink));

        // 4. 创建 notify watcher -- 递归监听 + 路径过滤
        // 从 scheduler 克隆 Sender 传给 notify 闭包（非 git 单元时为 None）
        let scheduler_tx = scheduler.as_ref().map(|s| s.sender());
        let debounce_tx_for_notify = debounce.tx.clone();
        let tree_debounce_tx = tree_debounce.tx.clone();
        let sink_for_watcher_error = Arc::clone(&sink);
        // git 语义忽略过滤器：编译该单元工作树的 .gitignore / .git/info/exclude 规则，
        // 与 git 自身行为一致（不再是硬编码目录名黑名单）。
        // 非 git 单元时为 None，不做 gitignore 过滤。
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
                repo.clone(),
                sink_for_watcher_error,
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
        let watcher = Arc::new(std::sync::Mutex::new(watcher));

        // S2 注册：初始 watch + 结构维护通道（ignored 子树在注册层排除）
        let registration = Arc::new(std::sync::Mutex::new(WatchRegistration::default()));
        {
            let mut w = match watcher.lock() {
                Ok(watcher) => watcher,
                Err(e) => {
                    log::warn!(
                        "[Watcher:{}] watcher mutex poisoned during registration: {}",
                        unit,
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
                        unit,
                        e
                    );
                    return;
                }
            };
            // MutexGuard 不实现 Watcher：显式解引用到内层 &mut RecommendedWatcher
            reg.register_root(&mut *w, &path, gitignore_for_handle.as_deref());
        }
        spawn_maintenance_thread(
            // 只给 Weak：强所有者是下面的 WatcherHandle（见 maintenance.rs 的生命周期契约）
            Arc::downgrade(&watcher),
            path.clone(),
            gitignore_for_handle.clone(),
            Arc::clone(&registration),
            maintenance_rx,
        );

        log::info!(
            "[Watcher] Started watching unit {} at {}",
            unit,
            path.display()
        );

        // 4b. 创建 git 元数据 watcher -- 单独监听**该单元自己的** git 目录（HEAD / index），
        // 绕过 git 忽略过滤（该过滤会丢弃 .git 内事件，导致 checkout 后 worker 无法感知
        // 分支变化、changes 列表残留旧分支数据）。
        //
        // 身份补全后不再需要「跨目录补挂别的单元」：linked worktree 的 HEAD/index 位于其
        // 私有 gitdir（`<common>/.git/worktrees/<name>/`），由**该单元自己的**这条 watcher
        // 监听（`resolve_git_meta_paths` 会读 `.git` 指针文件定位）。旧实现里那套
        // `resolve_worktree_roots` + `rearm_worktrees_if_needed` 的机制，存在的唯一前提就是
        // 「worktree 没有自己的资源」—— 前提消失，机制退役。
        let head_watcher = if git_repo {
            crate::common::file::watcher::git_meta::resolve_git_meta_paths(&path).and_then(|meta| {
                let scheduler_tx = scheduler.as_ref().map(|s| s.sender());
                let unit_index = unit.clone();
                let unit_head = unit.clone();
                let git_changed = GitChangedEvent::new(&repo);
                let sink_for_head = Arc::clone(&sink);
                let scheduler_tx_for_head = scheduler_tx.clone();
                create_git_meta_watcher(
                    unit.clone(),
                    &meta,
                    move || {
                        // 公理1（信号≠事实）：index 写入只作为查询调度提示，
                        // 交由 worker 查询-比较后决定是否通知 —— 不再无条件触发
                        // 全量刷新。此前无条件 `signal()` 会与 git 命令写 index
                        // 形成自反馈回路（git-changed → 前端刷新命令写 index →
                        // index 事件 → 再 git-changed）。
                        log::debug!(
                            "[Watcher:{}] git index changed, hinting git status check",
                            unit_index
                        );
                        if let Some(tx) = &scheduler_tx {
                            let _ = tx.send(());
                        }
                    },
                    move || {
                        log::debug!(
                            "[Watcher:{}] HEAD changed, triggering git status",
                            unit_head
                        );
                        if let Some(tx) = &scheduler_tx_for_head {
                            let _ = tx.send(());
                        }
                        sink_for_head.emit(WatcherEvent::GitChanged(&git_changed));
                    },
                )
            })
        } else {
            None
        };

        // 停止信号（供心跳线程使用）
        let stop = Arc::new(AtomicBool::new(false));

        // 5. 启动心跳线程：周期性主动触发一次 git status 检查
        // 作为 notify 在 Windows 下可能丢失事件时的兜底机制。
        // 非 git 单元跳过心跳线程（无 worker 可驱动）。
        let heartbeat = if git_repo {
            let heartbeat_worker = worker.clone();
            let heartbeat_stop = stop.clone();
            let heartbeat_unit = repo.thread_tag();
            Some(
                std::thread::Builder::new()
                    .name(format!("git-heartbeat-{heartbeat_unit}"))
                    .spawn(move || {
                        let mut tick: u32 = 0;
                        loop {
                            std::thread::sleep(Duration::from_secs(10));
                            if heartbeat_stop.load(Ordering::Relaxed) {
                                log::debug!("[Watcher] Heartbeat stopping for {}", heartbeat_unit);
                                break;
                            }
                            tick = (tick + 1) % 3;
                            if tick == 0 {
                                log::debug!("[Watcher] Heartbeat check for {}", heartbeat_unit);
                                if let Some(ref w) = heartbeat_worker {
                                    w.check();
                                }
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
        // 只提示不代改用户仓库配置）。仅 git 单元：与 worker/heartbeat 同款门控。
        if git_repo {
            let sink_for_perf = Arc::clone(&sink);
            let perf_unit = unit.clone();
            let perf_project_id = repo.project_id().to_string();
            let perf_root = path.clone();
            let perf_tag = repo.thread_tag();
            let _ = std::thread::Builder::new()
                .name(format!("git-perf-{perf_tag}"))
                .spawn(move || {
                    let suggestions = crate::common::git::perf::detect_perf_suggestions(&perf_root);
                    if suggestions.is_empty() {
                        return;
                    }
                    log::info!(
                        "[Watcher:{}] {} git perf suggestions",
                        perf_unit,
                        suggestions.len()
                    );
                    sink_for_perf.emit(WatcherEvent::PerfSuggestion(&GitPerfSuggestionEvent {
                        repo_key: perf_unit,
                        project_id: perf_project_id,
                        suggestions,
                    }));
                });
        }

        if let Ok(mut watchers) = self.watchers.lock() {
            watchers.insert(
                unit,
                WatcherHandle {
                    _watcher: watcher,
                    _registration: registration,
                    _maintenance_tx: Some(maintenance_tx),
                    _scheduler: scheduler,
                    worker,
                    _head_watcher: head_watcher,
                    _debounce: debounce,
                    _tree_debounce: tree_debounce,
                    _gitignore: gitignore_for_handle,
                    stop_signal: stop,
                    _heartbeat: heartbeat,
                },
            );
            // 套数计数在 insert 成功处自增（一套完整资源真正落地）
            #[cfg(test)]
            self.watcher_set_creations.fetch_add(1, Ordering::Relaxed);
        }
    }

    /// 释放某单元的全部资源（watcher 句柄 drop → debounce channel 关闭、停止信号置位），
    /// 并作废其快照 —— 未挂载期间没有生产者，残留快照会被当成权威数据渲染。
    pub fn unwatch(&self, repo: &RepoRef) {
        self.release_one(&repo.key());
        crate::common::file::services::invalidate_remote_ignored_cache(repo.project_id());
    }

    /// 项目被移除 / 路径变更时，释放该项目下**所有**单元的挂载，并回收其 version 号段。
    ///
    /// 号段只在「项目本身不存在了」时回收：单元的号段必须比它的快照活得久（见
    /// [`Self::version_floors`]），否则「切走再切回」的第一份快照会被前端闸门判成旧的丢掉。
    /// 规模因此以项目为单位有界 —— 一个项目的号段条目数 = 该项目挂载过的单元数（主仓 1 +
    /// 每个 linked worktree 至多 1），项目移除即清零。
    pub fn unwatch_project(&self, project_id: &str) {
        let units: Vec<String> = self
            .watchers
            .lock()
            .map(|m| {
                m.keys()
                    .filter(|k| RepoRef::parse_key(k).is_some_and(|(pid, _)| pid == project_id))
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        for unit in units {
            self.release_one(&unit);
        }
        if let Ok(mut floors) = self.version_floors.lock() {
            floors.retain(|k, _| !RepoRef::parse_key(k).is_some_and(|(pid, _)| pid == project_id));
        }
        crate::common::file::services::invalidate_remote_ignored_cache(project_id);
    }

    /// 释放除 `keep` 之外的**所有**单元挂载，返回被释放的 key。
    ///
    /// 决策 D-B 的字面语义是「只挂当前视图所在的那一个单元」，所以收口范围是全局而不是
    /// 同项目 —— 实测理由：后端在 `app.rs` / `set_active_project` 里也曾按项目挂主仓单元，
    /// 切项目时旧项目的挂载无人回收（2026-09-28 隔离实例日志：同一主仓单元被挂两次并报
    /// `already watched`，随后才由 worktree 单元接管）。挂载唯一入口是 `activate()`，
    /// 回收也必须在这里单点完成，否则「谁在看」又会散落到各处。
    ///
    /// **与 [`Self::mount_only`] 的关系**：本方法是「只释放」；需要「释放 + 挂载」成对发生
    /// （即 D-B 的不变量）时必须走 `mount_only` —— 两步之间没有共同临界区就有 TOCTOU 窗口。
    #[must_use = "返回被释放的单元 key；忽略它等于丢掉一次可观测的生命周期事件"]
    pub fn release_except(&self, keep: &str) -> Vec<String> {
        let _mount_guard = self.mount_lock.lock().unwrap_or_else(|e| e.into_inner());
        self.release_except_inner(keep)
    }

    /// 挂载 `repo` 并在**同一临界区内**释放其它单元 —— D-B（全局至多一套挂载）的执行点。
    ///
    /// 为什么必须原子：`release_except` 与 `watch` 各自只持有片刻锁，两者之间没有共同临界区
    /// 时，两个并发的 `activate`（快速切换项目 / 连点）可以交错成
    /// `c1.release → c2.release → c1.watch → c2.watch` ⇒ **两个单元同时挂载**：
    /// 线程与句柄白占、同一变更推两份快照（AC11「恰好 1 条」被破）。同一单元的并发挂载
    /// 也会穿过 `watch()` 内部的 check-then-insert，建出两套监听。
    /// 不变量属于资源所有者，不靠调用方记得「先释放再挂载」的顺序来维持。
    #[must_use = "返回被释放的单元 key；忽略它等于丢掉一次可观测的生命周期事件"]
    pub fn mount_only(&self, repo: RepoRef, sink: Arc<dyn WatcherEventSink>) -> Vec<String> {
        let _mount_guard = self.mount_lock.lock().unwrap_or_else(|e| e.into_inner());
        let released = self.release_except_inner(&repo.key());
        self.watch(repo, sink);
        released
    }

    /// [`Self::release_except`] 的无锁内核（调用方必须已持有 `mount_lock`）。
    fn release_except_inner(&self, keep: &str) -> Vec<String> {
        let stale: Vec<String> = self
            .watchers
            .lock()
            .map(|m| m.keys().filter(|k| k.as_str() != keep).cloned().collect())
            .unwrap_or_default();
        for unit in &stale {
            self.release_one(unit);
        }
        stale
    }

    /// 摘掉一个单元的挂载并作废其快照（`unwatch` / `unwatch_project` / `release_except` 的公共内核）。
    ///
    /// **只作废数据，不作废号段**（`version_floors` 保留）：释放的语义是「该单元当前没有权威
    /// 数据」，不是「该单元从未被看过」。
    fn release_one(&self, unit: &str) {
        if let Ok(mut watchers) = self.watchers.lock() {
            if let Some(handle) = watchers.remove(unit) {
                handle.stop_signal.store(true, Ordering::Relaxed);
                log::debug!("[Watcher] released unit {unit}");
            }
        }
        drop_snapshot_if_present(&self.snapshots, unit);
    }

    /// 该单元是否已挂载资源（区分「冷启动中」与「压根没挂 → 走 pull」两种 None）。
    #[must_use]
    pub fn is_watched(&self, repo: &RepoRef) -> bool {
        self.watchers
            .lock()
            .is_ok_and(|m| m.contains_key(&repo.key()))
    }

    /// 当前挂载中的单元 key 集合（测试观测口 + `set_active_repo_unit` 的释放依据）。
    #[must_use]
    pub fn watched_units(&self) -> Vec<String> {
        self.watchers
            .lock()
            .map(|m| m.keys().cloned().collect())
            .unwrap_or_default()
    }

    /// Stop all active file watchers.
    pub fn stop_all(&self) {
        log::info!("[Watcher] Stopping all watchers...");
        let stopped: Vec<(String, String)> = if let Ok(mut watchers) = self.watchers.lock() {
            let units: Vec<(String, String)> = watchers
                .keys()
                .filter_map(|k| RepoRef::parse_key(k).map(|(pid, _)| (k.clone(), pid.to_string())))
                .collect();
            for (_unit, watcher) in watchers.drain() {
                watcher.stop_signal.store(true, Ordering::Relaxed);
            }
            units
        } else {
            Vec::new()
        };
        for (_unit, project_id) in stopped {
            crate::common::file::services::invalidate_remote_ignored_cache(&project_id);
        }
        log::info!("[Watcher] All watchers stopped");
    }
}

/// 作废一个单元的快照条目。
fn drop_snapshot_if_present(
    store: &Arc<Mutex<HashMap<String, Arc<GitStatusSnapshot>>>>,
    unit: &str,
) {
    if let Ok(mut map) = store.lock() {
        map.remove(unit);
    }
}

/// 快照的生产者形态：决定 push / pull 共用槽位时的裁决规则（见 [`store_snapshot`]）。
enum SnapshotSource {
    /// 挂载中单元的 worker 线程（该槽位的权威数据所有者）。
    Push,
    /// 未挂载单元的现算（[`WatcherManager::record_computed`]）。
    Pull,
}

/// 登记一轮生产者产出，并由**注册表**统一给 `version` 盖章（= 该单元号段水位 + 1）。
///
/// 号段取自 `version_floors` 而非槽位里那份快照：槽位数据会随挂载释放作废，号段不能跟着退。
/// 若只看槽位，「切走 → 释放 → 切回」后第一份快照永远从 1 起号，而前端槽位里可能还留着
/// 切走前的 3，`version <= prev` 会把这份**更新**的数据判成旧的丢掉（2026-09-29 真 app 手测
/// 日志里 13 次推送全是 v1 即此形态）。
///
/// 为什么版本号不能由生产者自带：同一个槽位有两种生产者（push = 挂载中的 worker 线程，
/// pull = 未挂载单元的现算）。worker 的计数器活在线程里、从 1 起算，pull 的计数器活在
/// 注册表里 —— 两套序号交错必然出现平手或回退，而前端按 version 做单元内乱序闸门
/// （`version <= prev` 直接丢弃）。被丢弃的那一次正是「数据已经新了、界面还留着旧的」。
///
/// 因此：**寻址与竞态只看注册表**，生产者的差别只影响新鲜度。`snapshot.version` 在此被覆盖，
/// 生产者传什么都不作数（保留字段只为让 worker 自身的迭代测试可断言）。
///
/// **原子性契约**（锁纪律，改动前必读）：
/// - 守卫（pull 不得覆盖 push）、取号（`version_floors`）、插入（`store`）必须在**同一次
///   `store` 持锁**内完成。分成多次持锁时，并发生产者能交错出「取小号却后插入」——槽位
///   回退到旧数据而号段已前进，前端无从察觉；pull 的锁外守卫则是 check-then-act，慢 pull
///   能带着更大的号覆盖 worker 刚推的新数据（R2.4 要防的正是这个）。
/// - 嵌套锁序固定为 `store → watchers`、`store → floors`。全仓不存在反向嵌套
///   （`release_one` / `watch` / `poke_status_worker_and_wait` 对 watchers 与 store 都是
///   先释放再取的另一把，`mount_lock` 只在最外层），因此无死锁环。新增代码不得引入
///   `watchers → store` 或 `floors → store` 的持锁嵌套。
/// - Push **不做**「仍在挂载中」守卫：`watch()` 在把 handle 插进 watchers 之前就已启动
///   worker（冷启动首个快照可能先于插入到达），按挂载状态拒写会静默丢掉它且 worker 的
///   变化闸门不会补发。释放后在飞 emit 复活槽位的窗口由读路径自愈（未挂载 ⇒ 读必现算并
///   覆盖）与重挂载的 `drop_snapshot_if_present` 兜底。
///
/// **锁中毒不中止**：三把锁一律按本文件既有策略恢复（`release_except` / `mount_only`
/// 同样是 `unwrap_or_else(PoisonError::into_inner)`）。快照登记是「读接口的数据源」，
/// 一次中毒（任一持锁线程 panic）若让登记失败，轻则读命令拿不到数据、重则把整条命令
/// 升级成进程 abort —— 本应用的底线是不闪退，登记失败必须退化成可用状态。
fn store_snapshot(
    store: &Arc<Mutex<HashMap<String, Arc<GitStatusSnapshot>>>>,
    floors: &Arc<Mutex<HashMap<String, u64>>>,
    watchers: &Arc<Mutex<HashMap<String, WatcherHandle>>>,
    source: SnapshotSource,
    mut snapshot: GitStatusSnapshot,
) -> Arc<GitStatusSnapshot> {
    let key = snapshot.repo_key.clone();
    let mut store = store
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    // R2.4 裁决（pull 不得覆盖挂载中单元的 push 数据）——与写入同一临界区，见上方原子性契约。
    if let SnapshotSource::Pull = source {
        let watched = watchers
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .contains_key(&key);
        if watched {
            if let Some(authoritative) = store.get(&key) {
                return authoritative.clone();
            }
        }
    }
    // 槽位当前 version 只作下界校验用（持锁不变量下它必然 ≤ 水位）
    let in_slot = store.get(&key).map_or(0, |s| s.version);
    // 号段推进与取号在同一次持锁里完成：并发盖章既不会撞号，也不会「小号后插入」
    let next = {
        let mut floors = floors
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let next = floors.get(&key).copied().unwrap_or(0).max(in_slot) + 1;
        floors.insert(key.clone(), next);
        next
    };
    snapshot.version = next;
    let arc = Arc::new(snapshot);
    store.insert(key, arc.clone());
    arc
}
