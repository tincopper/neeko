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
use crate::common::executor::factory::ExecTarget;
use crate::common::file::watcher::sink::test_support::CollectingSink;
use crate::common::file::watcher::types::{FILE_CHANGED_EVENT, GIT_STATUS_SNAPSHOT_EVENT};
use crate::common::git::status_worker::{parse_porcelain, GitStatusSnapshot};
use crate::common::git::RepoRef;
use crate::common::types::FileStatus;
use crate::core::exec::collect_blocking;
use crate::project::types::FileChange;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// notify 注册到 FSEvents 生效需要一点时间（平台有惰性），写文件前留出余量。
const WATCH_SETTLE: Duration = Duration::from_millis(300);
/// 首次事件的宽容上限（git 项目还要等 worker 起 git 子进程）。
const FIRST_EVENT_TIMEOUT: Duration = Duration::from_secs(8);
/// 静默窗口：> debounce 的 max_wait（1.5s），确保"没有事件"是真结论。
const QUIET_WINDOW: Duration = Duration::from_millis(2000);

/// 被测仓库单元 = 主仓形态（Local）。
///
/// 走 `RepoRef::resolve` 而不是 `RepoRef::main`：与生产构造入口一致，拿到 canonical
/// 工作目录（macOS 的 `tempdir()` 位于 `/var → /private/var` 符号链接下，非 canonical
/// 形态会让 watcher 路径与事件路径分叉）。
fn main_unit(root: &Path) -> RepoRef {
    RepoRef::resolve("p1", &root.to_string_lossy(), None, &ExecTarget::Local)
        .expect("tempdir-derived unit path must resolve")
}

/// 被测仓库单元 = linked worktree 形态（同一 project 的第二个单元）。
///
/// 参数只要求"两个不同工作目录"，因此单元身份类断言既可搭在真实 linked worktree 上
/// （[`repo_with_linked_worktree`]），也可搭在两个独立 checkout 上（本文件既有夹具）。
/// 需要「写入不得泄漏到别的单元」这类**可证伪**断言时用前者。
fn worktree_unit(root: &Path, worktree: &Path) -> RepoRef {
    RepoRef::resolve(
        "p1",
        &root.to_string_lossy(),
        Some(&worktree.to_string_lossy()),
        &ExecTarget::Local,
    )
    .expect("tempdir-derived unit path must resolve")
}

/// 在 `dir` 下跑一条 git 命令，断言成功并回传 stdout。
///
/// 走 `core::exec` 统一命令接口（红线 1）而非 `std::process::Command`：与生产 status
/// 路径同一入口，夹具因此也吃到 facade 的 git 只读语义注入。
fn git_in(dir: &Path, args: &[&str]) -> String {
    let dir = dir.to_string_lossy().to_string();
    let mut full = vec!["-C", dir.as_str()];
    full.extend_from_slice(args);
    let output = collect_blocking(&ExecTarget::Local, "git", &full).expect("spawn git");
    assert_eq!(
        output.exit_code,
        0,
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).into_owned()
}

/// 条目集合的路径序列（「该单元只看自己的变更」这类断言的可读形态）。
fn paths_of(entries: &[FileChange]) -> Vec<&Path> {
    entries.iter().map(|entry| entry.path.as_path()).collect()
}

/// pull 生产者的测试夹具：绑定到 `unit` 的一份快照（branch = "main"、ahead/behind = 0）。
///
/// `record_computed` 的入参是**完整快照**（与 push 生产者同形），因此测试也按快照构造，
/// 而不是一串展开的参数（后者会把「同一份快照的不同字段」在调用点摊成多个位置参数）。
fn pull_snapshot(unit: &RepoRef, entries: Vec<FileChange>) -> GitStatusSnapshot {
    let mut snap = GitStatusSnapshot::for_unit(unit, 0);
    snap.entries = entries;
    snap.branch = "main".to_string();
    snap
}

/// 真实 linked worktree 夹具：主仓（含 1 次提交）+ `git worktree add` 的第二工作树。
///
/// 为什么不用「两个独立 `git2::Repository::init`」（本文件其余夹具的形态）：那条路下
/// 「主仓看不到 worktree 的写入」是**夹具保证**的，不是 git 保证的。真实 worktree 共享
/// object DB、只让 HEAD / index / workdir 各自独立，「无跨单元泄漏」才是可证伪的事实。
///
/// 两个目录刻意**同级**：worktree 若嵌在主仓工作树内，主仓 `git status` 会把它当成未
/// 跟踪目录条目报出来，污染「主仓仍干净」这条断言。
/// 路径全部由 `tempdir()` 派生（红线 13）；断言只打在 git 归一化视图（status）上，
/// 不碰工作区字节（红线 11）。
fn repo_with_linked_worktree(tmp: &Path) -> (PathBuf, PathBuf) {
    let main = tmp.join("repo");
    std::fs::create_dir_all(&main).expect("create main repo dir");
    crate::common::testing::init_git_repo(&main);
    let worktree = tmp.join("repo-wt");
    git_in(
        &main,
        &[
            "worktree",
            "add",
            "-b",
            "feature",
            &worktree.to_string_lossy(),
        ],
    );
    (main, worktree)
}

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

/// 等待某事件计数**超过**基线（用于「必须真的又推送了一次」这类断言）。
fn wait_for_more_events(
    sink: &Arc<CollectingSink>,
    name: &str,
    baseline: usize,
    timeout: Duration,
) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if sink.count(name) > baseline {
            return true;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    false
}

/// 轮询到该单元快照的条目里出现 `file` 为止。
///
/// 为什么按「最终与 git 真值一致」轮询而不是一次读取：一次写入的多个 FS 事件在负载下可以
/// 跨 debounce 窗口分多批重算（本文件头注的口径），批次数量不是契约；把断言压在「第 N 次
/// 推送恰好包含全部改动」上就是造 flaky 测试。
fn wait_for_entry(
    manager: &WatcherManager,
    unit: &RepoRef,
    file: &str,
    timeout: Duration,
) -> Arc<GitStatusSnapshot> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(snap) = manager.snapshot(unit) {
            if paths_of(&snap.entries).contains(&Path::new(file)) {
                return snap;
            }
        }
        assert!(
            Instant::now() < deadline,
            "超时仍未在单元 {} 的快照里看到 {file}：当前条目={:?}",
            unit.key(),
            manager.snapshot(unit).map(|snap| snap
                .entries
                .iter()
                .map(|e| e.path.display().to_string())
                .collect::<Vec<_>>()),
        );
        std::thread::sleep(Duration::from_millis(25));
    }
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

    manager.watch(main_unit(&root), sink.clone());
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

    manager.watch(main_unit(&root), sink.clone());
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
    manager.unwatch(&main_unit(&root));
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

    manager.watch(main_unit(&root), sink.clone());
    manager.watch(main_unit(&root), sink.clone());
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

    manager.watch(main_unit(&root), sink.clone());
    std::thread::sleep(WATCH_SETTLE);
    assert!(touch_and_wait(
        &root,
        "first.txt",
        &sink,
        FILE_CHANGED_EVENT,
        FIRST_EVENT_TIMEOUT
    ));

    manager.unwatch(&main_unit(&root));
    std::thread::sleep(WATCH_SETTLE);

    // 重新 watch：应恰好重建一套（unwatch 未注销 → 护栏拦截，计数仍为 1；
    // re-watch 叠加 → 计数为 3；只有恰好重建才是 2）
    manager.watch(main_unit(&root), sink.clone());
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

    manager.watch(main_unit(&root), sink.clone());
    assert!(
        wait_for_event(&sink, GIT_STATUS_SNAPSHOT_EVENT, FIRST_EVENT_TIMEOUT),
        "git 项目 watch 后 worker 应产出首个快照"
    );

    manager.unwatch(&main_unit(&root));
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

    let unit = main_unit(&root);
    manager.watch(unit.clone(), sink.clone());

    std::fs::write(root.join("tracked.txt"), "x\n").unwrap();
    assert!(
        manager.poke_status_worker_and_wait(&unit, FIRST_EVENT_TIMEOUT),
        "git 项目的写后 poke 必须在时限内确认重算落地"
    );
    let snap = manager.snapshot(&unit).expect("重算落地后快照必须存在");
    assert_eq!(
        snap.entries.len(),
        1,
        "快照必须反映写后工作区（首刷旧值窗口已消除）"
    );
    assert_eq!(
        snap.repo_key,
        unit.key(),
        "快照必须自带单元身份，否则前端无法寻址"
    );
}

