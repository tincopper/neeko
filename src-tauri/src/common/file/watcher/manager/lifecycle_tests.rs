//! watcher **生命周期契约**测试（无 GUI）。
//!
//! 为什么必须存在：本次缺陷（2026-09-24）是「切换项目后旧 watcher 不释放」——
//! 单实例实测同项目被 watch 4 次、单次文件变更被 emit 3 次。这类缺陷以前只能靠
//! 人肉看日志发现，**没有 CI 守护就必然回归**；`WatcherEventSink` 抽象正是为了
//! 让下面这些断言可以在无 Tauri 窗口的情况下运行。
//!
//! 断言口径（不依赖线程数与负载时序）：
//! - 「有事件」：在 `FIRST_EVENT_TIMEOUT` 内轮询到目标事件；
//! - 「无事件」：记录基线 → 触发变更 → 静默 `QUIET_WINDOW` → 计数不得增长。
//!   `QUIET_WINDOW` 必须大于 debounce 上限（`FILE_CHANGED_MAX_WAIT_MS = 1500`），
//!   否则可能把「还没 flush」误判为「没有事件」。
//! - 「恰好一套 watcher」：断言 `watcher_set_creations()` 计数，**不断言批次 == 1**
//!   —— 单次写入的多个 FS 事件（Create + Modify Data 等）在负载下可能跨过
//!   debounce 滑动窗口（200ms）分多批投递，这是合法生产行为（前端按批次合并
//!   刷新）；macOS CI（FSEvents + 高负载）实测把「一次写入恰好 1 批」误报为 2
//!   （2026-09-25）。批次计数只用于上面的「无事件」类断言（delta == 0 稳健：
//!   任何增长都是真泄漏）。

use super::WatcherManager;
use crate::common::file::watcher::sink::test_support::CollectingSink;
use crate::common::file::watcher::types::{FILE_CHANGED_EVENT, GIT_STATUS_SNAPSHOT_EVENT};
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

/// notify 注册到 FSEvents 生效需要一点时间（平台有惰性），写文件前留出余量。
const WATCH_SETTLE: Duration = Duration::from_millis(300);
/// 首次事件的宽容上限（git 项目还要等 worker 起 git 子进程）。
const FIRST_EVENT_TIMEOUT: Duration = Duration::from_secs(8);
/// 静默窗口：> debounce 的 max_wait（1.5s），确保"没有事件"是真结论。
const QUIET_WINDOW: Duration = Duration::from_millis(2000);

fn wait_for_event(sink: &Arc<CollectingSink>, name: &str, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if sink.count(name) > 0 {
            return true;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    false
}

/// 触发一次"新增文件"并等待 debounce 收敛；返回是否观察到目标事件。
fn touch_and_wait(
    root: &Path,
    file: &str,
    sink: &Arc<CollectingSink>,
    name: &str,
    timeout: Duration,
) -> bool {
    std::fs::write(root.join(file), "x\n").expect("write probe file");
    wait_for_event(sink, name, timeout)
}

#[test]
fn watch_delivers_file_changed() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().to_path_buf();
    let sink = CollectingSink::new();
    let manager = WatcherManager::new();

    manager.watch("p1".to_string(), root.clone(), sink.clone());
    std::thread::sleep(WATCH_SETTLE);

    assert!(
        touch_and_wait(
            &root,
            "a.txt",
            &sink,
            FILE_CHANGED_EVENT,
            FIRST_EVENT_TIMEOUT
        ),
        "watch 后写入文件必须投递 {FILE_CHANGED_EVENT}（事件出口基线）"
    );
}

#[test]
fn unwatch_stops_delivering_events() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().to_path_buf();
    let sink = CollectingSink::new();
    let manager = WatcherManager::new();

    manager.watch("p1".to_string(), root.clone(), sink.clone());
    std::thread::sleep(WATCH_SETTLE);
    assert!(touch_and_wait(
        &root,
        "before.txt",
        &sink,
        FILE_CHANGED_EVENT,
        FIRST_EVENT_TIMEOUT
    ));

    // 先让 debounce 收敛（滑动窗口 200ms / 上限 1.5s）：避免把"那次写入的尾批次"
    // 误判成"unwatch 之后的事件"（跨平台 FSEvents/inotify 聚合时序不同）。
    std::thread::sleep(QUIET_WINDOW);
    manager.unwatch("p1");
    let baseline = sink.count(FILE_CHANGED_EVENT);

    std::fs::write(root.join("after.txt"), "x\n").unwrap();
    std::thread::sleep(QUIET_WINDOW);

    assert_eq!(
        sink.count(FILE_CHANGED_EVENT),
        baseline,
        "unwatch 之后不得再投递事件（旧 watcher 必须真正停止）"
    );
}

