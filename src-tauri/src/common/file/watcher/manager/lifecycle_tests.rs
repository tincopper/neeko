//! watcher **生命周期契约**测试（无 GUI）。
//!
//! 为什么必须存在：本次缺陷（2026-09-24）是「切换项目后旧 watcher 不释放」——
//! 单实例实测同项目被 watch 4 次、单次文件变更被 emit 3 次。这类缺陷以前只能靠
//! 人肉看日志发现，**没有 CI 守护就必然回归**；`WatcherEventSink` 抽象正是为了
//! 让下面这些断言可以在无 Tauri 窗口的情况下运行。
//!
//! 断言口径（时间窗比对，不依赖线程数）：
//! - 「有事件」：在 `FIRST_EVENT_TIMEOUT` 内轮询到目标事件；
//! - 「无事件」：记录基线 → 触发变更 → 静默 `QUIET_WINDOW` → 计数不得增长。
//!   `QUIET_WINDOW` 必须大于 debounce 上限（`FILE_CHANGED_MAX_WAIT_MS = 1500`），
//!   否则可能把「还没 flush」误判为「没有事件」。

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

    assert!(touch_and_wait(
        &root,
        "a.txt",
        &sink,
        FILE_CHANGED_EVENT,
        FIRST_EVENT_TIMEOUT
    ));
    std::thread::sleep(QUIET_WINDOW);

    assert_eq!(
        sink.count(FILE_CHANGED_EVENT),
        1,
        "重复 watch 必须幂等：一次写入只应产生 1 条批次（多套 watcher 会成倍投递）"
    );
}

#[test]
fn rewatch_after_unwatch_delivers_exactly_once() {
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

    // 重新 watch：应恰好恢复一套 watcher（既不残留旧的，也不叠加）
    manager.watch("p1".to_string(), root.clone(), sink.clone());
    std::thread::sleep(WATCH_SETTLE);
    let baseline = sink.count(FILE_CHANGED_EVENT);

    std::fs::write(root.join("second.txt"), "x\n").unwrap();
    assert!(
        wait_for_event(&sink, FILE_CHANGED_EVENT, FIRST_EVENT_TIMEOUT),
        "re-watch 后应恢复事件投递"
    );
    std::thread::sleep(QUIET_WINDOW);
    assert_eq!(
        sink.count(FILE_CHANGED_EVENT) - baseline,
        1,
        "re-watch 后一次写入恰好 1 条批次（无旧 watcher 残留）"
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
