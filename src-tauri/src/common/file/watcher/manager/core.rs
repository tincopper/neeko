//! `WatcherManager` 编排：为每个**Workspace**挂载文件监听，计算 git status 快照。
//!
//! 身份维度（本次结构性变更的核心）：资源与快照的键是 [`WorkspaceRef::key`]，不是 project_id。
//! 一个 project 在 git 语义下承载 `1 + N` 个Workspace（主仓 + linked worktree，各自的
//! HEAD / index / workdir 全都独立），只以 project_id 为身份时，worktree 视图既没有权威
//! 生产者（列表不更新）、又与主仓共用一个槽（串 main 内容）。
//!
//! **C1 起：资源生命周期不再决定数据可见性。** 登记表（[`super::store::StatusStore`]）
//! 保存每单元的快照 + `computed_at` + `dirty`，读路径只问登记表（脏/陈旧/缺失 ⇒ 重算，
//! 否则返回），**不问是否挂载** —— 「未挂载」不再是「无权威数据」的同义词。
//! 挂载语义因此退化为「谁有 push 生产者」，它只影响新鲜度的延迟，不影响可观测性。
//!
//! **C2 起：可见集合里的每个单元都可以同时挂载**（用户决策 D-B 已反转 —— 见
//! `git-domain.md §12` 的反转记录）。挂载一个单元**不释放**任何其它单元，因此「A/B 互踢」
//! 在结构上不可能：没有互斥槽位可抢。稀缺性只允许落在**调度顺序**上（先算谁、算多勤，
//! C3 的调度器），不得落在「能不能被观测」上（红线 16）。
//!
//! **C4 起：释放由「可见集合」声明，而不是由「挂了别人」触发**。
//! [`WatcherManager::reconcile_mounted`] 在一次临界区内完成「挂载声明集合 + 释放声明外的
//! 已挂载单元」，这是「会话内访问过的每个单元永久占一套 watcher」那个无界缺口的收口点；
//! 它仍不是互斥 —— 声明式真值的差集与挂载同批发生，不是「挂一个就踢一个」的竞争。
//! 另有一条释放路径是**单元消失**（[`WatcherManager::unwatch`] /
//! [`WatcherManager::unwatch_project`]）。两条路径都保留登记表数据（C1）。

use super::super::debounce::{DebounceSender, ThrottleScheduler, TreeChangeDebounceSender};
#[cfg(test)]
use super::super::git_meta::dispatch_git_meta_event;
use super::super::gitignore::GitIgnoreFilter;
use super::super::manifest::WatchManifest;
use super::super::registration::{spawn_maintenance_thread, WatchRegistration, MAX_WATCH_DIRS};
use super::super::sink::{WatcherEvent, WatcherEventSink};
use super::super::types::GitPerfSuggestionEvent;
use super::callbacks::build_notify_callback;
#[cfg(test)]
use super::callbacks::GitMetaCallbacks;
use super::handle::WatcherHandle;
use super::store::{DirtyMask, StatusStore};
use crate::common::git::local::is_git_repo;
use crate::common::git::status_worker::{GitStatusSnapshot, GitStatusWorker, RecomputeGate};
use crate::common::git::WorkspaceRef;
#[cfg(test)]
use crate::platform::watch_backend::PlatformWatcher;
use crate::platform::watch_backend::{
    build_exclusion_paths, create_file_watcher, watch_backend, WatchBackend,
};
use notify::Config;
#[cfg(test)]
use std::sync::atomic::AtomicUsize;
use std::sync::mpsc;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

/// 测试模式下的回调投喂口类型（`no_real_fs` 用）。
///
/// 与 `build_notify_callback` 的返回同形 —— 测试拿到它就能主动投喂合成
/// `notify::Event`，从而验证「事件到达后如何处理」，**不必建真实 FSEvents 流**。
/// 生产代码从不读它（`#[cfg(test)]` 门控）。
#[cfg(test)]
pub type TestEventSink = Box<dyn FnMut(Result<notify::Event, notify::Error>) + Send>;

/// `without_real_fs()` 模式下替代「真实 OS 流」的**合成扇出器**。
///
/// # 为什么必须是扇出而不是单条回调
///
/// 生产结构里 git 元数据有**两条互斥的传输路径**：
/// - 合并（macOS 递归后端）→ 事件进主回调，在 `build_notify_callback` 里被分类；
/// - 独立流（Linux 逐目录注册 / Windows 整树过滤）→ 事件进 `git_meta` 自己的回调。
///
/// 哪条生效由 `git_meta_merge::decide`（平台能力位）决定，**在测试里不可选**。
/// 早先的测试模式只交出主回调，非 macOS 上便两条路径皆无 —— 合并没发生
/// （`merge == false`），独立流又被跳过，`.git/refs/**` 事件落进 `is_hard_noise_path`
/// 被丢弃，而用例仍以为在验证生产链路（本地 macOS 绿、Linux/Windows 红）。
///
/// 现在按「事件路径该归谁」扇出：落在本单元 git 元数据范围内的归 git-meta 出口，
/// 其余归主回调。测试因此不必知道平台走了哪条 —— 它拨的就是该平台的真实扇出点。
#[cfg(test)]
pub struct TestWatchStream {
    /// 主 watcher 回调（内容 / 结构事件；合并路径下也携带 git-meta 分类）。
    pub(super) main: TestEventSink,
    /// 独立流路径的 git 元数据回调。`None` = 本次挂载走的是合并路径。
    pub(super) git_meta: Option<GitMetaCallbacks>,
}

#[cfg(test)]
impl TestWatchStream {
    /// 投喂一条内核事件 —— 与内核**无关**，只验证「事件到达后如何处理」。
    ///
    /// 两条判据都复用生产的单一事实源，不重写：
    /// - 路由/前缀：`GitMetaPaths::touches`；
    /// - 分类与三出口：`dispatch_git_meta_event`（spec 登记的**唯一分发实现**）。
    pub(super) fn feed(&mut self, result: Result<notify::Event, notify::Error>) {
        let event = match result {
            Ok(event) => event,
            // 错误事件只能来自内核；合成模式不产生，语义上属于主流错误出口
            // （与生产中独立流只认路径、不消费 error 的形态一致）。
            Err(e) => return (self.main)(Err(e)),
        };
        if let Some(ctx) = self.git_meta.as_mut() {
            if ctx.paths.touches(&event.paths) {
                dispatch_git_meta_event(
                    &event.paths,
                    &ctx.paths,
                    &mut ctx.on_index_changed,
                    &mut ctx.on_head_changed,
                    &mut ctx.on_refs_changed,
                );
                // 独立流不订阅工作区：git 元数据路径到此为止，不再进主回调。
                return;
            }
        }
        (self.main)(Ok(event));
    }
}

