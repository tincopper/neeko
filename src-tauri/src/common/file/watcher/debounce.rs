//! Throttle / Debounce 线程基建：合并高频 notify 信号，按滑动窗口一次性 emit。

use super::sink::{WatcherEvent, WatcherEventSink};
use super::types::{FileChangedEvent, FileTreeChangedEvent, FILE_TREE_CHANGED_EVENT};
use crate::common::git::WorkspaceRef;
use std::{
    path::{Path, PathBuf},
    sync::{mpsc, Arc},
    time::{Duration, Instant},
};

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
    pub(super) fn new(repo: WorkspaceRef, sink: Arc<dyn WatcherEventSink>) -> Self {
        let project_id = repo.project_id().to_string();
        let workspace_key = repo.key();
        // 线程名不能用 key（含 NUL 分隔符 → `spawn()` 直接失败），只作诊断标签
        let thread_tag = repo.thread_tag();
        let project_root = repo.root_pathbuf();
        let (tx, rx) = mpsc::channel::<PathBuf>();

        std::thread::Builder::new()
            .name(format!("file-debounce-{thread_tag}"))
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
                                    workspace_key: workspace_key.clone(),
                                    project_id: project_id.clone(),
                                    paths: std::mem::take(&mut buffer),
                                };
                                log::debug!(
                                    "[FileDebounce:{}] Emitting file-changed for {} paths",
                                    project_id,
                                    event.paths.len()
                                );
                                sink.emit(WatcherEvent::FileChanged(&event));
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

/// tree-debounce 通道消息。
///
/// 两条入口共用一个防抖线程：结构变更路径做定向刷新（S2-1：事件携带受影响
/// 目录，前端只重载命中桶），全量刷新请求复用「空 dirs = 前端全树兜底」语义
/// （与 watcher overflow 同款）。
#[derive(Debug, PartialEq)]
pub(super) enum TreeChangeMsg {
    /// 结构变更路径（Create/Remove/Rename 目标的绝对路径）→ 聚合父目录定向刷新。
    Path(PathBuf),
    /// 全量刷新请求（gitignore 规则变化）：ignored 标注只活在读层快照里，
    /// 一条根 `.gitignore` 规则可命中**任意深度**的已有节点，定向重载无法覆盖
    /// → emit 时清空 dirs，前端退回全树刷新。
    FullRefresh,
}

/// 单条消息如何更新聚合状态（父目录集合 / 全量标记）—— 首条、drain、静默窗口
/// 三个消费点共用的**唯一匹配点**；新增 variant 只改这里 + emit 语义。
fn absorb_tree_change(
    msg: TreeChangeMsg,
    dirs: &mut Vec<String>,
    full_refresh: &mut bool,
    project_root: &Path,
) {
    match msg {
        TreeChangeMsg::Path(p) => push_parent_dir(dirs, &p, project_root),
        TreeChangeMsg::FullRefresh => *full_refresh = true,
    }
}