/// 非 git 项目没有 status worker → poke 直接返回 false（空操作语义不变）。
#[test]
fn poke_status_worker_and_wait_is_noop_for_non_git_project() {
    let tmp = tempfile::tempdir().unwrap();
    let sink = CollectingSink::new();
    let manager = WatcherManager::new();
    let unit = main_unit(tmp.path());
    manager.watch(unit.clone(), sink.clone());
    assert!(
        !manager.poke_status_worker_and_wait(&unit, Duration::from_secs(1)),
        "非 git 项目无 worker，必须返回 false"
    );
}

/// **单元维度**（本次身份补全的核心契约）：同一 project 的两个工作树各自挂载、
/// 各自产出快照，互不覆盖。旧实现按 project_id 共槽 —— 在 worktree 里写完戳的是
/// 主仓的 worker（status 没变 → 闸门吞掉 → 什么都不更新），且两个视图共用一个槽
/// （worktree 列表串主仓内容）。
#[test]
fn two_units_of_one_project_keep_independent_snapshots() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("repo");
    let worktree = tmp.path().join("repo-wt");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::create_dir_all(&worktree).unwrap();
    // 两个单元各自是独立工作树（HEAD / index / workdir 全都独立 —— 与 linked
    // worktree 的 git 语义一致，这里用两个 checkout 保持夹具确定性）。
    git2::Repository::init(&root).expect("init main repo");
    git2::Repository::init(&worktree).expect("init worktree repo");

    let main_unit = main_unit(&root);
    let wt_unit = worktree_unit(&root, &worktree);
    assert_ne!(
        main_unit.key(),
        wt_unit.key(),
        "夹具前提：两个单元必须是两个不同身份"
    );

    let sink = CollectingSink::new();
    let manager = WatcherManager::new();
    manager.watch(main_unit.clone(), sink.clone());
    manager.watch(wt_unit.clone(), sink.clone());
    assert_eq!(
        manager.watcher_set_creations(),
        2,
        "两个单元各自一套资源（同 project_id 不得被幂等护栏合并）"
    );

    std::fs::write(root.join("main-only.txt"), "x\n").unwrap();
    std::fs::write(worktree.join("wt-only.txt"), "x\n").unwrap();
    assert!(
        manager.poke_status_worker_and_wait(&main_unit, FIRST_EVENT_TIMEOUT),
        "主仓单元 poke 必须落地"
    );
    assert!(
        manager.poke_status_worker_and_wait(&wt_unit, FIRST_EVENT_TIMEOUT),
        "worktree 单元 poke 必须落地"
    );

    let main_snap = manager.snapshot(&main_unit).expect("主仓快照必须存在");
    let wt_snap = manager.snapshot(&wt_unit).expect("worktree 快照必须存在");
    assert_eq!(main_snap.entries.len(), 1, "主仓只应看到自己的变更");
    assert_eq!(wt_snap.entries.len(), 1, "worktree 只应看到自己的变更");
    assert_eq!(main_snap.entries[0].path, Path::new("main-only.txt"));
    assert_eq!(wt_snap.entries[0].path, Path::new("wt-only.txt"));
    assert_eq!(main_snap.worktree_path, None);
    assert_eq!(wt_snap.worktree_path.as_deref(), wt_unit.worktree_path());
    assert_eq!(main_snap.project_id, "p1");
    assert_eq!(wt_snap.project_id, "p1");
}

/// 未挂载 = 未知，不得读成旧数据：`unwatch` 必须作废该单元快照；且只能作废自己那一个。
#[test]
fn unwatch_drops_only_that_unit_snapshot() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("repo");
    let worktree = tmp.path().join("repo-wt");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::create_dir_all(&worktree).unwrap();
    git2::Repository::init(&root).expect("init main repo");
    git2::Repository::init(&worktree).expect("init worktree repo");

    let main_unit = main_unit(&root);
    let wt_unit = worktree_unit(&root, &worktree);
    let sink = CollectingSink::new();
    let manager = WatcherManager::new();
    manager.watch(main_unit.clone(), sink.clone());
    manager.watch(wt_unit.clone(), sink.clone());

    std::fs::write(root.join("main-only.txt"), "x\n").unwrap();
    std::fs::write(worktree.join("wt-only.txt"), "x\n").unwrap();
    assert!(manager.poke_status_worker_and_wait(&main_unit, FIRST_EVENT_TIMEOUT));
    assert!(manager.poke_status_worker_and_wait(&wt_unit, FIRST_EVENT_TIMEOUT));
    // 让主仓槽位再前进一轮：这样「重新挂载后必须拿到更大的号」才是新盖章的证据
    // （号段跨挂载单调，切走前的水位就是残留槽位的指纹）。
    std::fs::write(root.join("second-main-change.txt"), "y\n").unwrap();
    assert!(manager.poke_status_worker_and_wait(&main_unit, FIRST_EVENT_TIMEOUT));
    let stale_version = manager.snapshot(&main_unit).expect("主仓快照").version;
    assert!(
        stale_version >= 2,
        "夹具前提：主仓槽位已推进到 v{stale_version}"
    );

    manager.unwatch(&main_unit);
    assert!(
        manager.snapshot(&main_unit).is_none(),
        "unwatch 后残留快照会被当成权威数据渲染（必须作废）"
    );
    assert!(
        !manager.is_watched(&main_unit),
        "unwatch 必须摘掉该单元的挂载"
    );
    assert!(
        manager.snapshot(&wt_unit).is_some(),
        "unwatch 一个单元不得影响同项目的另一个单元"
    );
    assert!(manager.is_watched(&wt_unit));
    assert_eq!(manager.watched_units(), vec![wt_unit.key()]);

    // 重新挂载主仓单元：切走期间的变更要么还没进槽（= 未知，合法），要么进来的是**重算后**
    // 的数据 —— 唯独不能是切走前那份旧快照（未挂载期间没有任何生产者，残留即伪权威）。
    // 判据取「version 严格大于切走前的水位」：号段跨挂载单调（`version_floors`），残留槽位的
    // 号不可能变大，所以比得上就是新盖章的那一份。
    std::fs::write(root.join("added-while-unmounted.txt"), "x\n").unwrap();
    manager.watch(main_unit.clone(), sink.clone());
    match manager.snapshot(&main_unit) {
        None => {}
        Some(snap) => {
            assert!(
                snap.version > stale_version,
                "重新挂载后必须拿到比切走前更新的号；v{} 不大于切走前的 v{} ⇒ 读到的仍是残留槽位",
                snap.version,
                stale_version
            );
            assert!(
                paths_of(&snap.entries).contains(&Path::new("added-while-unmounted.txt")),
                "重新挂载后读到的是切走前的残留快照（串内容的形态）：{:?}",
                paths_of(&snap.entries)
            );
        }
    }
}