/// 用户级 watcher 排除（`watcherExclude`）模式提供者。
///
/// 组合根注入：watcher 域不感知配置文件路径（配置路径的唯一事实源在 `StorageManager`），
/// 也不在底层模块里做全局 IO。每次挂载调用一次（用户排除在挂载期冻结）。
pub type WatcherExcludesProvider = Arc<dyn Fn() -> Vec<String> + Send + Sync>;

/// Manages file-system watchers per repository workspace (main repo or one linked worktree).
///
/// Each mounted workspace gets a dedicated watcher thread that monitors file changes,
/// computes authoritative git status snapshots, and emits them to the frontend.
#[derive(Clone)]
pub struct WatcherManager {
    /// Map of `WorkspaceRef::key()` to active watcher handles.
    watchers: Arc<Mutex<HashMap<String, WatcherHandle>>>,
    /// G2 单一权威化 + C1 新鲜度：每单元的**权威快照 + `computed_at` + `dirty` + 号段**。
    ///
    /// 三张表合成一个临界区（见 [`super::store`]）：push 生产者（挂载中的 worker）与
    /// pull 生产者（按需现算）写同一张表、共用同一套 version 单调语义。
    ///
    /// **这里的条目不再随挂载释放而作废** —— 「未挂载」只是「没有 push 生产者」，不是
    /// 「没有权威数据」。旧实现把两者等同（`释放 ⇒ 删槽位`），于是读路径只能拿「是否挂载」
    /// 当新鲜度代理，非激活单元永远读不到可信数据。
    status_store: Arc<Mutex<StatusStore>>,
    /// 每单元的重算单飞闸门（同一单元同时只有一轮重算在飞）。见 [`RecomputeGate`]。
    recompute_gate: Arc<RecomputeGate>,
    /// 挂载票号登记表（类型化写入凭证 [`MountTicket`] 的在册记录）：单元 key → 当前有效票号。
    ///
    /// 为什么需要（C2 已复核，**保留**：父任务删除台账 D3 的前提是「释放不再存在」，但
    /// [`Self::unwatch`] 仍在）：push 生产者（worker 线程）的生命周期比挂载长半拍 —— 释放后
    /// 仍在飞的回调若无人校验，会把已作废的槽位重新填上「权威数据」（2026-10 CI 竞态的
    /// 确定性回归：`push_after_release_with_stale_ticket_is_rejected`）。写权的载体由此从
    /// 隐式（持有 `Arc` 克隆就能写 = 进程级有效）收紧为显式（持有效票 = 挂载级有效）：
    /// `watch()` 在创建 worker **之前**签发，`release_one` / 挂载中止使其失效，
    /// [`store_push_snapshot`] 在写入临界区内校验。Pull（未挂载单元的现算）不经此闸门
    /// —— 它是显式同步调用，调用方自带写入意图。
    mount_tickets: Arc<Mutex<HashMap<String, u64>>>,
    /// 票号发号器（全局单调递增）：票号只需唯一，校验按单元 key 查登记表比对。
    ticket_serial: Arc<AtomicU64>,
    /// [`Self::watch`] 的 **check-then-insert 原子性**（唯一职责，C2 起）。
    ///
    /// 旧实现里它还负责「释放除目标外的全部挂载 + 挂载目标」成对原子的保证，那件事随排他
    /// 挂载一起被删除（挂载别人不再释放任何人）。保留它是为了**同单元并发挂载**：`watch()`
    /// 的「已注册则告警返回」与末尾的 `insert` 不在同一个临界区，两个并发调用会各建一套监听
    /// （事件翻倍 + 线程泄漏，`concurrency-guidelines.md` 契约 3）。
    ///
    /// 把这把锁一并删掉会重新打开那个竞态 —— 所以它**不是**排他挂载的残留。
    watch_lock: Arc<Mutex<()>>,
    /// 用户级 watcher 排除模式提供者（D2）；默认空 = 只 gitignore + 硬噪声。
    watcher_excludes_provider: WatcherExcludesProvider,
    /// 测试开关：为真时不建真实 OS 流，改用 `PlatformWatcher::Noop`。
    ///
    /// **生产恒为 false**（`new()` 处初始化），`watch()` 的编排与状态机
    /// （幂等检查、快照作废、票号签发、handle 登记）在两种模式下**完全相同**，
    /// 只有「建流」这一步被替换。这使「快照槽位隔离 / 号段单调 / 票号吊销」
    /// 这类纯状态机断言不必付出 FSEvents 的代价（27 条并发流 → fseventsd 95%+）。
    ///
    /// 需要验证「事件确实到达」的用例仍走真实路径（C 层，见 `lifecycle_tests`）。
    #[cfg(test)]
    no_real_fs: Arc<std::sync::atomic::AtomicBool>,
    /// 测试模式下的合成事件扇出器（见 `no_real_fs` 与 [`TestWatchStream`]）。
    #[cfg(test)]
    test_event_sink: Arc<Mutex<Option<TestWatchStream>>>,
    /// 已创建的 watcher 套数（幂等契约观测口，见 `lifecycle_tests.rs`）：
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
            status_store: Arc::new(Mutex::new(StatusStore::new())),
            recompute_gate: Arc::new(RecomputeGate::new()),
            mount_tickets: Arc::new(Mutex::new(HashMap::new())),
            ticket_serial: Arc::new(AtomicU64::default()),
            watch_lock: Arc::new(Mutex::new(())),
            watcher_excludes_provider: Arc::new(Vec::new),
            #[cfg(test)]
            no_real_fs: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            #[cfg(test)]
            test_event_sink: Arc::new(Mutex::new(None)),
            #[cfg(test)]
            watcher_set_creations: Arc::new(AtomicUsize::default()),
        }
    }

    /// **测试专用**：取走该 manager 最近一次 `watch()` 组装的合成事件扇出器。
    ///
    /// 只在 `without_real_fs()` 模式下有值（见 `no_real_fs` 字段与 [`TestWatchStream`]）。
    #[cfg(test)]
    pub(super) fn take_test_event_sink(&self) -> Option<TestWatchStream> {
        self.test_event_sink.lock().ok()?.take()
    }

    /// **测试专用**：关闭真实 OS 流（改用 `PlatformWatcher::Noop`）。
    ///
    /// 见 `no_real_fs` 字段说明。供断言对象是「本仓状态机 / 编排」的用例使用 ——
    /// 它们断言的是 `Mutex<HashMap>` 里的状态与端口投递，不需要内核投递。
    /// 跨域夹具（`common::testing`）通过 [`crate::AppStateWrapper`] 的测试态构造器
    /// 注入，因此可见度为 `pub(crate)`。
    #[cfg(test)]
    pub(crate) fn without_real_fs(self) -> Self {
        self.no_real_fs
            .store(true, std::sync::atomic::Ordering::Relaxed);
        self
    }

    /// 注入用户级排除模式提供者（组合根用，见 `AppStateWrapper::new_with_library_store`）。
    /// 读层兜底构造过滤器时用 [`Self::watcher_excludes`] 取同一份来源。
    #[must_use]
    pub fn with_watcher_excludes<F>(mut self, provider: F) -> Self
    where
        F: Fn() -> Vec<String> + Send + Sync + 'static,
    {
        self.watcher_excludes_provider = Arc::new(provider);
        self
    }

    /// 当前用户级排除模式快照（读层 `resolve_gitignore_filter` 构造兜底过滤器用）。
    #[must_use]
    pub fn watcher_excludes(&self) -> Vec<String> {
        (self.watcher_excludes_provider)()
    }

    /// 已创建的 watcher 套数（`#[cfg(test)]` 观测口：直接测量「重复 watch 是否被
    /// 入口护栏拦截」—— map 尺寸测不出来，因为重复 insert 会覆盖旧 handle）。
    #[cfg(test)]
    pub(crate) fn watcher_set_creations(&self) -> usize {
        self.watcher_set_creations.load(Ordering::Relaxed)
    }

    /// 测试观测口：走与 `release_one` **同一条**票号吊销路径（`revoke_ticket_if`）。
    ///
    /// 为什么要暴露它：`release_one` 里「取出 handle」与「吊销票」之间有一段窗口，
    /// 真实并发下新挂载可能在这段窗口内完成并签发新票。用完整 `unwatch` → `watch`
    /// 序列无法构造这个中间态（删除落点永远是旧票），两条策略也就无法区分。
    #[cfg(test)]
    pub(crate) fn revoke_dead_mount_for_test(&self, ticket: &MountTicket) {
        revoke_ticket_if(&self.mount_tickets, &ticket.key, ticket.seq);
    }

    /// 测试观测口：当前在册的挂载票（未挂载 / 已释放 → `None`）。
    #[cfg(test)]
    pub(crate) fn current_ticket(&self, workspace: &str) -> Option<MountTicket> {
        self.mount_tickets
            .lock()
            .ok()?
            .get(workspace)
            .map(|seq| MountTicket {
                key: workspace.to_string(),
                seq: *seq,
            })
    }

    /// 测试观测口：以给定票号走完整的 Push 投递（与 worker 回调**同一条**
    /// [`deliver_push`]）—— 「写入 + emit 的取舍」因此可被确定性断言，不依赖线程时序。
    /// 返回 `None` = 凭证已失效（拒绝写入且未 emit）。
    #[cfg(test)]
    pub(crate) fn deliver_push_with_ticket(
        &self,
        sink: Arc<dyn WatcherEventSink>,
        ticket: &MountTicket,
        snapshot: GitStatusSnapshot,
    ) -> Option<Arc<GitStatusSnapshot>> {
        deliver_push(
            &sink,
            &self.status_store,
            &self.mount_tickets,
            ticket,
            snapshot,
        )
    }

    /// 该单元的 git 语义忽略过滤器（S5：读目录层复用做读前剪枝 + ignored 标记；
    /// 非 git 单元 / 尚未挂载时为 None —— 读层退化为仅 .git 硬过滤）。
    #[must_use]
    pub fn gitignore_for(&self, repo: &WorkspaceRef) -> Option<Arc<GitIgnoreFilter>> {
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
    pub fn poke_status_worker_and_wait(&self, repo: &WorkspaceRef, timeout: Duration) -> bool {
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

    /// 该单元的权威 status 快照（读接口数据源，**同时更新 LRU 访问时刻**）。
    /// `None` = 登记表里没有该单元（从未算过 / 已被容量淘汰 / 刚被 `forget`）。
    ///
    /// **语义收紧（C1）**：`None` 与「是否挂载」无关。未挂载单元同样可以有权威快照 ——
    /// 是否值得相信由 `computed_at` / `dirty` 决定（见 [`Self::status_needs_recompute`]），
    /// 不再由资源状态推断。
    ///
    /// **调用方不得把 `None` 当作「无变更」** —— 那是「未知」，渲染成空列表等于伪造事实。
    #[must_use]
    pub fn snapshot(&self, repo: &WorkspaceRef) -> Option<Arc<GitStatusSnapshot>> {
        self.status_store
            .lock()
            .ok()?
            .read_snapshot(&repo.key(), Instant::now())
    }

    /// 该单元此刻是否**值得重算**（读路径的唯一判据，与是否挂载无关）。
    ///
    /// 三条任一成立：无条目 / 有脏位 / 超过 [`STALE_AFTER`]。
    #[must_use]
    pub fn status_needs_recompute(&self, repo: &WorkspaceRef) -> bool {
        self.status_store.lock().map_or(true, |store| {
            store.needs_recompute(&repo.key(), Instant::now())
        })
    }

    /// 该单元的重算许可（同一单元同时只有一轮重算在飞，后到者排队）。
    ///
    /// 拿到许可后调用方**必须**重新判 [`Self::status_needs_recompute`] —— 等到的这一轮
    /// 可能已把数据算新，此时再算一次纯属浪费。
    #[must_use]
    pub fn recompute_gate(&self) -> Arc<RecomputeGate> {
        Arc::clone(&self.recompute_gate)
    }

    /// 标记失效（事件 / 写后 / 重算失败的回滚用）。
    pub fn mark_status_dirty(&self, repo: &WorkspaceRef, mask: DirtyMask) {
        if let Ok(mut store) = self.status_store.lock() {
            store.mark_dirty(&repo.key(), mask);
        }
    }

    /// 取走脏位（重算开始）。返回值描述本轮要重算的维度，失败时交回
    /// [`Self::abort_status_recompute`]。
    #[must_use]
    pub fn begin_status_recompute(&self, repo: &WorkspaceRef) -> DirtyMask {
        self.status_store.lock().map_or_else(
            |_| DirtyMask::all(),
            |mut store| store.begin_recompute(&repo.key(), Instant::now()),
        )
    }

    /// 重算失败：把脏位并回去（失败 ≠ 数据新鲜），已有条目**不清空**。
    pub fn abort_status_recompute(&self, repo: &WorkspaceRef, mask: DirtyMask) {
        if let Ok(mut store) = self.status_store.lock() {
            store.abort_recompute(&repo.key(), mask);
        }
    }

    /// 作废某单元的**数据**（保留号段水位）。只在「该单元确实不再存在」时调用
    /// （项目移除 / worktree 删除）—— 单纯切走视图**不得**调用。
    pub fn forget_status(&self, repo: &WorkspaceRef) {
        let key = repo.key();
        if let Ok(mut store) = self.status_store.lock() {
            store.forget(&key);
        }
        self.recompute_gate.forget(&key);
    }

    /// 登记一份 **pull 生产者**算出的快照（按需现算）。
    ///
    /// `computed_from` = 本轮计算**开始**的时刻。"晚到的旧结果不得覆盖更新的登记"这条
    /// 栅栏由它实现（取代旧实现里「按是否挂载」的守卫）：若算期间已有更新的快照落地，
    /// 本次结果作废并返回 `None`。
    ///
    /// 返回 `Some(已盖章快照)` = 已写入；`None` = 被更新的登记取代。
    #[must_use]
    pub fn record_pull(
        &self,
        mut snapshot: GitStatusSnapshot,
        computed_from: Instant,
    ) -> Option<Arc<GitStatusSnapshot>> {
        // 上限的唯一实现（与 worker 共用，禁止各写一份）。
        snapshot.enforce_entry_cap();
        let mut store = self
            .status_store
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        store.upsert_if_not_superseded(snapshot, computed_from, Instant::now())
    }

    /// Start watching one repository workspace for file changes and maintain its snapshot.
    pub fn watch(&self, repo: WorkspaceRef, sink: Arc<dyn WatcherEventSink>) {
        let workspace = repo.key();
        let path = repo.root_pathbuf();
        // 入口不变量：同一单元只允许一套 watcher。重复注册会**翻倍投递事件**并再泄漏
        // 一套后台线程（实测：同项目被 watch 4 次 → 单次变更 emit 3 次）。
        // 「配置变更」不需要重建 watcher —— 它走 `WatchMaintenance::ReloadAll`。
        if let Ok(watchers) = self.watchers.lock() {
            if watchers.contains_key(&workspace) {
                log::warn!(
                    "[Watcher] workspace {} is already watched at {}, ignoring duplicate watch",
                    workspace,
                    path.display()
                );
                return;
            }
        }

        let sink_for_diff = Arc::clone(&sink);

        // 该单元先前若存在快照（切走过），**C1 起不再作废**：权威数据不和资源生命周期
        // 耦合。是否可信由登记表的 `computed_at` / `dirty` 判定，读路径据此重算
        // （旧实现把「无生产者」当成「无权威数据」，那是把资源状态泄漏进数据契约的入口）。

        // 非 git 单元：跳过所有 git 相关资源（worker / scheduler / heartbeat / git meta watcher），
        // 仅保留文件监听 + 文件树变更事件。避免对非 git 目录启动 git status worker 执行 git rev-parse 等命令。
        let git_repo = is_git_repo(&path);

        // 1. 创建 GitStatusWorker —— status 的 push 生产者（D1）。
        // 每次实质变化产出**完整 versioned 快照**：写共享注册表（invoke 读接口
        // 的数据源，D2 收编）+ 发 v2 事件整体通知（D3）。
        //
        // 写入凭证（`MountTicket`）**先于 worker 创建**签发：首个快照可能在本函数登记
        // handle 之前就到达，凭证必须在那之前已在册（见 `store_push_snapshot` 的闸门说明）。
        // 签发后**立刻 arm** `ticket_guard`：此后任何 setup 失败出口（watcher 创建失败 /
        // 锁中毒 / worker 线程创建 panic 的 unwind）都由 Drop 兜底吊销 —— 不靠每个出口记得回收。
        let (worker, scheduler, mount_ticket, mut ticket_guard) = if git_repo {
            let ticket = self.issue_ticket(&workspace);
            let guard = MountTicketGuard::arm(&self.mount_tickets, &ticket);
            let store_for_push = self.status_store.clone();
            let tickets_store = self.mount_tickets.clone();
            let ticket_for_cb = ticket.clone();
            let worker = GitStatusWorker::start(repo.clone(), move |snapshot| {
                // 凭证有效 → 盖章写入 + emit；失效（已释放 / 被重挂载取代）→ 丢弃且不 emit。
                // version 由登记表盖章后**再**推送：事件里的 version 必须与登记表里的一致，
                // 否则前端的乱序闸门会拿两套序号互比（见 `deliver_push`）。
                let _ = deliver_push(
                    &sink_for_diff,
                    &store_for_push,
                    &tickets_store,
                    &ticket_for_cb,
                    snapshot,
                );
            });

            // 2. 创建 ThrottleScheduler -- 合并 notify 事件，驱动 worker.check()
            let worker_clone = worker.clone();
            let scheduler = ThrottleScheduler::new(move || {
                worker_clone.check();
            });

            // 立即触发一次 git status 检查，获取初始状态（首个快照由 worker 线程异步产出）
            worker.check();

            // 挂载中止（下方任意 setup 失败出口）⇒ guard 未 commit，Drop 时吊销票号
            // （compare-and-remove，不误杀并发重挂载的新票）。
            (Some(worker), Some(scheduler), Some(ticket), Some(guard))
        } else {
            log::info!(
                "[Watcher] Skipping git status worker for non-git workspace {} at {}",
                workspace,
                path.display()
            );
            (None, None, None, None)
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
            Some(GitIgnoreFilter::with_user_excludes(
                path.clone(),
                &(self.watcher_excludes_provider)(),
            ))
        } else {
            None
        };
        // W2：监听边界清单在**构造 watcher 之前**算出 —— 它的 `ignored_roots` 是 macOS
        // 物理排除集合，而排除必须在 `FSEventStreamStart` 之前设置。清单同时回传给注册层
        // （避免 `SelectiveRegistration` 后端重复遍历整棵树）。
        //
        // 只在会消费它的后端上计算：`RecursiveFilterOnly`（Windows）既不逐目录注册、
        // 也不做物理排除，多算一次全树遍历纯属浪费（且会改变 Windows 的挂载成本）。
        let manifest = if watch_backend() == WatchBackend::RecursiveFilterOnly {
            None
        } else {
            gitignore_filter
                .as_ref()
                .map(|filter| WatchManifest::compute(&path, Some(filter), MAX_WATCH_DIRS))
        };
        // 物理排除集合只在能真正排除的后端上计算（macOS）：其余后端（含 Linux
        // `SelectiveRegistration`）工厂会丢弃它，且 `build_exclusion_paths` 与整树遍历
        // 都无收益 —— 避免 Linux/Windows 上的无谓工作量。
        let exclusions = if watch_backend().can_exclude_subtrees() {
            manifest
                .as_ref()
                .map(|manifest| build_exclusion_paths(manifest.ignored_roots()))
                .unwrap_or_default()
        } else {
            Vec::new()
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
        // git 元数据：判定是否并入主 watcher（规则住在 git_meta_merge 模块，
        // 本函数只负责顺序与失败策略）。
        // 回滚开关在这里读**一次**（挂载期冻结）：`decide` 是纯判定函数，不读环境。
        let git_meta_decision = super::git_meta_merge::decide(
            &path,
            git_repo,
            &exclusions,
            watch_backend().can_exclude_subtrees(),
            super::git_meta_merge::merge_disabled_by_env(),
            &workspace,
        );
        let merge_git_meta = git_meta_decision.merge;
        // **单一构造点**：三条出口的语义（index/refs 只发调度信号、head 才 emit 事实）
        // 只在这里构造一次，再按 `merge` 分给**两条传输路径之一**：
        //   合并 → 塞进主回调；不合并（Linux 逐目录注册 / Windows 整树过滤）→ 独立流。
        // 两条传输共用同一份 `GitMetaCallbacks`，语义不可能分叉。
        let git_meta_callbacks = git_meta_decision.paths.as_ref().map(|paths| {
            super::git_meta_merge::build_callbacks(
                &workspace,
                &repo,
                paths,
                Arc::clone(&sink),
                scheduler.as_ref().map(|s| s.sender()),
            )
        });
        // 互斥分配：同一份回调只能给一条传输，否则同一事件会驱动两次重算、推两份快照。
        let (merged_git_meta, standalone_git_meta) = if merge_git_meta {
            log::info!(
                "[Watcher:{}] git meta merged into main watcher (single FSEvents stream)",
                workspace
            );
            (git_meta_callbacks, None)
        } else {
            (None, git_meta_callbacks)
        };
        // 测试模式要把它 `.take()` 进扇出器；生产模式只按值传给独立流。
        // 用遮蔽（shadowing）而不是 `mut`：生产构建里这个绑定永远不会被可变借用，
        // 无条件写 `mut` 会在 `cargo clippy --all-targets` 里报 `unused_mut`。
        #[cfg(test)]
        let mut standalone_git_meta = standalone_git_meta;

        let notify_callback = build_notify_callback(
            repo.clone(),
            sink_for_watcher_error,
            gitignore_filter_for_notify,
            maintenance_tx_for_closure,
            debounce_tx_for_notify,
            tree_debounce_tx,
            scheduler_tx,
            git_repo,
            merged_git_meta,
        );

        // 测试开关（生产恒 false）：不建 OS 流，并把**回调本体**交给测试，
        // 由测试主动投喂合成事件 —— 这样 `watch()` 的编排与状态机（幂等检查、
        // 快照作废、票号签发、handle 登记）全部照常执行，只有「内核投递」被替换。
        // 见 `no_real_fs` 字段与 [`TestWatchStream`]。
        #[cfg(test)]
        let notify_result = if self.no_real_fs.load(Ordering::Relaxed) {
            // 两条流的回调各就各位：`standalone_git_meta` 已被取走（`None`）说明本次挂载
            // 走的是合并路径，git 元数据事件由主回调自己分类；否则由扇出器转给独立流出口。
            if let Ok(mut slot) = self.test_event_sink.lock() {
                *slot = Some(TestWatchStream {
                    main: Box::new(notify_callback),
                    git_meta: standalone_git_meta.take(),
                });
            }
            Ok(PlatformWatcher::Noop)
        } else {
            create_file_watcher(notify_callback, Config::default(), &exclusions)
        };
        #[cfg(not(test))]
        let notify_result = create_file_watcher(notify_callback, Config::default(), &exclusions);

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
                        workspace,
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
                        workspace,
                        e
                    );
                    return;
                }
            };
            // MutexGuard 不实现 Watcher：显式解引用到内层 &mut PlatformWatcher
            reg.register_root(
                &mut *w,
                &path,
                gitignore_for_handle.as_deref(),
                manifest.as_ref(),
            );
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
            "[Watcher] Started watching workspace {} at {}",
            workspace,
            path.display()
        );

        // 4b. 创建 git 元数据 watcher -- 单独监听**该单元自己的** git 目录（HEAD / index / refs），
        // 绕过 git 忽略过滤（该过滤会丢弃 .git 内事件，导致 checkout 后 worker 无法感知
        // 分支变化、changes 列表残留旧分支数据）。
        //
        // 身份补全后不再需要「跨目录补挂别的单元」：linked worktree 的 HEAD/index 位于其
        // 私有 gitdir（`<common>/.git/worktrees/<name>/`），由**该单元自己的**这条 watcher
        // 监听（`resolve_git_meta_paths` 会读 `.git` 指针文件定位）。旧实现里那套
        // `resolve_worktree_roots` + `rearm_worktrees_if_needed` 的机制，存在的唯一前提就是
        // 「worktree 没有自己的资源」—— 前提消失，机制退役。
        //
        // 与合并路径**共用同一份回调**：`standalone_git_meta` 就是上面 `build_callbacks`
        // 的产物，这里只把它接到独立流上（下方 `capture_test_stream` 在测试模式下接的是
        // 同一条传输）—— 两条传输路径的语义不可能分叉。
        //
        // 测试模式（`without_real_fs`）不建真实 OS 流，改用 `TestWatchStream` 把
        // **两条流的回调都拿下**再按路径扇出，因此「非 macOS 上的独立流」也有合成入口。
        //
        // 不需要单独的「跳过真实流」判断：上面的 `standalone_git_meta.take()` 已经
        // 把它取空，本分支自然落 `_ => None`。早先写 `!skip_real_fs` 是双重判定，
        // 而它在那时已恒为真（take 发生在更早处）—— 读起来像活判据，实际是死条件。
        let head_watcher = match standalone_git_meta {
            Some(ctx) => super::git_meta_merge::into_standalone_stream(ctx, &workspace),
            // `None` 两种来源殊途同归：
            // - 合并路径已接管（或本就不是 git 单元）；
            // - 测试模式：回调已被扇出器取走，由它接管投递。
            None => None,
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
            let perf_unit = workspace.clone();
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
                        workspace_key: perf_unit,
                        project_id: perf_project_id,
                        suggestions,
                    }));
                });
        }

        if let Ok(mut watchers) = self.watchers.lock() {
            watchers.insert(
                workspace,
                WatcherHandle {
                    _watcher: Some(watcher),
                    _registration: registration,
                    _maintenance_tx: Some(maintenance_tx),
                    _scheduler: scheduler,
                    worker,
                    mount_ticket,
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
            // 挂载成立：凭证转交 handle（Drop 不再吊销；释放路径见 `release_one`）。
            // 锁中毒走到不了这里 ⇒ guard 保持未 commit，函数退出时兜底吊销。
            if let Some(guard) = ticket_guard.as_mut() {
                guard.commit();
            }
        }
    }

    /// 释放某单元的全部资源（watcher 句柄 drop → debounce channel 关闭、停止信号置位）。
    ///
    /// **C1 起不再作废快照**：释放的语义是「没有 push 生产者」，不是「没有权威数据」。
    /// 残留快照的可信度由 `computed_at` 决定 —— 陈旧则读路径重算，与挂载状态无关。
    pub fn unwatch(&self, repo: &WorkspaceRef) {
        self.release_one(&repo.key());
        crate::common::file::services::invalidate_remote_ignored_cache(repo.project_id());
    }

    /// 项目被移除 / 路径变更时，释放该项目下**所有**单元的挂载，并作废其登记。
    ///
    /// **号段随条目一起回收**（`StatusStore::forget_project`）：项目不存在了，前端那两个槽位
    /// 也不会再被读。单元级的「切走视图」不走这里 —— 那条路径保留数据与号段
    /// （见 [`super::store`]）。
    pub fn unwatch_project(&self, project_id: &str) {
        let units: Vec<String> = self
            .watchers
            .lock()
            .map(|m| {
                m.keys()
                    .filter(|k| {
                        WorkspaceRef::parse_key(k).is_some_and(|(pid, _)| pid == project_id)
                    })
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        for workspace in units {
            self.release_one(&workspace);
        }
        // 项目没了：数据与号段一起回收（单元级的「切走视图」不走这里）。
        if let Ok(mut store) = self.status_store.lock() {
            store.forget_project(project_id);
        }
        crate::common::file::services::invalidate_remote_ignored_cache(project_id);
    }

    /// **声明式 reconcile（唯一的挂载入口）**：把挂载集合收敛到 `keep`（可见集合），返回
    /// `(created, released)`。
    ///
    /// 语义（C4）：
    /// - `units` 里的单元**未挂载则挂载**。**幂等**：先判 [`Self::is_watched`] 再调
    ///   [`Self::watch`] —— 后者的重复注册分支是 WARN，诊断语义是「有人绕过了挂载入口」
    ///   （D-B 落地前正是它暴露了启动期双发起点）。调用方会**合法地**重申同一单元（前端集合
    ///   未变时的重申、激活态被改写成后端 canonical 形态后的一次重发），被合法路径撞上等于把
    ///   告警作废，因此幂等性必须在入口强制；
    /// - 已挂载但**不在 `keep` 里**的单元**释放**（[`Self::release_one`]，保留登记表数据 ——
    ///   「释放 ≠ 数据作废」，C1 语义）。
    ///
    /// **差集与挂载必须在同一个 `watch_lock` 临界区内完成**：先算差集再释放会在中间被并发挂载
    /// 插队，把「刚被别的调用点挂上」的单元误杀（R1.3 的实现要点）。
    ///
    /// **`keep` 是调用方的声明，不是 `units` 的投影**：远端单元（WSL / SSH，无 push 生产者）
    /// 从不挂载，但它们属于可见集合 —— 若把 `keep` 缩成 `units`，任何「远端单元在册」的声明
    /// 都会退化成「释放本地单元」。释放集合因此只与 `keep` 求差，与 `units` 无关。
    ///
    /// **不收敛的部分**：`keep` 之外的**未挂载**单元不产生任何动作（没有资源可释放）；
    /// `units` 的 setup 失败（`watch` 内部已记录告警）不计入 `created`，调用方据此退化为一次 pull。
    ///
    /// **临界区**：整批在 [`Self::watch_lock`] 内完成 —— 它保护两件事：`watch()` 的
    /// check-then-insert（同单元并发挂载不得建出两套监听），以及「差集 + 挂载 + 释放」的原子性。
    ///
    /// **阻塞**：内含 notify 递归注册（Linux 上同步遍历整树）与 fs 探测 ⇒ 调用方
    /// 必须在阻塞池内（`run_blocking` / `spawn_blocking`，红线 3）。
    #[must_use = "返回 (新建, 释放) 的 key；忽略它等于丢掉一次可观测的生命周期事件"]
    pub fn reconcile_mounted(
        &self,
        units: Vec<(WorkspaceRef, Arc<dyn WatcherEventSink>)>,
        keep: &[String],
    ) -> (Vec<String>, Vec<String>) {
        let total = units.len();
        let keep: std::collections::HashSet<&str> = keep.iter().map(String::as_str).collect();
        let _watch_guard = self.watch_lock.lock().unwrap_or_else(|e| e.into_inner());

        let mut created = Vec::new();
        for (repo, sink) in units {
            let key = repo.key();
            if self.is_watched(&repo) {
                // 重申挂载是空操作：不重建 watcher，也不动已落地的快照（worker 的产出可能刚到）。
                continue;
            }
            self.watch(repo, sink);
            // setup 失败不计入新建：调用方据此退化为一次 pull。
            if self.is_watched_key(&key) {
                created.push(key);
            }
        }

        // 离热释放：与挂载同临界区（见上）。`release_one` 只释放资源，登记表数据保留。
        let stale: Vec<String> = self
            .watched_units()
            .into_iter()
            .filter(|key| !keep.contains(key.as_str()))
            .collect();
        for key in &stale {
            self.release_one(key);
        }

        // R4.2：挂载集合可从日志读出 —— 批量命令在这里留**一条**记录（未新建的单元由更早那次
        // 调用的 `Started watching workspace` 记录体现，不去撑重复日志）。
        log::info!(
            "[Watcher] reconcile mounted {} units (new: {}, released: {})",
            total,
            created.len(),
            stale.len()
        );
        (created, stale)
    }

    /// 摘掉一个单元的挂载资源（`unwatch` / `unwatch_project` 的公共内核）。
    ///
    /// **只释放资源，不动登记表**（C1）：数据是否可信由 `computed_at` / `dirty` 决定，
    /// 与资源是否存在无关。号段同理不再需要「活得比数据久」的特殊处理 —— 它和数据同表、
    /// 同生命周期（只有容量淘汰与 `forget` 会动它）。
    ///
    /// **票号吊销与移除 handle 同临界区**（顺序契约，勿动）：晚到推送的凭证校验与快照写入
    /// 在同一临界区（见 [`store_push_snapshot`]）。吊销只针对**该挂载自己的票**
    /// （compare-and-remove）：并发「释放 + 重挂载」交错时，无条件删除会误杀新挂载刚签发的票
    /// （新挂载此后收不到任何数据，比漏杀一票隐蔽得多）。
    fn release_one(&self, workspace: &str) {
        let released = {
            let mut watchers = self
                .watchers
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            watchers.remove(workspace)
        };
        if let Some(handle) = released {
            handle.stop_signal.store(true, Ordering::Relaxed);
            log::debug!("[Watcher] released workspace {workspace}");
            if let Some(ticket) = &handle.mount_ticket {
                revoke_ticket_if(&self.mount_tickets, &ticket.key, ticket.seq);
            }
        }
    }

    /// 该单元是否已挂载资源（区分「冷启动中」与「压根没挂 → 走 pull」两种 None）。
    #[must_use]
    pub fn is_watched(&self, repo: &WorkspaceRef) -> bool {
        self.is_watched_key(&repo.key())
    }

    /// 按 key 判挂载（[`Self::is_watched`] 的内核：`reconcile_mounted` 在 `watch()` **之后**
    /// 复查同一身份时已无处借 `WorkspaceRef` 了）。
    fn is_watched_key(&self, key: &str) -> bool {
        self.watchers.lock().is_ok_and(|m| m.contains_key(key))
    }

    /// 当前挂载中的单元 key 集合（测试观测口：可见集合契约的唯一可观测面）。
    #[must_use]
    pub fn watched_units(&self) -> Vec<String> {
        self.watchers
            .lock()
            .map(|m| m.keys().cloned().collect())
            .unwrap_or_default()
    }

    /// 签发票号：登记 `workspace → seq` 并使它成为该单元**唯一有效**的写入凭证
    /// （后签发的票自然使先前的失效，见 [`store_push_snapshot`] 的比对语义）。
    ///
    /// 调用时机是硬契约：必须在 `GitStatusWorker` 创建**之前** —— 首个快照可能先于
    /// handle 登记到达，凭证必须在那之前已在册。
    fn issue_ticket(&self, workspace: &str) -> MountTicket {
        let seq = self.ticket_serial.fetch_add(1, Ordering::Relaxed) + 1;
        self.mount_tickets
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(workspace.to_string(), seq);
        MountTicket {
            key: workspace.to_string(),
            seq,
        }
    }

    /// Stop all active file watchers.
    pub fn stop_all(&self) {
        log::info!("[Watcher] Stopping all watchers...");
        let stopped: Vec<(String, String)> = if let Ok(mut watchers) = self.watchers.lock() {
            let units: Vec<(String, String)> = watchers
                .keys()
                .filter_map(|k| {
                    WorkspaceRef::parse_key(k).map(|(pid, _)| (k.clone(), pid.to_string()))
                })
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
        // 票号一并清空：所有挂载已停止 ⇒ 在册票全部失效（晚到推送一律被拒）。
        // 与 release 的「票先死」同向；全停场景无「误杀新票」可能，直接 clear。
        self.mount_tickets
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
        log::info!("[Watcher] All watchers stopped");
    }
}

/// 一次挂载的**写入凭证**（类型化票号）。
///
/// 写权的载体：worker 的推送回调（Push）活在 `watch()` 栈之外，释放单元后仍会触发 ——
/// 晚到的推送若无人校验，会把已作废的槽位重新填上「权威数据」（2026-10 CI 竞态的确定性
/// 回归：`push_after_release_with_stale_ticket_is_rejected`）。凭证把写权从隐式
/// （持有 `Arc` 克隆就能写 = 进程级有效）收紧为显式且可失效（= 挂载级有效）：
/// - 只能由 [`WatcherManager::issue_ticket`] 构造（字段私有，全仓无第二签发方）；
/// - `release_one` / 挂载中止使其失效；[`store_push_snapshot`] 在写入临界区内校验。
///
/// 为什么带 `key`：票是**单元专属**的 —— 校验按 key 查登记表比对 seq，一张票不能给
/// 别的单元写数据（`store_push_snapshot` 以 `debug_assert` 钉住票与快照同单元）。
#[derive(Clone, Debug)]
pub(crate) struct MountTicket {
    pub(crate) key: String,
    pub(crate) seq: u64,
}

/// 挂载凭证的作用域守卫：`watch()` 的 setup 失败出口（watcher 创建失败 / 锁中毒）必须
/// 使票号失效 —— 由 Drop 兜底，不靠「每个出口记得回收」。
///
/// 只在挂载成立（handle 已登记）时 [`commit`](Self::commit)：此后凭证归该挂载所有，
/// 生命周期转由 `release_one`（经 `WatcherHandle::mount_ticket`）管理。
struct MountTicketGuard {
    tickets: Arc<Mutex<HashMap<String, u64>>>,
    key: String,
    seq: u64,
    committed: bool,
}

impl MountTicketGuard {
    fn arm(tickets: &Arc<Mutex<HashMap<String, u64>>>, ticket: &MountTicket) -> Self {
        Self {
            tickets: Arc::clone(tickets),
            key: ticket.key.clone(),
            seq: ticket.seq,
            committed: false,
        }
    }

    /// 挂载成立：凭证转交 handle，守卫退役（Drop 不再吊销）。
    const fn commit(&mut self) {
        self.committed = true;
    }
}

impl Drop for MountTicketGuard {
    fn drop(&mut self) {
        if !self.committed {
            revoke_ticket_if(&self.tickets, &self.key, self.seq);
        }
    }
}

/// 吊销「在册且 seq 匹配」的票号（compare-and-remove）。
///
/// 为什么不是无条件 `remove`：并发「释放 + 重挂载」交错时，无条件删除会把新挂载刚签发的
/// 票一起杀掉 —— 新挂载此后收不到任何数据（worker 推一次被拒一次），比漏杀一票隐蔽得多。
fn revoke_ticket_if(tickets: &Arc<Mutex<HashMap<String, u64>>>, key: &str, seq: u64) {
    let mut tickets = tickets
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if tickets.get(key) == Some(&seq) {
        tickets.remove(key);
    }
}

/// 快照登记内核：号段推进 + `version` 盖章 + 插槽。**调用方必须已持有 `store` 锁**
/// （签名强制「闸门/守卫 + 取号 + 插入同临界区」的原子性契约 —— 分成多次持锁时，并发
/// 生产者能交错出「取小号却后插入」，槽位回退到旧数据而号段已前进，前端无从察觉）。
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
/// 因此：**寻址与竞态只看注册表**，生产者的差别只影响新鲜度与闸门（见两个调用入口）。
/// `snapshot.version` 在此被覆盖，生产者传什么都不作数（保留字段只为让 worker 自身的
/// 迭代测试可断言）。
///
/// **锁纪律**（改动前必读）：嵌套锁序固定为 `store → tickets`。全仓不存在反向嵌套
/// （`release_one` / `watch` / `poke_status_worker_and_wait` 对 watchers 与 store 都是先释放
/// 再取的另一把，`watch_lock` 只在最外层），因此无死锁环。
/// 新增代码不得引入 `tickets → store` 的持锁嵌套。
///
/// **锁中毒不中止**：登记路径的锁一律按本文件既有策略恢复
/// （`unwrap_or_else(PoisonError::into_inner)`）。快照登记是「读接口的数据源」，
/// 一次中毒（任一持锁线程 panic）若让登记失败，轻则读命令拿不到数据、重则把整条命令
/// 升级成进程 abort —— 本应用的底线是不闪退，登记失败必须退化成可用状态。
/// Push 登记（挂载中 worker 的产出）：**凭证闸门**与写入在同一 `store` 临界区内。
///
/// 返回 `None` = 票号已失效（该次挂载已被释放 / 已被重挂载取代）——调用方必须丢弃写入
/// 且不得 emit：晚到推送把已作废槽位重新填上「权威数据」正是 2026-10 CI 竞态的形态
/// （确定性回归：`push_after_release_with_stale_ticket_is_rejected`）。
///
/// 为什么闸门是票号而不是 `watchers.contains_key`：
/// 1. `watch()` 在创建 worker 前签发票号、在 watcher 建好后才登记 handle —— 冷启动首个
///    快照**合法地**先于 handle 登记到达，按挂载状态拒写会静默丢掉它（且 worker 的变化
///    闸门不会补发）；
/// 2. 「释放 → 重挂载」后旧 worker 的晚到推送会被 `contains_key` 放行（新挂载在册），
///    拿到更大 version 覆盖新数据 —— 比亡羊补牢更隐蔽的变体，票号一并拒掉；
/// 3. 闸门与插入同临界区，且 `release_one` **先吊销票** —— 两件事共同排除
///    「校验通过 → 释放发生 → 晚到插入复活数据」的窗口。
fn store_push_snapshot(
    store: &Arc<Mutex<StatusStore>>,
    tickets: &Arc<Mutex<HashMap<String, u64>>>,
    ticket: &MountTicket,
    snapshot: GitStatusSnapshot,
) -> Option<Arc<GitStatusSnapshot>> {
    let key = snapshot.workspace_key.clone();
    debug_assert_eq!(ticket.key, key, "票是单元专属的，必须与快照同单元");
    let mut store = store
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let current = tickets
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .get(&key)
        .copied();
    if current != Some(ticket.seq) {
        return None;
    }
    Some(store.upsert_push(snapshot, Instant::now()))
}

/// Push 投递的完整决策（worker 回调与确定性测试**共用同一实现**）：
/// 凭证有效 → 盖章写入 + emit；失效 → 丢弃写入且 **不 emit**（禁止陈旧事件复活已释放单元）。
/// 返回 `Some(已盖章快照)` = 已写入并已 emit。
fn deliver_push(
    sink: &Arc<dyn WatcherEventSink>,
    store: &Arc<Mutex<StatusStore>>,
    tickets: &Arc<Mutex<HashMap<String, u64>>>,
    ticket: &MountTicket,
    snapshot: GitStatusSnapshot,
) -> Option<Arc<GitStatusSnapshot>> {
    let Some(stamped) = store_push_snapshot(store, tickets, ticket, snapshot) else {
        log::debug!(
            "[Watcher] dropped late push for released workspace {}",
            ticket.key
        );
        return None;
    };
    sink.emit(WatcherEvent::StatusSnapshot(&stamped));
    Some(stamped)
}
