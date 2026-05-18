use crate::git_worker::{GitStatusDiff, GitStatusWorker};
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter};

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

struct WatcherHandle {
    _watcher: RecommendedWatcher,
    _scheduler: ThrottleScheduler,
    // worker clone 保持 alive，与 scheduler 回调中的 clone 共享同一个 worker 线程
    _worker: GitStatusWorker,
    stop_signal: Arc<AtomicBool>,
    // 心跳线程：定期触发 git status 作为 notify 事件丢失时的兜底
    _heartbeat: std::thread::JoinHandle<()>,
}

#[derive(Clone)]
pub struct WatcherManager {
    watchers: Arc<Mutex<HashMap<String, WatcherHandle>>>,
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

        // 3. 创建 notify watcher -- 递归监听 + 路径过滤
        // 从 scheduler 克隆 Sender 传给 notify 闭包
        let scheduler_tx = scheduler.sender();
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
                let relevant = event.paths.iter().any(|p| !should_ignore_path(p));
                log::debug!(
                    "[Watcher:{}] FS event {:?}, paths={:?}, relevant={}",
                    pid_log,
                    event.kind,
                    event.paths,
                    relevant
                );

                if relevant {
                    let _ = scheduler_tx.send(());
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

        // 4. 启动心跳线程：每 30s 主动触发一次 git status 检查
        // 作为 notify 在 Windows 下可能丢失事件时的兜底机制
        let heartbeat_worker = worker.clone();
        let heartbeat_stop = stop.clone();
        let heartbeat_pid = project_id.clone();
        let heartbeat = std::thread::Builder::new()
            .name(format!("git-heartbeat-{}", project_id))
            .spawn(move || {
                loop {
                    std::thread::sleep(Duration::from_secs(30));
                    if heartbeat_stop.load(Ordering::Relaxed) {
                        log::debug!("[Watcher] Heartbeat stopping for {}", heartbeat_pid);
                        break;
                    }
                    log::debug!("[Watcher] Heartbeat check for {}", heartbeat_pid);
                    heartbeat_worker.check();
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
