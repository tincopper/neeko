//! File-system watcher service for detecting changes and emitting events.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use crate::common::git::status_worker::{GitStatusDiff, GitStatusWorker};
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use notify::event::ModifyKind;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex, RwLock,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

// ── Event 名称常量（单一事实源，前端经 shared/events.ts 同步引用）───────────

/// 文件内容变更事件：`file-changed`
pub const FILE_CHANGED_EVENT: &str = "file-changed";
/// 文件树结构变更事件：`file-tree-changed`
pub const FILE_TREE_CHANGED_EVENT: &str = "file-tree-changed";
/// Git 增量 diff 事件：`git-status-diff`
pub const GIT_STATUS_DIFF_EVENT: &str = "git-status-diff";
/// Git 状态变更事件（兼容旧监听的全量刷新 fallback）：`git-changed`
pub const GIT_CHANGED_EVENT: &str = "git-changed";

// ── 文件变更事件 ──────────────────────────────────────────────────────────────

/// 文件内容变更事件 payload，发送给前端用于刷新已打开的 tab
#[derive(Debug, Clone, serde::Serialize)]
pub struct FileChangedEvent {
    /// 项目 ID
    pub project_id: String,
    /// 相对于项目根目录的变更文件路径列表（使用 `/` 分隔符）
    pub paths: Vec<String>,
}

/// 文件树结构变更事件 payload（文件新增/删除/重命名），前端收到后应刷新目录树
#[derive(Debug, Clone, serde::Serialize)]
pub struct FileTreeChangedEvent {
    /// 项目 ID
    pub project_id: String,
}

// ── Throttle 调度器 ───────────────────────────────────────────────────────────

/// Throttle 调度器：收到信号后立即触发一次回调，
/// 执行期间的信号合并，执行完成后若有排队则再触发一次。
struct ThrottleScheduler {
    tx: mpsc::Sender<()>,
}

impl ThrottleScheduler {
    fn new(callback: impl Fn() + Send + 'static) -> Self {
        let (tx, rx) = mpsc::channel::<()>();

        std::thread::Builder::new()
            .name("throttle-scheduler".to_string())
            .spawn(move || {
                while let Ok(()) = rx.recv() {
                    // 立即触发回调

                    callback();

                    // 处理完成后，drain 掉执行期间积压的所有信号
                    // 若有积压，合并为一次回调（节流语义）；若无则进入下一轮等待
                    let mut has_pending = false;
                    while rx.try_recv().is_ok() {
                        has_pending = true;
                    }
                    if has_pending {
                        callback();
                    }
                }
            })
            .expect("Failed to spawn throttle scheduler thread");

        Self { tx }
    }

    /// 克隆发送端（用于传递给 notify watcher 闭包）
    fn sender(&self) -> mpsc::Sender<()> {
        self.tx.clone()
    }
}

// ── Debounce sender：收集路径，200ms 无新事件后一次性 emit ────────────────────

/// 通过独立 channel 向 debounce 线程发送变更路径
struct DebounceSender {
    tx: mpsc::Sender<PathBuf>,
}

impl DebounceSender {
    fn new(project_id: String, project_root: PathBuf, app_handle: AppHandle) -> Self {
        let (tx, rx) = mpsc::channel::<PathBuf>();

        std::thread::Builder::new()
            .name(format!("file-debounce-{}", project_id))
            .spawn(move || {
                // 收集路径的缓冲区，key 为相对路径字符串（去重）
                let mut buffer: Vec<String> = Vec::new();
                let mut deadline: Option<Instant> = None;

                loop {
                    // 计算 recv_timeout 时间：若有待发送内容则等到 deadline，否则无限等待
                    let result = if let Some(dl) = deadline {
                        let now = Instant::now();
                        if now >= dl {
                            // deadline 已过，立即发送
                            Err(mpsc::RecvTimeoutError::Timeout)
                        } else {
                            rx.recv_timeout(dl - now)
                        }
                    } else {
                        rx.recv().map_err(|_| mpsc::RecvTimeoutError::Disconnected)
                    };

                    match result {
                        Ok(abs_path) => {
                            // 转为相对路径（用 / 分隔符）
                            let rel = abs_path
                                .strip_prefix(&project_root)
                                .unwrap_or(&abs_path)
                                .to_string_lossy()
                                .replace('\\', "/");
                            if !buffer.contains(&rel) {
                                buffer.push(rel);
                            }
                            // 重置 deadline（滑动窗口）
                            deadline = Some(Instant::now() + Duration::from_millis(200));
                        }
                        Err(mpsc::RecvTimeoutError::Timeout) => {
                            // deadline 到期，flush
                            if !buffer.is_empty() {
                                let event = FileChangedEvent {
                                    project_id: project_id.clone(),
                                    paths: std::mem::take(&mut buffer),
                                };
                                log::debug!(
                                    "[FileDebounce:{}] Emitting file-changed for {} paths",
                                    project_id,
                                    event.paths.len()
                                );
                                let _ = app_handle.emit(FILE_CHANGED_EVENT, &event);
                            }
                            deadline = None;
                        }
                        Err(mpsc::RecvTimeoutError::Disconnected) => {
                            // channel 关闭，退出
                            break;
                        }
                    }
                }
            })
            .expect("Failed to spawn file-debounce thread");

        Self { tx }
    }
}

