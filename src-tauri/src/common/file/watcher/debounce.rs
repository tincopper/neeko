//! Throttle / Debounce 线程基建：合并高频 notify 信号，按滑动窗口一次性 emit。

use super::types::{
    FileChangedEvent, FileTreeChangedEvent, FILE_CHANGED_EVENT, FILE_TREE_CHANGED_EVENT,
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

// ── 路径型双窗口背压（tree-changed 共用）─────────────────────────────────────

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