#[test]
fn watch_twice_is_idempotent() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().to_path_buf();
    let sink = CollectingSink::new();
    let manager = WatcherManager::new();

    manager.watch("p1".to_string(), root.clone(), sink.clone());
    manager.watch("p1".to_string(), root.clone(), sink.clone());
    std::thread::sleep(WATCH_SETTLE);

    // 幂等核心契约（确定性断言）：重复 watch 不得创建第二套 watcher。
    // 用创建计数而非批次计数 —— 「一次写入 == 1 条批次」不是代码承诺：单次写入
    // 的多个 FS 事件可跨 debounce 滑动窗口分两批（macOS CI 高负载下实测触发），
    // 前端本就按批次合并刷新。
    assert_eq!(
        manager.watcher_set_creations(),
        1,
        "重复 watch 必须幂等：不得创建第二套 watcher（多套 watcher 会成倍投递并泄漏线程）"
    );

    assert!(
        touch_and_wait(
            &root,
            "a.txt",
            &sink,
            FILE_CHANGED_EVENT,
            FIRST_EVENT_TIMEOUT
        ),
        "重复 watch 后事件投递必须仍然可用"
    );
}

#[test]
fn rewatch_after_unwatch_rebuilds_single_set() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().to_path_buf();
    let sink = CollectingSink::new();
    let manager = WatcherManager::new();

    manager.watch("p1".to_string(), root.clone(), sink.clone());
    std::thread::sleep(WATCH_SETTLE);
    assert!(touch_and_wait(
        &root,
        "first.txt",
        &sink,
        FILE_CHANGED_EVENT,
        FIRST_EVENT_TIMEOUT
    ));

    manager.unwatch("p1");
    std::thread::sleep(WATCH_SETTLE);

    // 重新 watch：应恰好重建一套（unwatch 未注销 → 护栏拦截，计数仍为 1；
    // re-watch 叠加 → 计数为 3；只有恰好重建才是 2）
    manager.watch("p1".to_string(), root.clone(), sink.clone());
    std::thread::sleep(WATCH_SETTLE);
    assert_eq!(
        manager.watcher_set_creations(),
        2,
        "unwatch 必须真正注销，re-watch 必须重建且仅重建一套 watcher"
    );

    std::fs::write(root.join("second.txt"), "x\n").unwrap();
    assert!(
        wait_for_event(&sink, FILE_CHANGED_EVENT, FIRST_EVENT_TIMEOUT),
        "re-watch 后应恢复事件投递"
    );
}

#[test]
fn unwatch_stops_git_worker_snapshots() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().to_path_buf();
    git2::Repository::init(&root).expect("init git repo");
    let sink = CollectingSink::new();
    let manager = WatcherManager::new();

    manager.watch("p1".to_string(), root.clone(), sink.clone());
    assert!(
        wait_for_event(&sink, GIT_STATUS_SNAPSHOT_EVENT, FIRST_EVENT_TIMEOUT),
        "git 项目 watch 后 worker 应产出首个快照"
    );

    manager.unwatch("p1");
    std::thread::sleep(WATCH_SETTLE);
    let baseline = sink.count(GIT_STATUS_SNAPSHOT_EVENT);

    std::fs::write(root.join("new.txt"), "x\n").unwrap();
    std::thread::sleep(QUIET_WINDOW);

    assert_eq!(
        sink.count(GIT_STATUS_SNAPSHOT_EVENT),
        baseline,
        "unwatch 后不得再驱动 git worker（scheduler/worker 线程必须退出）"
    );
}

/// Nit 4：git 项目写入后 `poke_status_worker_and_wait` 必须确认重算落地（true），
/// 且返回时快照注册表已拿到**写后**数据 —— 命令层随后的读接口不再有首刷旧值窗口。
#[test]
fn poke_status_worker_and_wait_confirms_fresh_snapshot_after_write() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().to_path_buf();
    // git 项目（含 .git）：watch 会启动 status worker
    git2::Repository::init(&root).expect("init git repo");
    let sink = CollectingSink::new();
    let manager = WatcherManager::new();

    manager.watch("p1".to_string(), root.clone(), sink.clone());

    std::fs::write(root.join("tracked.txt"), "x\n").unwrap();
    assert!(
        manager.poke_status_worker_and_wait("p1", FIRST_EVENT_TIMEOUT),
        "git 项目的写后 poke 必须在时限内确认重算落地"
    );
    let snap = manager.snapshot("p1").expect("重算落地后快照必须存在");
    assert_eq!(
        snap.entries.len(),
        1,
        "快照必须反映写后工作区（首刷旧值窗口已消除）"
    );
}

/// 非 git 项目没有 status worker → poke 直接返回 false（空操作语义不变）。
#[test]
fn poke_status_worker_and_wait_is_noop_for_non_git_project() {
    let tmp = tempfile::tempdir().unwrap();
    let sink = CollectingSink::new();
    let manager = WatcherManager::new();
    manager.watch("p1".to_string(), tmp.path().to_path_buf(), sink.clone());
    assert!(
        !manager.poke_status_worker_and_wait("p1", Duration::from_secs(1)),
        "非 git 项目无 worker，必须返回 false"
    );
}