/// 项目被移除时必须释放该项目下**所有**单元（旧实现只有 project 粒度，天然覆盖；
/// 身份补全后这里是唯一还能把两个单元一起收口的入口）。
#[test]
fn unwatch_project_releases_every_unit_of_that_project() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("repo");
    let worktree = tmp.path().join("repo-wt");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::create_dir_all(&worktree).unwrap();
    git2::Repository::init(&root).expect("init main repo");
    git2::Repository::init(&worktree).expect("init worktree repo");

    let main_unit = main_unit(&root);
    let wt_unit = worktree_unit(&root, &worktree);
    let sink = CollectingSink::new();
    let manager = WatcherManager::new();
    manager.watch(main_unit.clone(), sink.clone());
    manager.watch(wt_unit.clone(), sink.clone());
    assert_eq!(manager.watched_units().len(), 2);

    std::fs::write(root.join("main-only.txt"), "x\n").unwrap();
    std::fs::write(worktree.join("wt-only.txt"), "x\n").unwrap();
    assert!(manager.poke_status_worker_and_wait(&wt_unit, FIRST_EVENT_TIMEOUT));

    manager.unwatch_project("p1");
    assert!(
        manager.watched_units().is_empty(),
        "同项目的所有单元必须一起释放"
    );
    assert!(manager.snapshot(&main_unit).is_none());
    assert!(
        manager.snapshot(&wt_unit).is_none(),
        "unwatch_project 不得留下任何单元的快照"
    );

    // 其他项目的单元不受影响
    let other = tmp.path().join("other");
    std::fs::create_dir_all(&other).unwrap();
    git2::Repository::init(&other).expect("init other repo");
    let other_unit =
        RepoRef::resolve("p2", &other.to_string_lossy(), None, &ExecTarget::Local).unwrap();
    manager.watch(other_unit.clone(), sink.clone());
    manager.unwatch_project("p1");
    assert!(
        manager.is_watched(&other_unit),
        "unwatch_project(p1) 不得波及其他项目"
    );
    manager.unwatch_project("p2");
    assert!(manager.watched_units().is_empty());
}

/// **AC3（PRD · 后端侧）**：写操作后的 poke 必须打在**被写入的那个单元**上。
///
/// 决策 D-B 下每个项目同时至多一套挂载资源，所以这里按生产形态表达「切换视图」：
/// 挂 A（主仓）→ 在 A 内写 → `poke(A)`；`unwatch(A)` 换挂 B（同一项目的 linked
/// worktree）→ 在 B 内写 → `poke(B)`。
///
/// 钉住的缺陷形态：poke 按 `project_id` 取 worker ⇒ 在 worktree 里 stage / discard
/// 戳的是**主仓**的 worker，主仓 porcelain 一字未变 → 查询-比较闸门判定「无变化」→
/// 什么都不更新 → 列表必须手动刷新才动。因此断言不止「poke 返回 true」—— true 只
/// 说明有一轮重算落地，真正的事实是 **B 的槽里出现了 B 自己的写入**。
#[test]
fn poke_after_unit_switch_recomputes_the_unit_that_was_written() {
    let tmp = tempfile::tempdir().unwrap();
    let (main, worktree) = repo_with_linked_worktree(tmp.path());
    let unit_a = main_unit(&main);
    let unit_b = worktree_unit(&main, &worktree);
    assert_ne!(unit_a.key(), unit_b.key(), "夹具前提：两个单元两个身份");

    let sink = CollectingSink::new();
    let manager = WatcherManager::new();

    // ── 阶段 1：当前视图 = 主仓单元 A
    manager.watch(unit_a.clone(), sink.clone());
    std::fs::write(main.join("main-only.txt"), "x\n").unwrap();
    assert!(
        manager.poke_status_worker_and_wait(&unit_a, FIRST_EVENT_TIMEOUT),
        "A 挂载时 poke(A) 必须有一轮重算落地"
    );
    let snap_a = manager
        .snapshot(&unit_a)
        .expect("poke 落地后 A 必须有权威快照");
    assert_eq!(snap_a.repo_key, unit_a.key());
    assert_eq!(
        paths_of(&snap_a.entries),
        vec![Path::new("main-only.txt")],
        "A 的快照必须是 A 自己的写入"
    );

    // ── 阶段 2：切换视图 —— 释放 A，挂载同一项目的 linked worktree 单元 B
    manager.unwatch(&unit_a);
    manager.watch(unit_b.clone(), sink.clone());
    assert!(
        manager.snapshot(&unit_a).is_none(),
        "切走后 A 必须是「未知」，不得留旧数据被当成权威渲染"
    );

    std::fs::write(worktree.join("worktree-only.txt"), "x\n").unwrap();
    assert!(
        manager.poke_status_worker_and_wait(&unit_b, FIRST_EVENT_TIMEOUT),
        "poke(B) 必须打到 B 自己的 worker（旧缺陷：戳主仓 worker → 闸门吞掉重算）"
    );
    let snap_b = manager
        .snapshot(&unit_b)
        .expect("worktree 单元必须有快照（旧缺陷：worktree 视图压根没有生产者）");
    assert_eq!(
        snap_b.repo_key,
        unit_b.key(),
        "快照必须落在 worktree 单元的槽上"
    );
    assert_eq!(snap_b.worktree_path.as_deref(), unit_b.worktree_path());
    assert_eq!(
        paths_of(&snap_b.entries),
        vec![Path::new("worktree-only.txt")],
        "必须是相对 worktree 根的 B 自己的写入，不得串主仓内容"
    );

    // 未挂载的 A 不得被同项目的 poke 顺带产出快照，也没有 worker 可戳
    assert!(
        manager.snapshot(&unit_a).is_none(),
        "poke(B) 不得给未挂载的 A 产出快照（跨单元泄漏）"
    );
    assert!(
        !manager.poke_status_worker_and_wait(&unit_a, Duration::from_millis(200)),
        "未挂载单元没有 worker，poke 必须返回 false，而不是替别的单元重算"
    );

    // git 视角无泄漏：主仓仍然只认自己那次写入
    let main_porcelain = git_in(&main, &["status", "--porcelain"]);
    assert_eq!(
        paths_of(&parse_porcelain(&main_porcelain)),
        vec![Path::new("main-only.txt")],
        "worktree 内的写入不得出现在主仓 git 视角：{main_porcelain:?}"
    );
}