// ── TreeChangeDebounceSender：文件树结构变更防抖（Create/Remove/Rename） ───────

/// 收到信号后开启 500ms 滑动窗口，窗口内再无新信号则 emit `file-tree-changed`
struct TreeChangeDebounceSender {
    tx: mpsc::Sender<()>,
}

impl TreeChangeDebounceSender {
    fn new(project_id: String, app_handle: AppHandle) -> Self {
        let (tx, rx) = mpsc::channel::<()>();

        std::thread::Builder::new()
            .name(format!("tree-debounce-{}", project_id))
            .spawn(move || {
                while let Ok(()) = rx.recv() {
                    // 开始 500ms 滑动窗口：持续收信号就重置 deadline
                    let mut deadline = Instant::now() + Duration::from_millis(500);
                    loop {
                        let now = Instant::now();
                        if now >= deadline {
                            break;
                        }
                        match rx.recv_timeout(deadline - now) {
                            Ok(()) => {
                                // 有新信号，重置窗口
                                deadline = Instant::now() + Duration::from_millis(500);
                            }
                            Err(mpsc::RecvTimeoutError::Timeout) => break,
                            Err(mpsc::RecvTimeoutError::Disconnected) => return,
                        }
                    }

                    // 窗口结束，emit 一次 file-tree-changed
                    log::debug!(
                        "[TreeDebounce:{}] Emitting {}",
                        project_id,
                        FILE_TREE_CHANGED_EVENT
                    );
                    let _ = app_handle.emit(
                        FILE_TREE_CHANGED_EVENT,
                        &FileTreeChangedEvent {
                            project_id: project_id.clone(),
                        },
                    );
                }
            })
            .expect("Failed to spawn tree-debounce thread");

        Self { tx }
    }
}

// ── GitChangedDebounceSender：git-changed 全量刷新信号节流 ──────────────────────

/// 收到信号后开启 500ms 滑动窗口，窗口内再无新信号则 emit 一次 `git-changed`。
///
/// 第一性原理：增量 diff（`git-status-diff`）已是轻量、完整的主数据源（前端直接
/// patch store，无后端往返）。`git-changed` 只是兼容旧监听的全量刷新 fallback，
/// 每个增量 diff 都触发它会造成 build 期间的全量刷新风暴。这里把全量 fallback
/// 从「每次 diff 一次」降为「每段静默窗口一次」，从根上封顶刷新频率。
#[derive(Clone)]
struct GitChangedDebounceSender {
    tx: Option<mpsc::Sender<()>>,
    // spawn 失败时的降级直发路径（不建线程，避免 Panic 闪退；极端系统故障场景）
    fallback: Option<(String, AppHandle)>,
}