/// 双窗口等待的消息收集版：窗口内持续吸收新消息并更新父目录集合 / 全量标记。
/// 返回 false 表示 channel 已断开。
fn wait_quiet_window_collect_dirs(
    rx: &mpsc::Receiver<TreeChangeMsg>,
    trailing_ms: u64,
    max_wait_ms: u64,
    dirs: &mut Vec<String>,
    full_refresh: &mut bool,
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
            Ok(msg) => {
                deadline = Instant::now() + Duration::from_millis(trailing_ms);
                absorb_tree_change(msg, dirs, full_refresh, project_root);
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

/// 收到变更消息后聚合（路径 → 父目录集合 / 全量标记），双窗口结束后按目录集合
/// emit `file-tree-changed`（S2-1：事件携带受影响目录，前端只重载命中桶，
/// 不再全树重扫）。
pub(super) struct TreeChangeDebounceSender {
    pub(super) tx: mpsc::Sender<TreeChangeMsg>,
}

impl TreeChangeDebounceSender {
    pub(super) fn new(repo: WorkspaceRef, sink: Arc<dyn WatcherEventSink>) -> Self {
        Self::spawn_with_windows(
            repo,
            sink,
            TREE_CHANGED_TRAILING_MS,
            TREE_CHANGED_MAX_WAIT_MS,
        )
    }

    /// 窗口参数显式透传：生产走常量默认，测试注入短窗口避免 500ms 实时等待。
    fn spawn_with_windows(
        repo: WorkspaceRef,
        sink: Arc<dyn WatcherEventSink>,
        trailing_ms: u64,
        max_wait_ms: u64,
    ) -> Self {
        let project_id = repo.project_id().to_string();
        let workspace_key = repo.key();
        // 线程名不能用 key（含 NUL 分隔符 → `spawn()` 直接失败），只作诊断标签
        let thread_tag = repo.thread_tag();
        let project_root = repo.root_pathbuf();
        let (tx, rx) = mpsc::channel::<TreeChangeMsg>();

        std::thread::Builder::new()
            .name(format!("tree-debounce-{thread_tag}"))
            .spawn(move || {
                loop {
                    let first = match rx.recv() {
                        Ok(msg) => msg,
                        // channel 关闭，退出
                        Err(_) => return,
                    };

                    // 收集首条 + 立即 drain 排队项
                    let mut dirs: Vec<String> = Vec::new();
                    let mut full_refresh = false;
                    absorb_tree_change(first, &mut dirs, &mut full_refresh, &project_root);
                    while let Ok(more) = rx.try_recv() {
                        absorb_tree_change(more, &mut dirs, &mut full_refresh, &project_root);
                    }

                    // 双窗口：窗口内继续吸收新消息（滑动 500ms + 最长等待 1.5s）
                    if !wait_quiet_window_collect_dirs(
                        &rx,
                        trailing_ms,
                        max_wait_ms,
                        &mut dirs,
                        &mut full_refresh,
                        &project_root,
                    ) {
                        return;
                    }

                    // 全量请求压过定向集合：规则变化可能让任意深度的 ignored
                    // 标注失效，定向重载无法覆盖 → emit 空 dirs（前端全树兜底）。
                    if full_refresh {
                        log::debug!(
                            "[TreeDebounce:{}] Full refresh requested (gitignore rules changed)",
                            project_id
                        );
                        dirs.clear();
                    } else if dirs.len() > TREE_CHANGED_MAX_DIRS {
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
                    sink.emit(WatcherEvent::TreeChanged(&FileTreeChangedEvent {
                        workspace_key: workspace_key.clone(),
                        project_id: project_id.clone(),
                        dirs,
                    }));
                }
            })
            .expect("Failed to spawn tree-debounce thread");

        Self { tx }
    }
}

#[cfg(test)]
mod tests {
    //! tree-debounce 线程的 emit 语义：定向聚合 / 全量请求压过定向集合。
    //! 窗口参数注入短值（30ms/100ms），断言前留足余量，单条 <300ms。

    use super::*;
    use crate::common::executor::factory::ExecTarget;
    use std::sync::Mutex;
    use std::thread::sleep;

    /// 记录 TreeChanged 载荷的 sink（`CollectingSink` 只记事件名，这里要断言 dirs）。
    struct TreeRecordingSink {
        tree_events: Mutex<Vec<FileTreeChangedEvent>>,
    }

    impl TreeRecordingSink {
        fn new() -> Arc<Self> {
            Arc::new(Self {
                tree_events: Mutex::new(Vec::new()),
            })
        }

        fn tree_events(&self) -> Vec<FileTreeChangedEvent> {
            self.tree_events
                .lock()
                .map(|e| e.clone())
                .unwrap_or_default()
        }
    }

    impl WatcherEventSink for TreeRecordingSink {
        fn emit(&self, event: WatcherEvent<'_>) {
            if let WatcherEvent::TreeChanged(e) = event {
                if let Ok(mut events) = self.tree_events.lock() {
                    events.push(e.clone());
                }
            }
        }
    }

    fn sender_with_short_windows(
        root: &Path,
        sink: Arc<TreeRecordingSink>,
    ) -> TreeChangeDebounceSender {
        let repo = WorkspaceRef::resolve("p1", &root.to_string_lossy(), None, &ExecTarget::Local)
            .expect("tempdir-derived unit path must resolve");
        TreeChangeDebounceSender::spawn_with_windows(repo, sink, 30, 100)
    }

    /// 全量刷新请求必须 emit **空 dirs**（前端全树兜底），不得携带定向目录集。
    #[test]
    fn full_refresh_request_emits_tree_changed_with_empty_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let sink = TreeRecordingSink::new();
        let sender = sender_with_short_windows(root, Arc::clone(&sink));

        sender.tx.send(TreeChangeMsg::FullRefresh).unwrap();
        sleep(Duration::from_millis(300));

        let events = sink.tree_events();
        assert_eq!(
            events.len(),
            1,
            "必须恰好 emit 一次，实际 = {}",
            events.len()
        );
        assert!(
            events[0].dirs.is_empty(),
            "全量请求必须清空 dirs（空 = 前端全树兜底），实际 = {:?}",
            events[0].dirs
        );
    }

    /// 同窗口内全量请求压过定向路径（checkout 风暴场景：.gitignore 与普通文件
    /// 一起落地）——emit 仍必须是空 dirs，且合并为一次。
    #[test]
    fn full_refresh_wins_over_paths_in_same_window() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let sink = TreeRecordingSink::new();
        let sender = sender_with_short_windows(root, Arc::clone(&sink));

        let a = root.join("src").join("a.rs");
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(&a, "").unwrap();
        let a = a.canonicalize().unwrap();
        sender.tx.send(TreeChangeMsg::Path(a)).unwrap();
        sender.tx.send(TreeChangeMsg::FullRefresh).unwrap();
        sleep(Duration::from_millis(300));

        let events = sink.tree_events();
        assert_eq!(events.len(), 1, "同窗口消息必须合并为一次 emit");
        assert!(
            events[0].dirs.is_empty(),
            "全量请求必须压过定向集合，实际 = {:?}",
            events[0].dirs
        );
    }

    /// 回归钉子：纯路径消息的定向聚合语义不变（父目录集合 emit）。
    #[test]
    fn paths_only_still_aggregate_parent_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let sink = TreeRecordingSink::new();
        let sender = sender_with_short_windows(root, Arc::clone(&sink));

        // 真实文件 + 归一后喂入：macOS 的 tempdir 落在 /var → /private/var 符号
        // 链接下，repo 内部已归一（resolve），喂给通道的路径也必须归一，
        // 否则 `push_parent_dir` 的 strip_prefix 落空、dirs 全变 ""。
        // 生产 notify 上报的就是 realpath，归一是忠实模拟，不是测试取巧。
        let a = root.join("src").join("a.rs");
        let b = root.join("src").join("b.rs");
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(&a, "").unwrap();
        std::fs::write(&b, "").unwrap();
        let (a, b) = (a.canonicalize().unwrap(), b.canonicalize().unwrap());

        sender.tx.send(TreeChangeMsg::Path(a)).unwrap();
        sender.tx.send(TreeChangeMsg::Path(b)).unwrap();
        sleep(Duration::from_millis(300));

        let events = sink.tree_events();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].dirs, vec!["src".to_string()]);
    }
}
