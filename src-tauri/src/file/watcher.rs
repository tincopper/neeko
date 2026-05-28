use crate::git::worker::{GitStatusDiff, GitStatusWorker};
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

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
                loop {
                    // 阻塞等待第一个信号
                    match rx.recv() {
                        Ok(()) => {}
                        Err(_) => break, // channel 关闭
                    }

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
                                let _ = app_handle.emit("file-changed", &event);
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
                loop {
                    // 阻塞等待第一个结构变更信号
                    match rx.recv() {
                        Ok(()) => {}
                        Err(_) => break,
                    }

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
                    log::debug!("[TreeDebounce:{}] Emitting file-tree-changed", project_id);
                    let _ = app_handle.emit(
                        "file-tree-changed",
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

// ── WatcherHandle & WatcherManager ───────────────────────────────────────────

struct WatcherHandle {
    _watcher: RecommendedWatcher,
    _scheduler: ThrottleScheduler,
    // worker clone 保持 alive，与 scheduler 回调中的 clone 共享同一个 worker 线程
    _worker: GitStatusWorker,
    // file-changed debounce sender（drop 时关闭 channel，结束 debounce 线程）
    _debounce: DebounceSender,
    // file-tree-changed debounce sender（Create/Remove/Rename 事件触发）
    _tree_debounce: TreeChangeDebounceSender,
    stop_signal: Arc<AtomicBool>,
    // 心跳线程：定期触发 git status 作为 notify 事件丢失时的兜底
    _heartbeat: std::thread::JoinHandle<()>,
}

#[derive(Clone)]
pub struct WatcherManager {
    watchers: Arc<Mutex<HashMap<String, WatcherHandle>>>,
}

impl Default for WatcherManager {
    fn default() -> Self {
        Self::new()
    }
}

/// 判断路径是否应该被忽略（.git / node_modules / target / .DS_Store 等）
fn should_ignore_path(path: &Path) -> bool {
    for component in path.components() {
        if let std::path::Component::Normal(name) = component {
            let name_str = name.to_string_lossy();
            if name_str == ".git"
                || name_str == "node_modules"
                || name_str == "target"
                || name_str == ".DS_Store"
            {
                return true;
            }
        }
    }
    false
}

impl WatcherManager {
    pub fn new() -> Self {
        Self {
            watchers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn watch(&self, project_id: String, path: PathBuf, app_handle: AppHandle) {
        let pid_for_legacy = project_id.clone();
        let app_for_diff = app_handle.clone();
        let app_for_legacy = app_handle.clone();

        // 1. 创建 GitStatusWorker -- 有变化时发增量 diff 事件
        let pid_emit = project_id.clone();
        let worker = GitStatusWorker::start(path.clone(), move |mut diff: GitStatusDiff| {
            diff.project_id = pid_emit.clone();
            // 增量 diff 事件
            let _ = app_for_diff.emit("git-status-diff", &diff);
            // 同时发 git-changed 作为 fallback（兼容旧监听）
            let _ = app_for_legacy.emit("git-changed", &pid_for_legacy);
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
        let notify_result = RecommendedWatcher::new(
            move |result: Result<Event, notify::Error>| {
                let event = match result {
                    Ok(ev) => ev,
                    Err(e) => {
                        log::warn!("[Watcher:{}] notify error: {}", pid_log, e);
                        return;
                    }
                };

                // 过滤掉 .git / node_modules / target 等目录内的变更
                let relevant_paths: Vec<PathBuf> = event
                    .paths
                    .iter()
                    .filter(|p| !should_ignore_path(p))
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
                    // 文件树结构变更（新增/删除/重命名）时额外触发 tree-changed 防抖
                    let is_structure_change =
                        matches!(event.kind, EventKind::Create(_) | EventKind::Remove(_));
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
        // 通过 should_ignore_path 过滤掉不需要的目录
        if let Err(e) = watcher.watch(&path, RecursiveMode::Recursive) {
            log::warn!("[Watcher] watch error for {}: {}", path.display(), e);
            return;
        }

        log::info!(
            "[Watcher] Started watching project {} at {}",
            project_id,
            path.display()
        );

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
                    _debounce: debounce,
                    _tree_debounce: tree_debounce,
                    stop_signal: stop,
                    _heartbeat: heartbeat,
                },
            );
        }
    }

    pub fn unwatch(&self, project_id: &str) {
        if let Ok(mut watchers) = self.watchers.lock() {
            if let Some(handle) = watchers.remove(project_id) {
                handle.stop_signal.store(true, Ordering::Relaxed);
            }
        }
    }

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
