//! Throttle / Debounce 线程基建：合并高频 notify 信号，按滑动窗口一次性 emit。

use super::types::{
    FileChangedEvent, FileTreeChangedEvent, FILE_CHANGED_EVENT, FILE_TREE_CHANGED_EVENT,
    GIT_CHANGED_EVENT,
};
use std::{
    path::PathBuf,
    sync::mpsc,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

// ── Throttle 调度器 ───────────────────────────────────────────────────────────

/// Throttle 调度器：收到信号后立即触发一次回调，
/// 执行期间的信号合并，执行完成后若有排队则再触发一次。
pub(super) struct ThrottleScheduler {
    pub(super) tx: mpsc::Sender<()>,
}

impl ThrottleScheduler {
    pub(super) fn new(callback: impl Fn() + Send + 'static) -> Self {
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
    pub(super) fn sender(&self) -> mpsc::Sender<()> {
        self.tx.clone()
    }
}

// ── Debounce sender：收集路径，200ms 无新事件后一次性 emit ────────────────────

/// 通过独立 channel 向 debounce 线程发送变更路径
pub(super) struct DebounceSender {
    pub(super) tx: mpsc::Sender<PathBuf>,
}

impl DebounceSender {
    pub(super) fn new(project_id: String, project_root: PathBuf, app_handle: AppHandle) -> Self {
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
pub(super) struct TreeChangeDebounceSender {
    pub(super) tx: mpsc::Sender<()>,
}

impl TreeChangeDebounceSender {
    pub(super) fn new(project_id: String, app_handle: AppHandle) -> Self {
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
pub(super) struct GitChangedDebounceSender {
    tx: Option<mpsc::Sender<()>>,
    // spawn 失败时的降级直发路径（不建线程，避免 Panic 闪退；极端系统故障场景）
    fallback: Option<(String, AppHandle)>,
}

impl GitChangedDebounceSender {
    pub(super) fn new(project_id: String, app_handle: AppHandle) -> Self {
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
    pub(super) fn signal(&self) {
        if let Some(tx) = &self.tx {
            let _ = tx.send(());
        } else if let Some((project_id, app_handle)) = &self.fallback {
            let _ = app_handle.emit(GIT_CHANGED_EVENT, project_id);
        }
    }
}