/// **AC4（PRD · 自动化项）**：linked worktree 工作目录内的变更（新增 + 删除跟踪文件）
/// 必须在**无手动 poke** 的情况下推进该单元快照的 `version` 并推送出去。
///
/// 与 [`poke_after_unit_switch_recomputes_the_unit_that_was_written`] 的分工：那条钉的是
/// 「poke 打对单元」（写命令后的同步收口），这条钉的是「编辑即推送」（生产链路的自动路径：
/// notify → throttle scheduler → worker）。原缺陷正是这条链路对 worktree 视图**根本不存在**
/// ——worktree 没有自己的 worker，所以列表"总是不可见"，只能靠手动刷新。
///
/// 同时钉住「挂载即有权威数据」：worker 首轮一定 emit（折叠目录摘要起始为未知 ⇒ 闸门放行），
/// 所以干净 worktree 也会在挂载后立刻拿到首个快照 —— 未挂载才是「未知」，已挂载不是。
#[test]
fn linked_worktree_edit_pushes_versioned_snapshot_without_manual_poke() {
    let tmp = tempfile::tempdir().unwrap();
    let (main, worktree) = repo_with_linked_worktree(tmp.path());
    let unit_b = worktree_unit(&main, &worktree);

    let sink = CollectingSink::new();
    let manager = WatcherManager::new();
    manager.watch(unit_b.clone(), sink.clone());
    assert!(
        wait_for_event(&sink, GIT_STATUS_SNAPSHOT_EVENT, FIRST_EVENT_TIMEOUT),
        "挂载后的首轮重算必须由该单元自己的 worker 推送快照"
    );
    let first = manager.snapshot(&unit_b).expect("首个快照");
    let pushed_at_first = sink.count(GIT_STATUS_SNAPSHOT_EVENT);
    assert!(
        first.entries.is_empty(),
        "夹具前提：新 worktree 起始干净，但快照必须已存在"
    );

    // 一次「新增」+ 一次「删除跟踪文件」：两类都是用户日常编辑，都不该需要手动刷新
    std::fs::write(worktree.join("edited-in-wt.txt"), "x\n").unwrap();
    std::fs::remove_file(worktree.join("README.md")).expect("remove tracked file");
    assert!(
        wait_for_more_events(
            &sink,
            GIT_STATUS_SNAPSHOT_EVENT,
            pushed_at_first,
            FIRST_EVENT_TIMEOUT
        ),
        "worktree 内编辑必须由该单元自己的 worker 经事件出口推送新快照，而不是等别人来戳"
    );

    let latest = wait_for_entry(&manager, &unit_b, "README.md", FIRST_EVENT_TIMEOUT);
    assert!(
        latest.version > first.version,
        "version 必须前进（前端按它做单元内乱序闸门）：{:?} -> {:?}",
        first.version,
        latest.version
    );
    assert_eq!(latest.repo_key, unit_b.key());
    let mut got = paths_of(&latest.entries).into_iter().collect::<Vec<_>>();
    got.sort_unstable();
    assert_eq!(
        got,
        vec![Path::new("README.md"), Path::new("edited-in-wt.txt")],
        "条目必须相对 worktree 根，且新增/删除两类都在"
    );
    assert!(
        latest
            .entries
            .iter()
            .any(|e| e.path == Path::new("README.md") && matches!(e.status, FileStatus::Deleted)),
        "删除的跟踪文件必须报成 Deleted，而不是被当成未变化丢弃"
    );

    // 反向不变量：worktree 内的删除动作不得让主仓视图出现任何变化
    let main_porcelain = git_in(&main, &["status", "--porcelain"]);
    assert!(
        main_porcelain.trim().is_empty(),
        "主仓仍应干净，实际 porcelain：{main_porcelain:?}"
    );
}

/// **AC11①（PRD · 反复切换 20 次不累积）**：按 D-B 的形态连续切换 20 次，
/// 挂载表里必须始终只有当前那一个单元，且被换掉的单元句柄真的被摘走（而不是留在表里）。
///
/// 为什么断言句柄数而不是 OS 线程数：线程由 `stop_signal` + 句柄 drop 收敛，属实现细节；
/// 「累积」的可观测形态就是挂载表增长 —— 表里留一份句柄就必然留一套后台线程与文件描述符。
#[test]
fn twenty_unit_switches_do_not_accumulate_mounts() {
    let tmp = tempfile::tempdir().unwrap();
    let (main, worktree) = repo_with_linked_worktree(tmp.path());
    let main_unit = main_unit(&main);
    let wt_unit = worktree_unit(&main, &worktree);

    let sink = CollectingSink::new();
    let manager = WatcherManager::new();
    for i in 0..20 {
        // 生产形态：activate() = release_except(目标) + watch(目标)，两个单元来回切
        let unit = if i % 2 == 0 { &wt_unit } else { &main_unit };
        let released = manager.release_except(&unit.key());
        assert!(
            released.len() <= 1,
            "第 {i} 次切换最多回收上一个单元，实际回收 {released:?}"
        );
        manager.watch(unit.clone(), sink.clone());
        assert_eq!(
            manager.watched_units(),
            vec![unit.key()],
            "第 {i} 次切换后挂载表必须只剩当前单元（多出来的每一项都是一套泄漏的线程/句柄）"
        );
    }
    // 收尾：切到未挂载侧（如项目被关闭）后不得留任何挂载
    let cleared = manager.release_except("nonexistent-unit-key");
    assert_eq!(cleared.len(), 1, "最后一次挂载必须被回收");
    assert!(
        manager.watched_units().is_empty(),
        "release_except 必须能清空全部挂载，残留即资源累积"
    );
}