impl GitChangedDebounceSender {
    fn new(project_id: String, app_handle: AppHandle) -> Self {
        let (tx, rx) = mpsc::channel::<()>();

        // spawn 失败降级需要持有 project_id / app_handle（闭包 move 后无法取回）
        let fallback_id = project_id.clone();
        let fallback_handle = app_handle.clone();

        let spawned = std::thread::Builder::new()
            .name(format!("git-changed-debounce-{}", project_id))
            .spawn(move || {
                while let Ok(()) = rx.recv() {
                    // 开始 500ms 滑动窗口：持续收信号就重置 deadline
                    let mut deadline = Instant::now() + Duration::from_millis(500);
                    loop {
                        let now = Instant::now();
                        if now >= deadline {
                            break;
                        }
                        match rx.recv_timeout(deadline - now) {
                            Ok(()) => {
                                // 有新信号，重置窗口
                                deadline = Instant::now() + Duration::from_millis(500);
                            }
                            Err(mpsc::RecvTimeoutError::Timeout) => break,
                            Err(mpsc::RecvTimeoutError::Disconnected) => return,
                        }
                    }

                    // 窗口结束，emit 一次 git-changed（全量刷新 fallback）
                    log::debug!(
                        "[GitChangedDebounce:{}] Emitting {}",
                        project_id,
                        GIT_CHANGED_EVENT
                    );
                    let _ = app_handle.emit(GIT_CHANGED_EVENT, &project_id);
                }
            });

        match spawned {
            Ok(_) => Self {
                tx: Some(tx),
                fallback: None,
            },
            Err(e) => {
                // 线程 spawn 失败属极低概率系统级故障：降级为直发（无节流），
                // 严禁 Panic 闪退——功能可用性优先于节流效果。
                log::error!(
                    "[GitChangedDebounce:{}] Failed to spawn thread: {e}; falling back to direct emit",
                    fallback_id
                );
                Self {
                    tx: None,
                    fallback: Some((fallback_id, fallback_handle)),
                }
            }
        }
    }

    /// 收到一个「有 git 变更」信号。线程正常时走滑动窗口节流；
    /// spawn 失败降级模式下直接 emit（无节流，但保证 fallback 不丢）。
    fn signal(&self) {
        if let Some(tx) = &self.tx {
            let _ = tx.send(());
        } else if let Some((project_id, app_handle)) = &self.fallback {
            let _ = app_handle.emit(GIT_CHANGED_EVENT, project_id);
        }
    }
}

// ── WatcherHandle & WatcherManager ───────────────────────────────────────────

struct WatcherHandle {
    _watcher: RecommendedWatcher,
    _scheduler: ThrottleScheduler,
    // worker clone 保持 alive，与 scheduler 回调中的 clone 共享同一个 worker 线程
    _worker: GitStatusWorker,
    // .git/HEAD 监听器（分支切换检测），单独 watch HEAD 文件绕过 git 忽略过滤
    _head_watcher: Option<RecommendedWatcher>,
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

/// 判断路径是否应该被忽略。
///
/// 第一性原理：与 git 自身行为一致 —— 被 `.gitignore`（含 `.git/info/exclude`）
/// 忽略的路径不产生事件，同时保留两类硬过滤：
/// - `.git` 元数据目录（git 内部文件，HEAD watcher 单独绕过此过滤监听分支切换）
/// - `.DS_Store`（macOS 平台噪声，不属于项目内容）
///
/// 规则在 watcher 启动时编译，`.gitignore` 文件变更时自动重载（见 `reload`）。
#[derive(Clone)]
struct GitIgnoreFilter {
    root: PathBuf,
    rules: Arc<RwLock<Gitignore>>,
}

impl GitIgnoreFilter {
    fn new(root: PathBuf) -> Self {
        let rules = Arc::new(RwLock::new(Gitignore::empty()));
        let filter = Self { root, rules };
        filter.reload();
        filter
    }

    /// 重载忽略规则：读取项目根 `.gitignore` 与 `.git/info/exclude`。
    /// `.gitignore` 自身变更（用户编辑）时由 notify 回调触发。
    fn reload(&self) {
        let mut builder = GitignoreBuilder::new(&self.root);
        // 项目根 .gitignore
        let root_gitignore = self.root.join(".gitignore");
        if root_gitignore.is_file() {
            let _ = builder.add(&root_gitignore);
        }
        // .git/info/exclude（仓库本地忽略规则）
        let info_exclude = self.root.join(".git").join("info").join("exclude");
        if info_exclude.is_file() {
            let _ = builder.add(&info_exclude);
        }
        let built = builder.build().unwrap_or_else(|_| Gitignore::empty());
        if let Ok(mut rules) = self.rules.write() {
            *rules = built;
        }
    }

