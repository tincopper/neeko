//! Throttle / Debounce 线程基建：合并高频 notify 信号，按滑动窗口一次性 emit。

use super::types::{
    FileChangedEvent, FileTreeChangedEvent, FILE_CHANGED_EVENT, FILE_TREE_CHANGED_EVENT,
    GIT_CHANGED_EVENT,
};
use std::{
    path::{Path, PathBuf},
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

// ── Debounce sender：收集路径，双窗口后一次性 emit ────────────────────────────

/// 滑动窗口：持续事件不断顺延；maxWait：自首条事件起最长等待，保证风暴下仍会执行
/// （纯滑动窗口在无限事件流中会饿死、永不 emit）。
const FILE_CHANGED_TRAILING_MS: u64 = 200;
const FILE_CHANGED_MAX_WAIT_MS: u64 = 1500;
/// 路径缓冲上限（公理：一切随输入规模增长的结构必须有界）。
const FILE_CHANGED_MAX_PATHS: usize = 5000;

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
                let mut first_at: Option<Instant> = None;

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
                            // 双窗口：滑动窗口与 maxWait 截止取较早者
                            let first = *first_at.get_or_insert_with(Instant::now);
                            let sliding =
                                Instant::now() + Duration::from_millis(FILE_CHANGED_TRAILING_MS);
                            let max_deadline =
                                first + Duration::from_millis(FILE_CHANGED_MAX_WAIT_MS);
                            deadline = Some(sliding.min(max_deadline));
                            // 缓冲封顶：达到上限立即触发下一轮 flush（只短暂超限一条）
                            if buffer.len() >= FILE_CHANGED_MAX_PATHS {
                                deadline = Some(Instant::now());
                            }
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
                            first_at = None;
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

// ── 信号型双窗口背压（tree-changed / git-changed 共用）──────────────────────

/// 双窗口等待：trailing 滑动窗口（持续信号不断顺延）+ maxWait 背压上限
/// （自窗口开始起最长等待，保证无限事件流下仍会执行、不饿死）。
/// 返回 false 表示 channel 已断开，调用方应退出线程。
fn wait_quiet_window(rx: &mpsc::Receiver<()>, trailing_ms: u64, max_wait_ms: u64) -> bool {
    let window_start = Instant::now();
    let mut deadline = window_start + Duration::from_millis(trailing_ms);
    let max_deadline = window_start + Duration::from_millis(max_wait_ms);
    loop {
        let now = Instant::now();
        if now >= deadline || now >= max_deadline {
            return true;
        }
        match rx.recv_timeout(deadline.min(max_deadline) - now) {
            // 有新信号：重置滑动窗口
            Ok(()) => deadline = Instant::now() + Duration::from_millis(trailing_ms),
            Err(mpsc::RecvTimeoutError::Timeout) => return true,
            Err(mpsc::RecvTimeoutError::Disconnected) => return false,
        }
    }
}

/// 记录变更路径所属的父目录（相对项目根，`/` 分隔，'' 表示根本身）。
fn push_parent_dir(dirs: &mut Vec<String>, path: &std::path::Path, project_root: &Path) {
    let rel_dir = path
        .parent()
        .and_then(|p| p.strip_prefix(project_root).ok())
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();
    if !dirs.iter().any(|d| d == &rel_dir) {
        dirs.push(rel_dir);
    }
}

/// 双窗口等待的路径收集版：窗口内持续吸收新路径并更新父目录集合。
/// 返回 false 表示 channel 已断开。
fn wait_quiet_window_collect_dirs(
    rx: &mpsc::Receiver<PathBuf>,
    trailing_ms: u64,
    max_wait_ms: u64,
    dirs: &mut Vec<String>,
    project_root: &Path,
) -> bool {
    let window_start = Instant::now();
    let mut deadline = window_start + Duration::from_millis(trailing_ms);
    let max_deadline = window_start + Duration::from_millis(max_wait_ms);
    loop {
        let now = Instant::now();
        if now >= deadline || now >= max_deadline {
            return true;
        }
        match rx.recv_timeout(deadline.min(max_deadline) - now) {
            Ok(path) => {
                deadline = Instant::now() + Duration::from_millis(trailing_ms);
                push_parent_dir(dirs, &path, project_root);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => return true,
            Err(mpsc::RecvTimeoutError::Disconnected) => return false,
        }
    }
}

const TREE_CHANGED_TRAILING_MS: u64 = 500;
const TREE_CHANGED_MAX_WAIT_MS: u64 = 1500;

/// 受影响目录集合上限：超过则清空集合（= 全量兜底信号），避免事件 payload 无界。
const TREE_CHANGED_MAX_DIRS: usize = 64;

// ── TreeChangeDebounceSender：文件树结构变更防抖（Create/Remove/Rename） ───────

/// 收到变更路径后收集其父目录，双窗口结束后按目录集合 emit `file-tree-changed`
/// （S2-1：事件携带受影响目录，前端只重载命中桶，不再全树重扫）。
pub(super) struct TreeChangeDebounceSender {
    pub(super) tx: mpsc::Sender<PathBuf>,
}

impl TreeChangeDebounceSender {
    pub(super) fn new(project_id: String, project_root: PathBuf, app_handle: AppHandle) -> Self {
        let (tx, rx) = mpsc::channel::<PathBuf>();

        std::thread::Builder::new()
            .name(format!("tree-debounce-{}", project_id))
            .spawn(move || {
                loop {
                    let first = match rx.recv() {
                        Ok(p) => p,
                        // channel 关闭，退出
                        Err(_) => return,
                    };

                    // 收集首条 + 立即 drain 排队项的父目录
                    let mut dirs: Vec<String> = Vec::new();
                    push_parent_dir(&mut dirs, &first, &project_root);
                    while let Ok(more) = rx.try_recv() {
                        push_parent_dir(&mut dirs, &more, &project_root);
                    }

                    // 双窗口：窗口内继续吸收新路径（滑动 500ms + 最长等待 1.5s）
                    if !wait_quiet_window_collect_dirs(
                        &rx,
                        TREE_CHANGED_TRAILING_MS,
                        TREE_CHANGED_MAX_WAIT_MS,
                        &mut dirs,
                        &project_root,
                    ) {
                        return;
                    }

                    if dirs.len() > TREE_CHANGED_MAX_DIRS {
                        log::debug!(
                            "[TreeDebounce:{}] {} affected dirs exceed cap, sending full refresh",
                            project_id,
                            dirs.len()
                        );
                        dirs.clear();
                    }

                    // 窗口结束，emit 一次携带目录集的 file-tree-changed
                    log::debug!(
                        "[TreeDebounce:{}] Emitting {} ({} dirs)",
                        project_id,
                        FILE_TREE_CHANGED_EVENT,
                        dirs.len()
                    );
                    let _ = app_handle.emit(
                        FILE_TREE_CHANGED_EVENT,
                        &FileTreeChangedEvent {
                            project_id: project_id.clone(),
                            dirs,
                        },
                    );
                }
            })
            .expect("Failed to spawn tree-debounce thread");

        Self { tx }
    }
}

// ── GitChangedDebounceSender：git-changed 全量刷新信号节流 ──────────────────────

const GIT_CHANGED_TRAILING_MS: u64 = 500;
const GIT_CHANGED_MAX_WAIT_MS: u64 = 2000;

/// 收到信号后开启双窗口（滑动 500ms + 最长等待 2s），结束后 emit 一次 `git-changed`。
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
                    if !wait_quiet_window(&rx, GIT_CHANGED_TRAILING_MS, GIT_CHANGED_MAX_WAIT_MS) {
                        return;
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