/// **AC5①（PRD）**：激活主仓单元时，同一 project 的未挂载 linked worktree 内发生变更
/// ⇒ 主仓的槽、主仓的事件推送、后端为未挂载单元产出的快照**全都不受影响**。
///
/// 这是「changes 列表出现 main 中的内容」的**反向**形态：串内容只需要一个错误的注册键，
/// 但反过来「A 的 watcher 根被配成了 project 根 / 或别的单元的 index 事件被广播给 A」同样
/// 会表现为串内容。这条断言把「watcher 根 = 该单元 workdir」与「未挂载 = 静默」钉成可证伪
/// 的事实（原实现确实有 `.git/worktrees/**` → 广播给所有项目消费者的那套补挂机制）。
#[test]
fn writes_in_unmounted_sibling_unit_leak_nothing_into_mounted_unit() {
    let tmp = tempfile::tempdir().unwrap();
    let (main, worktree) = repo_with_linked_worktree(tmp.path());
    let unit_a = main_unit(&main);
    let unit_b = worktree_unit(&main, &worktree);

    let sink = CollectingSink::new();
    let manager = WatcherManager::new();
    manager.watch(unit_a.clone(), sink.clone());
    // 已挂载单元先有一次自己的变更：这样「泄漏」会表现为条目增多，断言才可证伪
    // （若基线是空快照，串进来的内容同样只能靠"事件数"侧面观测）。
    std::fs::write(main.join("main-only.txt"), "x\n").unwrap();
    assert!(
        manager.poke_status_worker_and_wait(&unit_a, FIRST_EVENT_TIMEOUT),
        "夹具前提：主仓单元首个快照落地"
    );
    // 静默窗口后再取基线：把 A 自己那次变更引发的异步推送全部收敛掉
    std::thread::sleep(QUIET_WINDOW);
    let baseline = manager.snapshot(&unit_a).expect("主仓权威快照");
    assert_eq!(
        paths_of(&baseline.entries),
        vec![Path::new("main-only.txt")],
        "夹具前提：基线只有 A 自己的条目"
    );
    let snapshot_events = sink.count(GIT_STATUS_SNAPSHOT_EVENT);
    let file_events = sink.count(FILE_CHANGED_EVENT);

    // ① 只在**未挂载**的兄弟单元工作树里新增文件：A 不得收到任何事件
    std::fs::write(worktree.join("sibling-only.txt"), "x\n").unwrap();
    std::thread::sleep(QUIET_WINDOW);
    assert_eq!(
        sink.count(GIT_STATUS_SNAPSHOT_EVENT) - snapshot_events,
        0,
        "兄弟单元的变更不得给已挂载单元产出快照（前端会把它渲染成串内容）"
    );
    assert_eq!(
        sink.count(FILE_CHANGED_EVENT) - file_events,
        0,
        "同理不得产出内容事件批次（A 的 watcher 根必须是 A 自己的 workdir）"
    );

    // ② 兄弟单元写自己的 index：快照仍不得动。
    //    只对快照下断言 —— linked worktree 与主仓**共享 object DB**，`git add` 落下的
    //    松散对象文件本来就在 `main/.git` 下，那是 git 的正常行为而不是跨单元泄漏。
    git_in(&worktree, &["add", "sibling-only.txt"]);
    std::thread::sleep(QUIET_WINDOW);
    assert_eq!(
        sink.count(GIT_STATUS_SNAPSHOT_EVENT) - snapshot_events,
        0,
        "兄弟单元的 index 写入不得驱动已挂载单元重算（旧实现那套 .git/worktrees 补挂广播的形态）"
    );
    let after = manager.snapshot(&unit_a).expect("主仓快照不得被作废");
    assert_eq!(after.version, baseline.version, "主仓 version 必须原地不动");
    assert_eq!(
        paths_of(&after.entries),
        paths_of(&baseline.entries),
        "主仓条目集合必须原地不动"
    );
    assert!(
        manager.snapshot(&unit_b).is_none(),
        "未挂载单元不得被顺带产出快照（未知 ≠ 有数据）"
    );
    assert!(!manager.is_watched(&unit_b));

    // 夹具自检：变更确实只落在 B 的 git 视角里
    let wt_porcelain = git_in(&worktree, &["status", "--porcelain"]);
    assert!(
        wt_porcelain.contains("sibling-only.txt"),
        "夹具前提：写入对 B 是真变更，porcelain={wt_porcelain:?}"
    );
    assert_eq!(
        paths_of(&parse_porcelain(&git_in(&main, &["status", "--porcelain"]))),
        vec![Path::new("main-only.txt")],
        "主仓 git 视角只认自己那条变更，兄弟单元的写入不得出现"
    );
}

/// **R2.4（pull 生产者不得覆盖 push）**：挂载中且 worker 已产出过快照 ⇒ 该槽位归 push 所有，
/// pull 回读即可。
///
/// 钉住的竞态形态：`compute_and_record` 的 git 子进程耗时以百毫秒计，期间 worker 完全可能
/// 推送**更新**的数据；晚到的 pull 若照常写表，注册表盖的号还会让它看起来比被它覆盖的 push
/// 更新 —— 前端按 version 门控就会接受这份旧数据（= 静默过期）。
#[test]
fn pull_cannot_overwrite_a_live_push_snapshot() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("repo");
    std::fs::create_dir_all(&root).unwrap();
    git2::Repository::init(&root).expect("init git repo");
    std::fs::write(root.join("pushed.txt"), "x\n").unwrap();

    let unit = main_unit(&root);
    let sink = CollectingSink::new();
    let manager = WatcherManager::new();
    manager.watch(unit.clone(), sink.clone());
    assert!(manager.poke_status_worker_and_wait(&unit, FIRST_EVENT_TIMEOUT));
    let push = manager.snapshot(&unit).expect("push 快照必须已落地");

    let pulled = manager.record_computed(pull_snapshot(
        &unit,
        parse_porcelain("?? from-a-late-pull.txt"),
    ));
    assert_eq!(
        pulled.version, push.version,
        "回读的必须是 push 本身，而不是 pull 另起一个号"
    );
    assert_eq!(
        paths_of(&manager.snapshot(&unit).expect("槽位仍在").entries),
        paths_of(&push.entries),
        "晚到的 pull 不得改写挂载中单元的权威条目"
    );
    assert!(!paths_of(&pulled.entries).contains(&Path::new("from-a-late-pull.txt")));
}

/// **D-B 的全局形态**：挂载另一个单元（哪怕是**别的项目**）必须释放此前所有挂载。
///
/// 现场证据（2026-09-28 隔离实例）：旧写法只回收同项目的其它单元，切换项目时上一个项目
/// 的挂载无人释放；而后端自己又会在 `set_active_project` / 启动恢复时按项目预挂主仓单元，
/// 于是启动序列里出现「先挂主仓、随后改挂 worktree」的两个发起点。
#[test]
fn activate_style_release_except_keeps_only_the_target_unit() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("repo");
    let worktree = tmp.path().join("repo-wt");
    let other = tmp.path().join("other-repo");
    for dir in [&root, &worktree, &other] {
        std::fs::create_dir_all(dir).unwrap();
        git2::Repository::init(dir).expect("init git repo");
    }

    let unit_a = main_unit(&root);
    let unit_b = worktree_unit(&root, &worktree);
    let unit_other_project =
        RepoRef::resolve("p2", &other.to_string_lossy(), None, &ExecTarget::Local).unwrap();

    let sink = CollectingSink::new();
    let manager = WatcherManager::new();
    manager.watch(unit_a.clone(), sink.clone());
    manager.watch(unit_other_project.clone(), sink.clone());
    assert_eq!(manager.watched_units().len(), 2);

    // 挂载 unit_b（模拟 `activate()`：先 release_except 再 watch）
    let released = manager.release_except(&unit_b.key());
    assert_eq!(released.len(), 2, "跨项目的挂载都要回收");
    manager.watch(unit_b.clone(), sink.clone());

    assert_eq!(
        manager.watched_units(),
        vec![unit_b.key()],
        "全局只能剩当前视图那一个单元"
    );
    assert!(
        manager.snapshot(&unit_a).is_none() && manager.snapshot(&unit_other_project).is_none(),
        "被释放单元的槽位必须作废，不得留旧数据被渲染"
    );
}

/// **R2.4 的另一半**：未挂载单元（WSL / SSH / 侧栏要为每个 worktree 取计数）多次 pull 之间
/// 也必须单调 —— 号源只有注册表这一个，读接口因此不需要区分「这次是 push 还是 pull」。
#[test]
fn unmounted_pulls_advance_the_same_registry_sequence() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("remote-ish");
    std::fs::create_dir_all(&root).unwrap();
    let unit = main_unit(&root);
    let manager = WatcherManager::new();
    assert!(!manager.is_watched(&unit), "夹具前提：该单元未挂载");

    let first = manager.record_computed(pull_snapshot(&unit, parse_porcelain("?? a.txt")));
    let second = manager.record_computed(pull_snapshot(&unit, parse_porcelain("?? b.txt")));
    assert_eq!(first.version, 1);
    assert_eq!(
        second.version,
        first.version + 1,
        "后一次 pull 必须比前一次新（否则前端闸门会留下旧的那份）"
    );
    assert_eq!(
        paths_of(&manager.snapshot(&unit).expect("槽位仍在").entries),
        vec![Path::new("b.txt")],
        "未挂载单元的数据源就是 pull 本身"
    );
    assert_eq!(second.repo_key, unit.key());
}