    /// 路径是否应被忽略（git 语义 + 平台硬过滤）
    fn should_ignore(&self, path: &Path) -> bool {
        if path.components().any(
            |c| matches!(c, std::path::Component::Normal(n) if n == ".git" || n == ".DS_Store"),
        ) {
            return true;
        }
        let is_dir = path.is_dir();
        let matched = self
            .rules
            .read()
            .map(|rules| rules.matched_path_or_any_parents(path, is_dir).is_ignore())
            .unwrap_or(false);
        matched
    }
}

/// 解析仓库 HEAD 文件路径（分支切换检测用）。
/// 普通仓库为 `<repo>/.git/HEAD`；linked worktree 的 `.git` 是指针文件，
/// 内容形如 `gitdir: /path/to/main/.git/worktrees/<name>`，HEAD 位于该目录下。
fn resolve_git_head_path(repo_path: &Path) -> Option<PathBuf> {
    let git_path = repo_path.join(".git");
    if git_path.is_dir() {
        return Some(git_path.join("HEAD"));
    }
    if git_path.is_file() {
        // linked worktree：.git 是指针文件，读取 gitdir 定位真实 HEAD
        let content = std::fs::read_to_string(&git_path).ok()?;
        let gitdir = content
            .lines()
            .find_map(|l| l.trim().strip_prefix("gitdir:"))?
            .trim();
        if gitdir.is_empty() {
            return None;
        }
        return Some(PathBuf::from(gitdir).join("HEAD"));
    }
    None
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
                log::debug!(
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

        // 4b. 创建 HEAD watcher -- 单独监听 .git/HEAD（分支切换），
        // 绕过 git 忽略过滤（该过滤会丢弃 .git 内事件，导致 checkout 后
        // git worker 无法感知分支变化，changes 列表残留旧分支数据）
        // 同时监听 .git/worktrees 目录：linked worktree 内 checkout 会改写
        // `.git/worktrees/<name>/HEAD`，主仓库 .git/HEAD 不变，需一并捕获。
        let head_watcher = resolve_git_head_path(&path).and_then(|head_path| {
            // 判断是否存在 linked worktree（决定是否需要全量 emit 兜底）。
            // 普通仓库无 worktree：主仓库 HEAD 变更走 worker 增量路径即可，
            // 避免 git-changed 全量与 git-status-diff 增量双路径并发。
            let has_worktrees = head_path
                .parent()
                .map(|d| d.join("worktrees").is_dir())
                .unwrap_or(false);
            let head_scheduler_tx = scheduler.sender();
            let pid_head_log = project_id.clone();
            let pid_head_emit = project_id.clone();
            let app_for_head = app_handle.clone();
            let head_result = RecommendedWatcher::new(
                move |result: Result<Event, notify::Error>| {
                    if result.is_ok() {
                        log::debug!(
                            "[Watcher:{}] HEAD changed, triggering git status",
                            pid_head_emit
                        );
                        let _ = head_scheduler_tx.send(());
                        // worktree 场景：HEAD 变更无法区分来源（主仓库 / worktree），
                        // 直接全量刷新兜底，避免 worktree 内切分支残留旧 changes。
                        if has_worktrees {
                            let _ = app_for_head.emit(GIT_CHANGED_EVENT, &pid_head_emit);
                        }
                    }
                },
                Config::default(),
            );
            match head_result {
                Ok(mut head) => {
                    let mut watch_ok = match head.watch(&head_path, RecursiveMode::NonRecursive) {
                        Ok(()) => {
                            log::info!(
                                "[Watcher] Watching HEAD {} for {}",
                                head_path.display(),
                                pid_head_log
                            );
                            true
                        }
                        Err(e) => {
                            log::warn!(
                                "[Watcher] watch HEAD error for {}: {}",
                                head_path.display(),
                                e
                            );
                            false
                        }
                    };
                    // linked worktree 的 HEAD 位于 `<git_dir>/worktrees/<name>/HEAD`
                    if let Some(git_dir) = head_path.parent() {
                        let wt_dir = git_dir.join("worktrees");
                        if wt_dir.is_dir() {
                            match head.watch(&wt_dir, RecursiveMode::Recursive) {
                                Ok(()) => {
                                    log::info!(
                                        "[Watcher] Watching worktree HEAD dir {} for {}",
                                        wt_dir.display(),
                                        pid_head_log
                                    );
                                    watch_ok = true;
                                }
                                Err(e) => {
                                    log::warn!(
                                        "[Watcher] watch worktree HEAD dir error for {}: {}",
                                        wt_dir.display(),
                                        e
                                    );
                                }
                            }
                        }
                    }
                    if watch_ok {
                        Some(head)
                    } else {
                        None
                    }
                }
                Err(e) => {
                    log::warn!(
                        "[Watcher] create HEAD watcher error for {}: {}",
                        head_path.display(),
                        e
                    );
                    None
                }
            }
        });

        // 停止信号（供心跳线程使用）
        let stop = Arc::new(AtomicBool::new(false));

        // 立即触发一次 git status 检查，获取初始状态
        worker.check();

        // 5. 启动心跳线程：每 30s 主动触发一次 git status 检查
        // 作为 notify 在 Windows 下可能丢失事件时的兜底机制
        let heartbeat_worker = worker.clone();
        let heartbeat_stop = stop.clone();
        let heartbeat_pid = project_id.clone();
        let heartbeat = std::thread::Builder::new()
            .name(format!("git-heartbeat-{}", project_id))
            .spawn(move || loop {
                std::thread::sleep(Duration::from_secs(30));
                if heartbeat_stop.load(Ordering::Relaxed) {
                    log::debug!("[Watcher] Heartbeat stopping for {}", heartbeat_pid);
                    break;
                }
                log::debug!("[Watcher] Heartbeat check for {}", heartbeat_pid);
                heartbeat_worker.check();
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

#[cfg(test)]
mod tests {
    use super::*;

    /// 普通仓库：HEAD 位于 `<repo>/.git/HEAD`
    #[test]
    fn resolve_git_head_path_normal_repo() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path();
        let git_dir = repo.join(".git");
        std::fs::create_dir_all(&git_dir).unwrap();
        std::fs::write(git_dir.join("HEAD"), "ref: refs/heads/main\n").unwrap();

        let head = resolve_git_head_path(repo).expect("should resolve HEAD");
        assert_eq!(head, git_dir.join("HEAD"));
    }

    /// linked worktree：`.git` 是指针文件，HEAD 位于 gitdir 指向的目录下
    #[test]
    fn resolve_git_head_path_linked_worktree() {
        let tmp = tempfile::tempdir().unwrap();
        let main_repo = tmp.path().join("main");
        let wt = tmp.path().join("wt");
        let wt_gitdir = main_repo.join(".git").join("worktrees").join("dev");
        std::fs::create_dir_all(&wt_gitdir).unwrap();
        std::fs::write(wt_gitdir.join("HEAD"), "ref: refs/heads/dev\n").unwrap();
        std::fs::create_dir_all(&wt).unwrap();
        std::fs::write(
            wt.join(".git"),
            format!("gitdir: {}\n", wt_gitdir.display()),
        )
        .unwrap();

        let head = resolve_git_head_path(&wt).expect("should resolve worktree HEAD");
        assert_eq!(head, wt_gitdir.join("HEAD"));
    }

    /// 非 git 目录：返回 None
    #[test]
    fn resolve_git_head_path_not_a_repo() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(resolve_git_head_path(tmp.path()).is_none());
    }

    /// 主仓库 + linked worktree 并存：
    /// 主仓库 HEAD 解析到 `.git/HEAD`，且 `.git/worktrees` 目录存在
    /// （HEAD watcher 据此判定需要全量 emit 兜底，覆盖 worktree 场景）。
    #[test]
    fn resolve_git_head_path_with_linked_worktrees() {
        let tmp = tempfile::tempdir().unwrap();
        let main = tmp.path().join("main");
        let main_repo = git2::Repository::init(&main).unwrap();

        // 需要至少一个 commit 才能添加 worktree
        let sig = git2::Signature::now("Test", "test@test.com").unwrap();
        std::fs::write(main.join("README.md"), "# Test\n").unwrap();
        {
            let mut index = main_repo.index().unwrap();
            index.add_path(std::path::Path::new("README.md")).unwrap();
            index.write().unwrap();
            let tree_id = index.write_tree().unwrap();
            let tree = main_repo.find_tree(tree_id).unwrap();
            main_repo
                .commit(Some("HEAD"), &sig, &sig, "Initial commit", &tree, &[])
                .unwrap();
        }

        // 添加 linked worktree（git worktree add 等价操作）
        let wt = tmp.path().join("wt");
        main_repo
            .worktree("dev", &wt, None)
            .expect("should add worktree");

        // 主仓库 HEAD 仍是 `.git/HEAD`
        let main_head = resolve_git_head_path(&main).expect("should resolve main HEAD");
        assert_eq!(main_head, main.join(".git").join("HEAD"));

        // `.git/worktrees` 目录存在 → has_worktrees 判定为 true
        let wt_dir = main.join(".git").join("worktrees");
        assert!(
            wt_dir.is_dir(),
            "linked worktree 应创建 .git/worktrees 目录"
        );

        // linked worktree 的 HEAD 解析到 worktree 专属 gitdir。
        // macOS 上 /var 是 /private/var 符号链接，git2 写入的 gitdir 为 realpath，
        // 比较前先 canonicalize 归一化路径。
        let wt_head = resolve_git_head_path(&wt).expect("should resolve worktree HEAD");
        let wt_head_canon = wt_head.canonicalize().unwrap_or(wt_head.clone());
        let wt_dir_canon = wt_dir.canonicalize().unwrap_or(wt_dir.clone());
        assert!(
            wt_head_canon.starts_with(&wt_dir_canon),
            "worktree HEAD 应位于 .git/worktrees/<name>/HEAD，实际 {}",
            wt_head.display()
        );
        assert!(wt_head.ends_with("HEAD"));
    }

    /// 构建产物目录（dist / build / .next / out / coverage）在 .gitignore 中时
    /// 应被忽略——过滤语义与 git 自身一致，而不是硬编码目录名黑名单。
    #[test]
    fn git_ignore_filter_filters_gitignored_build_output_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path();
        std::fs::write(
            base.join(".gitignore"),
            "dist/\nbuild/\n.next/\nout/\ncoverage/\n",
        )
        .unwrap();

        let filter = GitIgnoreFilter::new(base.to_path_buf());
        assert!(filter.should_ignore(&base.join("dist").join("foo.js")));
        assert!(filter.should_ignore(&base.join("build").join("index.html")));
        assert!(filter.should_ignore(&base.join(".next").join("cache.json")));
        assert!(filter.should_ignore(&base.join("out").join("bundle.js")));
        assert!(filter.should_ignore(&base.join("coverage").join("lcov.info")));

        // 非忽略的兄弟路径仍应通过
        assert!(!filter.should_ignore(&base.join("src").join("main.rs")));
    }

    /// 平台硬过滤：.git / .DS_Store 无论 .gitignore 内容如何都必须忽略。
    #[test]
    fn git_ignore_filter_always_ignores_git_meta_and_ds_store() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path();
        let filter = GitIgnoreFilter::new(base.to_path_buf());

        assert!(filter.should_ignore(&base.join(".git").join("HEAD")));
        assert!(filter.should_ignore(&base.join(".DS_Store")));
    }

    /// 根因修复：名为 dist / out / build 的真实源码目录（未被 .gitignore 忽略）
    /// 不应再被硬编码黑名单误伤——git 语义过滤让它们正常产生事件。
    #[test]
    fn git_ignore_filter_does_not_hide_non_ignored_source_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path();
        // .gitignore 为空：没有任何忽略规则
        std::fs::write(base.join(".gitignore"), "").unwrap();

        let filter = GitIgnoreFilter::new(base.to_path_buf());
        // 这些目录名过去被硬编码黑名单误过滤，现在按 git 语义不应被忽略
        assert!(!filter.should_ignore(&base.join("dist").join("app.ts")));
        assert!(!filter.should_ignore(&base.join("out").join("main.go")));
        assert!(!filter.should_ignore(&base.join("build").join("CMakeLists.txt")));
        // node_modules / target 同样只在 .gitignore 声明时忽略
        assert!(!filter.should_ignore(&base.join("node_modules").join("react")));
        assert!(!filter.should_ignore(&base.join("target").join("debug")));
    }

    /// 用户编辑 .gitignore 后 reload 立即生效。
    #[test]
    fn git_ignore_filter_reloads_after_gitignore_change() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path();
        std::fs::write(base.join(".gitignore"), "").unwrap();
        let filter = GitIgnoreFilter::new(base.to_path_buf());
        assert!(!filter.should_ignore(&base.join("dist").join("foo.js")));

        // 模拟用户向 .gitignore 追加 dist/ 规则
        std::fs::write(base.join(".gitignore"), "dist/\n").unwrap();
        filter.reload();
        assert!(filter.should_ignore(&base.join("dist").join("foo.js")));
    }
}