/// **切走再切回来时，新快照不得被前端闸门静默丢掉**：注册表的 version 号必须跨挂载周期单调。
///
/// 触发路径（2026-09-29 从真 app 手测日志里发现，不是设想）：那次会话 13 次快照推送**全是 v1**
/// —— 每次释放再挂载，号都从 1 重新起。前端闸门是 `version <= prev` 直接丢弃，而「切项目」这条
/// 路上没人作废上一个单元的槽位（`useWorktreeState` 只在 worktree 切换时 `invalidateStatus`），
/// 于是切回来时**刚算出来的那份**被当成旧数据丢掉，界面继续显示离开时的旧快照 —— 正是 issue #2
/// 「需要手动刷新才能恢复正常」的形态。号源归注册表管，释放只作废**数据**，不作废**号段**。
#[test]
fn remount_continues_the_unit_version_sequence() {
    let tmp = tempfile::tempdir().unwrap();
    let (main, worktree) = repo_with_linked_worktree(tmp.path());
    let unit = worktree_unit(&main, &worktree);
    let sink = CollectingSink::new();
    let manager = WatcherManager::new();

    manager.watch(unit.clone(), sink.clone());
    assert!(
        wait_for_event(&sink, GIT_STATUS_SNAPSHOT_EVENT, FIRST_EVENT_TIMEOUT),
        "夹具前提：挂载即产首个快照"
    );
    let first = manager.snapshot(&unit).expect("首个快照").version;
    std::fs::write(worktree.join("a.txt"), "x\n").unwrap();
    let second = wait_for_entry(&manager, &unit, "a.txt", FIRST_EVENT_TIMEOUT);
    assert!(
        second.version > first,
        "同一挂载周期内 version 必须前进：{first} -> {}",
        second.version
    );

    // 切走（释放）再切回（重新挂载）：数据必须作废，号段不得退回
    manager.unwatch(&unit);
    assert!(manager.snapshot(&unit).is_none(), "释放即作废数据（I1-b）");
    manager.watch(unit.clone(), sink.clone());
    let deadline = Instant::now() + FIRST_EVENT_TIMEOUT;
    let after_remount = loop {
        if let Some(snap) = manager.snapshot(&unit) {
            break snap;
        }
        assert!(
            Instant::now() < deadline,
            "重新挂载后必须由该单元自己的 worker 再产一份快照"
        );
        std::thread::sleep(Duration::from_millis(25));
    };
    assert!(
        after_remount.version > second.version,
        "version 跨挂载周期也必须单调：切回后的第一份是 {}，而前端槽位里还留着切走前的 {}，\
         `version <= prev` 会把这份新数据静默丢弃",
        after_remount.version,
        second.version
    );
}

/// pull 生产者共用同一条号段：单元被现算多次、期间挂载又释放，后续 pull 仍不得回退。
#[test]
fn pull_after_a_release_still_continues_the_sequence() {
    let tmp = tempfile::tempdir().unwrap();
    // 真 git 仓库夹具：`watch()` 会驱动 worker 跑一次真 `git status`，非仓库目录产不出快照
    let (main, _worktree) = repo_with_linked_worktree(tmp.path());
    let unit = main_unit(&main);
    let manager = WatcherManager::new();

    let first = manager.record_computed(pull_snapshot(&unit, parse_porcelain("?? a.txt")));
    let second = manager.record_computed(pull_snapshot(&unit, parse_porcelain("?? b.txt")));
    assert!(second.version > first.version);
    let mut high_water = second.version;

    // 挂载 → 释放：worker 首轮快照也必须接在同一号段之后，释放只作废数据不作废号段
    let sink = CollectingSink::new();
    manager.watch(unit.clone(), sink);
    let deadline = Instant::now() + FIRST_EVENT_TIMEOUT;
    let mounted = loop {
        if let Some(snap) = manager.snapshot(&unit) {
            break snap;
        }
        assert!(
            Instant::now() < deadline,
            "挂载后应立刻有一轮重算落在注册表里"
        );
        std::thread::sleep(Duration::from_millis(25));
    };
    assert!(
        mounted.version > high_water,
        "挂载首轮快照要接在同一号段之后：{} <= {}",
        mounted.version,
        high_water
    );
    high_water = mounted.version;
    manager.unwatch(&unit);

    let after = manager.record_computed(pull_snapshot(&unit, parse_porcelain("?? c.txt")));
    assert!(
        after.version > high_water,
        "释放之后 pull 拿到的号不得回退到切走前那一段：{} <= {}",
        after.version,
        high_water
    );
}

// ── AC4 现场项：编辑 → 推送的时延分布（测量，不是回归断言）─────────────────────

/// 单轮采样的宽容上限：超过它判「通道断了」，而不是「慢」。
const PUSH_SAMPLE_TIMEOUT: Duration = Duration::from_secs(8);

/// 面板可感知时延的预算：notify 投递 + throttle + `git status` 重算 + 注册表盖章。
/// 取 3s 是「病态回归」判据（实测远低于此），不是体验目标。
const EDIT_TO_PUSH_BUDGET: Duration = Duration::from_millis(3000);

/// 每轮之后的静默间隙：让本轮推送彻底落地，下一轮的起表点才落在「无在途工作」的状态里。
const SAMPLE_GAP: Duration = Duration::from_millis(300);

/// 采样轮数（AC4 要 P95，样本量至少要能分出十分位）。
const PUSH_LATENCY_ROUNDS: usize = 20;

/// 采 `rounds` 轮「单元内新增一个文件 → 该单元快照 version 前进」的耗时。
///
/// `unit_dir == root` 即主仓单元，否则同一项目的 linked worktree 单元。两条链路是**同一条**
/// 生产代码（notify → ThrottleScheduler → `worker.check()` → `store_snapshot` → `sink.emit`），
/// 因此两者的差值就是「worktree 单元有没有被特殊地拖慢」—— 这正是 AC4 要的对比。
///
/// 起表点取 `fs::write` 返回之后：编辑动作到面板更新的用户体感里，编辑器落盘之前的时间
/// 不属于本链路。终点对准 version 前进（= 推送落地）而非 React 渲染完成，因为后半段是
/// 一次 IPC + 一次渲染（亚毫秒级），且渲染路径不丢推送已由
/// `GitCommitPanel.unit.test.tsx` 钉住。
fn measure_push_latency(root: &Path, unit_dir: &Path, rounds: usize) -> Vec<Duration> {
    let unit = if unit_dir == root {
        main_unit(root)
    } else {
        worktree_unit(root, unit_dir)
    };
    let sink = CollectingSink::new();
    let manager = WatcherManager::new();
    manager.watch(unit.clone(), sink.clone());
    assert!(
        wait_for_event(&sink, GIT_STATUS_SNAPSHOT_EVENT, PUSH_SAMPLE_TIMEOUT),
        "夹具前提：挂载即产首个快照"
    );

    let mut samples = Vec::with_capacity(rounds);
    for round in 0..rounds {
        let file = format!("probe-{round}.txt");
        let before = manager.snapshot(&unit).expect("已挂载单元必有快照").version;
        std::fs::write(unit_dir.join(&file), "x\n").expect("write probe file");
        let started = Instant::now();
        let deadline = started + PUSH_SAMPLE_TIMEOUT;
        loop {
            if let Some(snap) = manager.snapshot(&unit) {
                if snap.version > before {
                    assert!(
                        paths_of(&snap.entries).contains(&Path::new(&file)),
                        "第 {round} 轮推送的快照不含本轮新增的 {file}，该样本无法归因于本轮编辑"
                    );
                    samples.push(started.elapsed());
                    break;
                }
            }
            assert!(
                Instant::now() < deadline,
                "第 {round} 轮写入后 {:?} 内快照 version 未前进",
                PUSH_SAMPLE_TIMEOUT
            );
            std::thread::sleep(Duration::from_millis(5));
        }
        std::thread::sleep(SAMPLE_GAP);
    }
    manager.unwatch(&unit);
    samples
}

/// 最近秩分位数（样本量小，不必上直方图）。
fn percentile(samples: &[Duration], pct: usize) -> Duration {
    let mut sorted = samples.to_vec();
    sorted.sort_unstable();
    let rank = ((sorted.len() - 1) as f64 * pct as f64 / 100.0).ceil() as usize;
    sorted[rank]
}

/// 打印一轮采样分布，回传 P95。
fn report_latency(label: &str, samples: &[Duration]) -> Duration {
    let total: u128 = samples.iter().map(|d| d.as_millis()).sum();
    eprintln!(
        "{label}: n={} p50={:?} p95={:?} max={:?} mean={}ms",
        samples.len(),
        percentile(samples, 50),
        percentile(samples, 95),
        samples.iter().max().copied().unwrap_or(Duration::ZERO),
        total / samples.len() as u128,
    );
    percentile(samples, 95)
}

/// **AC4 的现场项（P95 时延 + 与主仓对比）**：不点刷新，从「写入」到「该单元快照推送落地」
/// 的耗时分布，worktree 单元与主仓单元各采 20 轮。
///
/// 默认 `#[ignore]` 的理由：它测的是时序而不是行为，跑满约 20s，放进 CI 只会制造抖动；
/// 需要出数时执行
/// `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture edit_to_push_latency`
#[test]
#[ignore = "时延测量（约 20s），只在人工核 AC4 时跑"]
fn edit_to_push_latency_p95_worktree_vs_main() {
    let tmp = tempfile::tempdir().unwrap();
    let (main, worktree) = repo_with_linked_worktree(tmp.path());

    let worktree_samples = measure_push_latency(&main, &worktree, PUSH_LATENCY_ROUNDS);
    let main_samples = measure_push_latency(&main, &main, PUSH_LATENCY_ROUNDS);

    let worktree_p95 = report_latency("linked worktree 单元", &worktree_samples);
    let main_p95 = report_latency("主仓单元          ", &main_samples);
    assert!(
        worktree_p95 < EDIT_TO_PUSH_BUDGET,
        "worktree 单元 P95 {worktree_p95:?} 超预算 {EDIT_TO_PUSH_BUDGET:?}"
    );
    assert!(
        main_p95 < EDIT_TO_PUSH_BUDGET,
        "主仓单元 P95 {main_p95:?} 超预算 {EDIT_TO_PUSH_BUDGET:?}"
    );
}

// ── D-B 不变量的并发判据（P2-4）──────────────────────────────────────────────
//
// 不变量：「每项目/全局同时至多一套挂载资源」。它属于**资源所有者**（`mount_only`），
// 不能靠调用方记得「先 release 再 watch」的顺序维持 —— 两个并发的 `activate`
// （快速切项目 / 连点）会在两步之间交错，留下两套挂载（线程与句柄泄漏、同一变更推两份快照）。

/// 指定项目 id 的主仓形态单元（key 只含 project_id，故两单元必须用不同 project id 才不同址）。
fn unit_of(project_id: &str, root: &Path) -> RepoRef {
    RepoRef::resolve(
        project_id,
        &root.to_string_lossy(),
        None,
        &ExecTarget::Local,
    )
    .expect("tempdir-derived unit path must resolve")
}

/// 并发挂**不同**单元：最终必须恰好一套挂载。
///
/// 红→绿判据：把 `mount_only` 换回「release_except + watch」两连调时，本用例在并发布障
/// 同步下会观察到 2 套挂载（`watched_units().len() == 2`）。
#[test]
fn concurrent_mount_of_different_units_keeps_single_mount() {
    let tmp = tempfile::tempdir().unwrap();
    let dir_a = tmp.path().join("unit-a");
    let dir_b = tmp.path().join("unit-b");
    std::fs::create_dir_all(&dir_a).unwrap();
    std::fs::create_dir_all(&dir_b).unwrap();

    let manager = WatcherManager::new();
    let sink = CollectingSink::new();
    // 两个线程在同一时刻冲进「释放 + 挂载」这一段
    let barrier = Arc::new(std::sync::Barrier::new(2));
    let units = [unit_of("p1", &dir_a), unit_of("p2", &dir_b)];

    let handles: Vec<_> = units
        .into_iter()
        .map(|unit| {
            let manager = manager.clone();
            let sink = Arc::clone(&sink) as Arc<dyn super::super::sink::WatcherEventSink>;
            let barrier = Arc::clone(&barrier);
            std::thread::spawn(move || {
                barrier.wait();
                let _ = manager.mount_only(unit, sink);
            })
        })
        .collect();
    for handle in handles {
        handle.join().expect("mount thread should not panic");
    }

    assert_eq!(
        manager.watched_units().len(),
        1,
        "并发 activate 之后必须只剩一套挂载（D-B）：{:?}",
        manager.watched_units()
    );
    assert_eq!(
        manager.watcher_set_creations(),
        2,
        "两次挂载各建一套，其中一套必须被释放"
    );
}

/// 并发挂**同一**单元：只允许建一套 watcher（重复挂载会翻倍投递事件并再泄漏一套线程）。
#[test]
fn concurrent_mount_of_same_unit_creates_exactly_one_watcher_set() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("unit");
    std::fs::create_dir_all(&dir).unwrap();
    let unit = unit_of("p1", &dir);

    let manager = WatcherManager::new();
    let sink = CollectingSink::new();
    let threads = 4;
    let barrier = Arc::new(std::sync::Barrier::new(threads));

    let handles: Vec<_> = (0..threads)
        .map(|_| {
            let manager = manager.clone();
            let sink = Arc::clone(&sink) as Arc<dyn super::super::sink::WatcherEventSink>;
            let barrier = Arc::clone(&barrier);
            let unit = unit.clone();
            std::thread::spawn(move || {
                barrier.wait();
                let _ = manager.mount_only(unit, sink);
            })
        })
        .collect();
    for handle in handles {
        handle.join().expect("mount thread should not panic");
    }

    assert_eq!(manager.watched_units().len(), 1);
    assert_eq!(
        manager.watcher_set_creations(),
        1,
        "同一单元的并发挂载只允许建一套资源（check-then-insert 不得被穿透）"
    );
}

/// 重申挂载同一单元 = 空操作（`mount_only` 的语义是「确保该单元挂载」，不是「注册一次」）。
///
/// 契约来源：调用方会**合法地**重申同一单元 —— 前端首个快照未落地时的有界重试，以及激活态被
/// 后端改写成 canonical 形态后的一次重发。旧实现把重申直接转给 `watch`，于是每次都命中它的
/// 「重复注册」告警分支；那条 WARN 的诊断语义是「有人绕过了唯一挂载入口」（D-B 落地前正是它
/// 暴露了启动期双发起点，现场核对以「0 条 already watched」为证据），被合法路径触发即失效。
///
/// 本用例钉住重申的**可观察契约**：不重建资源、不动挂载集合、不释放任何单元。
#[test]
fn mount_only_reasserting_same_unit_is_a_noop() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().to_path_buf();
    let sink = CollectingSink::new();
    let manager = WatcherManager::new();

    assert!(
        manager
            .mount_only(main_unit(&root), sink.clone())
            .is_empty(),
        "首次挂载没有可释放的单元"
    );
    assert_eq!(manager.watcher_set_creations(), 1);

    assert!(
        manager
            .mount_only(main_unit(&root), sink.clone())
            .is_empty(),
        "重申挂载不得释放任何单元（含自身）"
    );
    assert_eq!(
        manager.watcher_set_creations(),
        1,
        "重申挂载不得重建 watcher（重建=再泄漏一套线程/句柄）"
    );
    assert_eq!(manager.watched_units(), vec![main_unit(&root).key()]);

    // 重申不能被实现成「摘掉再挂」：事件投递必须仍然可用
    std::thread::sleep(WATCH_SETTLE);
    assert!(
        touch_and_wait(
            &root,
            "after-reassert.txt",
            &sink,
            FILE_CHANGED_EVENT,
            FIRST_EVENT_TIMEOUT
        ),
        "重申挂载后事件投递必须仍然可用"
    );
}

/// 并发 pull **同一未挂载单元**：取号互不撞号，槽位永远收敛到最大号且条目与号同轮。
///
/// 钉住的竞态形态：旧实现里取号（`version_floors` 锁）与槽位插入（`store` 锁）是两次
/// 独立持锁，并发生产者能交错出「取小号却后插入」—— 槽位回退到旧数据而号段已前进，
/// 下一份快照无缝接号，前端 version 闸门对这段陈旧窗口毫无感知。修法是守卫+取号+插入
/// 同一次 `store` 持锁（见 `store_snapshot` 的原子性契约）。
#[test]
fn concurrent_pulls_on_one_unit_never_regress_the_slot() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("unit");
    std::fs::create_dir_all(&dir).unwrap();
    let unit = unit_of("p1", &dir);
    let manager = WatcherManager::new();
    assert!(
        !manager.is_watched(&unit),
        "夹具前提：单元未挂载（pull 生产者领地）"
    );

    let threads = 8;
    let barrier = Arc::new(std::sync::Barrier::new(threads));
    let handles: Vec<_> = (0..threads)
        .map(|i| {
            let manager = manager.clone();
            let barrier = Arc::clone(&barrier);
            let unit = unit.clone();
            std::thread::spawn(move || {
                barrier.wait();
                let snap = manager.record_computed(pull_snapshot(
                    &unit,
                    parse_porcelain(&format!("?? f{i}.txt")),
                ));
                (snap.version, snap.entries[0].path.clone())
            })
        })
        .collect();
    let results: Vec<_> = handles
        .into_iter()
        .map(|h| h.join().expect("pull thread should not panic"))
        .collect();

    // 取号互不撞号：每线程恰取一号 ⇒ 版本集合恰为 1..=N
    let mut versions: Vec<u64> = results.iter().map(|(v, _)| *v).collect();
    versions.sort_unstable();
    let expected: Vec<u64> = (1..=threads as u64).collect();
    assert_eq!(versions, expected, "并发取号不得撞号、不得跳号");

    // 槽位必须收敛到最大号，且条目正是拿到最大号那一轮的数据（不得「取小号后插入」回退）
    let slot = manager.snapshot(&unit).expect("槽位必须在");
    assert_eq!(slot.version, threads as u64);
    let (max_version, max_path) = results
        .iter()
        .max_by_key(|(v, _)| *v)
        .expect("results 非空");
    assert_eq!(
        slot.entries[0].path, *max_path,
        "槽位数据必须与最大版本号（v{max_version}）同轮"
    );
}

/// **AC4 的代码层闭环**：挂载中的单元，外部 ref 变化必须经
/// watcher（refs 递归监听）→ scheduler → worker 自动推送新快照，**无需任何手动 poke**。
///
/// 外部 `git push` 只改写 `.git/refs/remotes/<remote>/<b>`（loose ref），HEAD / index /
/// workdir 一字未动 —— 这正是「↑N 徽标无界陈旧」的根因。本用例把整条链路打通验证：
/// 纯 ref 变化（`commit-tree` + `update-ref`，不碰工作区）后，新快照的事件必须自己到达，
/// 且快照里 ahead/behind 已更新。
#[test]
fn external_ref_update_pushes_a_new_snapshot_without_manual_poke() {
    let tmp = tempfile::tempdir().unwrap();
    // bare origin + 首个提交已 push（建立 @{upstream}）
    let remote = tmp.path().join("origin.git");
    std::fs::create_dir_all(&remote).unwrap();
    git_in(&remote, &["init", "--bare"]);
    let main = tmp.path().join("repo");
    std::fs::create_dir_all(&main).unwrap();
    crate::common::testing::init_git_repo(&main);
    git_in(
        &main,
        &["remote", "add", "origin", &remote.to_string_lossy()],
    );
    git_in(&main, &["push", "--set-upstream", "origin", "HEAD"]);

    let unit = main_unit(&main);
    let sink = CollectingSink::new();
    let manager = WatcherManager::new();
    manager.watch(unit.clone(), sink.clone());
    assert!(
        wait_for_event(&sink, GIT_STATUS_SNAPSHOT_EVENT, FIRST_EVENT_TIMEOUT),
        "挂载即应产出首份快照"
    );
    let baseline = sink.count(GIT_STATUS_SNAPSHOT_EVENT);
    {
        let first = manager.snapshot(&unit).expect("首份快照");
        assert_eq!((first.ahead, first.behind), (0, 0));
    }

    // 纯 ref 变化：只前移 remote-tracking ref（等价外部 push 改写 .git/refs/remotes/**），
    // HEAD / index / workdir 全不动。
    let tree = git_in(&main, &["rev-parse", "HEAD^{tree}"])
        .trim()
        .to_string();
    let parent = git_in(&main, &["rev-parse", "HEAD"]).trim().to_string();
    let upstream_only = git_in(
        &main,
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@test.com",
            "commit-tree",
            &tree,
            "-p",
            &parent,
            "-m",
            "upstream only",
        ],
    )
    .trim()
    .to_string();
    let upstream_ref = format!(
        "refs/remotes/{}",
        git_in(
            &main,
            &[
                "rev-parse",
                "--abbrev-ref",
                "--symbolic-full-name",
                "@{upstream}",
            ],
        )
        .trim()
    );
    git_in(&main, &["update-ref", &upstream_ref, &upstream_only]);

    assert!(
        wait_for_more_events(
            &sink,
            GIT_STATUS_SNAPSHOT_EVENT,
            baseline,
            FIRST_EVENT_TIMEOUT
        ),
        "外部 ref 变化必须经 watcher→scheduler→worker 自动推送新快照（无需手动 poke）"
    );
    let after = manager.snapshot(&unit).expect("refs 变化后的新快照");
    assert_eq!((after.ahead, after.behind), (0, 1));
}
