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
//!
//! **绝大多数用例已不建真实流**（2026-10 解耦，见任务 `10-25-watcher-test-decoupling`）：
//! 它们走 `WatcherManager::new().without_real_fs()`，由 `take_test_event_sink()` 交出回调、
//! 测试主动喂合成事件。理由：断言对象是**本仓的状态机**（幂等/号段/票号/快照槽位），
//! 而「内核是否投递了事件」是 Apple / 内核的契约，不是我们的。
//! 因此上面那条「静默 `QUIET_WINDOW`」现在只剩**一处**使用者
//! （`writes_in_unmounted_sibling_unit_leak_nothing_into_mounted_unit` 的异步基线收敛），
//! 其它地方不得再靠 sleep 推导结论。
//!
//! 唯一保留真实 FSEvents 的是 `#[ignore]` 的时延测量（`edit_to_push_latency_*`）——
//! 它测的就是含内核投递的端到端墙钟，必须走真实流，因此挂在 `real_fs_guard()` 下。

use super::WatcherManager;
use crate::common::executor::factory::ExecTarget;
use crate::common::file::watcher::sink::test_support::CollectingSink;
use crate::common::file::watcher::types::{FILE_CHANGED_EVENT, GIT_STATUS_SNAPSHOT_EVENT};
use crate::common::git::status_worker::{parse_porcelain, GitStatusSnapshot};
use crate::common::git::WorkspaceRef;
use crate::common::types::FileStatus;
use crate::core::exec::collect_blocking;
use crate::project::types::FileChange;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// 真实 FSEvents 测试的串行闸。
///
/// **为什么必须串行**（实测，见任务 `10-25-watcher-test-decoupling/prd.md`）：
/// 每条 FSEvents 流在 fseventsd 侧有独立的 client 线程与 path-trie。多个测试并发跑时
/// 「流数 × 同一变更被多少条流覆盖」会把 fseventsd 压到 95%+（27 条并发流实测 61~99%，
/// 单流写 30 倍数据反而只有 36%）。
///
/// **当前只有 1 个使用者**：`#[ignore]` 的 `edit_to_push_latency_p95_worktree_vs_main`
/// （端到端墙钟测量，必须走真实流）。其余用例走 `without_real_fs()`，不建流也不需要闸。
/// 用进程级 Mutex 而非引入 `serial_test` 依赖 —— 不值得为一个用例加 crate。
static REAL_FS_GUARD: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// 获取真实 FSEvents 串行闸。中毒时继续（前一个用例 panic 不应连带后续用例）。
fn real_fs_guard() -> std::sync::MutexGuard<'static, ()> {
    REAL_FS_GUARD.lock().unwrap_or_else(|e| e.into_inner())
}

/// 首次事件的宽容上限（git 项目还要等 worker 起 git 子进程）。
const FIRST_EVENT_TIMEOUT: Duration = Duration::from_secs(8);
/// 静默窗口：> debounce 的 max_wait（1.5s），确保"没有事件"是真结论。
///
/// 注意：这是**唯一**仍需要的等待窗（`writes_in_unmounted_sibling_unit_...` 用它收敛
/// 基线推送）。任何新增的「等一会儿看看」都不被允许 —— 先问断言对象是不是本仓状态，
/// 是的话用 `without_real_fs()` + 合成事件同步断言。
const QUIET_WINDOW: Duration = Duration::from_millis(2000);

/// 被测Workspace = 主仓形态（Local）。
///
/// 走 `WorkspaceRef::resolve` 而不是 `WorkspaceRef::main`：与生产构造入口一致，拿到 canonical
/// 工作目录（macOS 的 `tempdir()` 位于 `/var → /private/var` 符号链接下，非 canonical
/// 形态会让 watcher 路径与事件路径分叉）。
fn main_unit(root: &Path) -> WorkspaceRef {
    WorkspaceRef::resolve("p1", &root.to_string_lossy(), None, &ExecTarget::Local)
        .expect("tempdir-derived unit path must resolve")
}

/// 被测Workspace = linked worktree 形态（同一 project 的第二个单元）。
///
/// 参数只要求"两个不同工作目录"，因此单元身份类断言既可搭在真实 linked worktree 上
/// （[`repo_with_linked_worktree`]），也可搭在两个独立 checkout 上（本文件既有夹具）。
/// 需要「写入不得泄漏到别的单元」这类**可证伪**断言时用前者。
fn worktree_unit(root: &Path, worktree: &Path) -> WorkspaceRef {
    WorkspaceRef::resolve(
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
/// `record_pull` 的入参是**完整快照**（与 push 生产者同形），因此测试也按快照构造，
/// 而不是一串展开的参数（后者会把「同一份快照的不同字段」在调用点摊成多个位置参数）。
fn pull_snapshot(unit: &WorkspaceRef, entries: Vec<FileChange>) -> GitStatusSnapshot {
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

/// 等到该单元在注册表里出现任一份快照（挂载后的 worker 首轮）。
///
/// 这是**事件驱动**的等待（有数据立即返回），不是固定 sleep。
/// 轮询到该单元的快照**比 `after_version` 更新**为止。
///
/// 与 [`wait_for_snapshot`] 的差别是必要的（C1）：登记表不再随挂载释放而作废，
/// 挂载一个「此前已有权威数据」的单元时，`snapshot()` 会先返回那份**旧**数据。
/// 要断言「worker 的首轮推送接在同一号段之后」，就必须等一个**新号**，而不是等「非空」。
fn wait_for_snapshot_newer_than(
    manager: &WatcherManager,
    unit: &WorkspaceRef,
    after_version: u64,
) -> Arc<GitStatusSnapshot> {
    let deadline = Instant::now() + FIRST_EVENT_TIMEOUT;
    loop {
        if let Some(snap) = manager.snapshot(unit) {
            if snap.version > after_version {
                return snap;
            }
        }
        assert!(
            Instant::now() < deadline,
            "{} 挂载后的首轮推送必须在时限内给出大于 v{after_version} 的新号",
            unit.key()
        );
        std::thread::sleep(Duration::from_millis(25));
    }
}

/// 轮询到该单元快照的条目里出现 `file` 为止。
///
/// 为什么按「最终与 git 真值一致」轮询而不是一次读取：一次写入的多个 FS 事件在负载下可以
/// 跨 debounce 窗口分多批重算（本文件头注的口径），批次数量不是契约；把断言压在「第 N 次
/// 推送恰好包含全部改动」上就是造 flaky 测试。
fn wait_for_entry(
    manager: &WatcherManager,
    unit: &WorkspaceRef,
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

/// 投喂一条「内容变更」合成事件（等价于真实 FS 的 Modify(Data)）。
///
/// `without_real_fs` 模式下 `watch()` 把**合成扇出器**交给测试，测试主动喂事件 ——
/// 这样「事件到达后」的整条链路（路径路由 → gitignore 过滤 → debounce 合流 → sink）
/// 都是真实生产代码，只有「内核投递」被替换。
///
/// 参数类型是 [`TestEventSinks`] 而非单个回调：生产里 git 元数据有两条互斥传输
/// （合并到主回调 / 独立流），扇出器就是这两条的无内核替身（见该类型的说明）。
fn feed_content_change(
    feed: &mut crate::common::file::watcher::manager::core::TestWatchStream,
    path: &Path,
) {
    feed.feed(Ok(notify::Event::new(notify::EventKind::Modify(
        notify::event::ModifyKind::Data(notify::event::DataChange::Content),
    ))
    .add_path(path.to_path_buf())));
}

/// 事件出口基线：`watch()` 生成的回调收到一条内容事件后，
/// 经 debounce 必须投递 `file-changed`。
///
/// **不建真实流**：取 `watch()` 产出的回调，直接投喂合成 `notify::Event`。
/// 验证的是「事件到达后如何处理」——debounce 合流、sink 投递，都是纯逻辑。
/// 真实内核投递属 notify 库契约，不是本仓职责。
#[test]
fn watch_delivers_file_changed() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().to_path_buf();
    let sink = CollectingSink::new();
    let manager = WatcherManager::new().without_real_fs();

    manager.watch(main_unit(&root), sink.clone());
    let mut feed = manager
        .take_test_event_sink()
        .expect("noop 模式必须交出回调");

    feed.feed(Ok(notify::Event::new(notify::EventKind::Modify(
        notify::event::ModifyKind::Data(notify::event::DataChange::Content),
    ))
    .add_path(root.join("a.txt"))));

    assert!(
        wait_for_event(&sink, FILE_CHANGED_EVENT, Duration::from_secs(2)),
        "回调收到内容事件后必须经 debounce 投递 {FILE_CHANGED_EVENT}"
    );
}

#[test]
fn unwatch_stops_delivering_events() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().to_path_buf();
    let sink = CollectingSink::new();
    let manager = WatcherManager::new().without_real_fs();

    manager.watch(main_unit(&root), sink.clone());
    let mut feed = manager
        .take_test_event_sink()
        .expect("noop 模式必须交出回调");
    feed_content_change(&mut feed, &root.join("before.txt"));
    assert!(
        wait_for_event(&sink, FILE_CHANGED_EVENT, Duration::from_secs(2)),
        "基线：watch 期间的事件必须投递"
    );

    manager.unwatch(&main_unit(&root));
    let baseline = sink.count(FILE_CHANGED_EVENT);

    // 「unwatch 后不得再投递」在这里是**确定性**结论，不需要静默窗口：
    // `unwatch` → `release_one` 移出 handle → `DebounceSender` 被 drop →
    // 其 channel 发送端全灭 → debounce 线程 `RecvTimeoutError::Disconnected` 退出。
    // 回调本身也已随 handle 释放被 drop，测试手上没有可再喂的入口。
    // 旧写法在这里 sleep 300ms「等确认没事件」，等的是一个空集 —— 零判别信息。
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
    let manager = WatcherManager::new().without_real_fs();

    manager.watch(main_unit(&root), sink.clone());
    manager.watch(main_unit(&root), sink.clone());

    // 幂等核心契约（确定性断言）：重复 watch 不得创建第二套 watcher。
    // 用创建计数而非批次计数 —— 「一次写入 == 1 条批次」不是代码承诺：单次写入
    // 的多个 FS 事件可跨 debounce 滑动窗口分两批（macOS CI 高负载下实测触发），
    // 前端本就按批次合并刷新。
    assert_eq!(
        manager.watcher_set_creations(),
        1,
        "重复 watch 必须幂等：不得创建第二套 watcher（多套 watcher 会成倍投递并泄漏线程）"
    );

    let mut feed = manager
        .take_test_event_sink()
        .expect("noop 模式必须交出回调");
    feed_content_change(&mut feed, &root.join("a.txt"));
    assert!(
        wait_for_event(&sink, FILE_CHANGED_EVENT, Duration::from_secs(2)),
        "重复 watch 后事件投递必须仍然可用"
    );
}

#[test]
fn rewatch_after_unwatch_rebuilds_single_set() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().to_path_buf();
    let sink = CollectingSink::new();
    let manager = WatcherManager::new().without_real_fs();

    manager.watch(main_unit(&root), sink.clone());
    let mut feed = manager.take_test_event_sink().expect("回调");
    feed_content_change(&mut feed, &root.join("first.txt"));
    assert!(wait_for_event(
        &sink,
        FILE_CHANGED_EVENT,
        Duration::from_secs(2)
    ));

    manager.unwatch(&main_unit(&root));

    // 重新 watch：应恰好重建一套（unwatch 未注销 → 护栏拦截，计数仍为 1；
    // re-watch 叠加 → 计数为 3；只有恰好重建才是 2）
    manager.watch(main_unit(&root), sink.clone());
    assert_eq!(
        manager.watcher_set_creations(),
        2,
        "unwatch 必须真正注销，re-watch 必须重建且仅重建一套 watcher"
    );

    let mut feed2 = manager.take_test_event_sink().expect("回调");
    feed_content_change(&mut feed2, &root.join("second.txt"));
    assert!(
        wait_for_event(&sink, FILE_CHANGED_EVENT, Duration::from_secs(2)),
        "re-watch 后应恢复事件投递"
    );
}

#[test]
fn unwatch_stops_git_worker_snapshots() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().to_path_buf();
    git2::Repository::init(&root).expect("init git repo");
    let sink = CollectingSink::new();
    let manager = WatcherManager::new().without_real_fs();

    manager.watch(main_unit(&root), sink.clone());
    assert!(
        wait_for_event(&sink, GIT_STATUS_SNAPSHOT_EVENT, FIRST_EVENT_TIMEOUT),
        "git 项目 watch 后 worker 应产出首个快照"
    );

    manager.unwatch(&main_unit(&root));
    let baseline = sink.count(GIT_STATUS_SNAPSHOT_EVENT);

    // 写文件后**不睡**：`unwatch` 已把 handle 移出挂载表并 drop，worker / scheduler /
    // debounce 三条线程全部随之关闭，没有任何存活的输入路径能再产出快照。
    // 旧写法在这里等 `WATCH_SETTLE + QUIET_WINDOW`（2.3s）—— 等的是一个由构造保证的空集。
    std::fs::write(root.join("new.txt"), "x\n").unwrap();

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
    // 纯状态机语义：断言的是「poke 后快照是否反映写后工作区」，
    // 与「FSEvents 是否投递事件」无关 → 不建真实流。
    let manager = WatcherManager::new().without_real_fs();

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
        snap.workspace_key,
        unit.key(),
        "快照必须自带单元身份，否则前端无法寻址"
    );
}

/// 非 git 项目没有 status worker → poke 直接返回 false（空操作语义不变）。
#[test]
fn poke_status_worker_and_wait_is_noop_for_non_git_project() {
    let tmp = tempfile::tempdir().unwrap();
    let sink = CollectingSink::new();
    let manager = WatcherManager::new().without_real_fs();
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
    let manager = WatcherManager::new().without_real_fs();
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

/// **资源与数据解耦（C1）**：`unwatch` 只释放资源，**不作废权威数据**；且只影响自己那一个。
///
/// 旧不变量是「未挂载 = 未知 ⇒ 释放必须作废槽位」。它把资源状态当成了数据可信度的代理，
/// 于是非激活单元永远没有可显示的数据（用户报的「有的项目 git 状态完全无法显示」）。
/// 现在可信度由登记表的 `computed_at` / `dirty` 判定：数据留着，陈旧就重算。
#[test]
fn unwatch_releases_resources_without_discarding_authoritative_data() {
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
    let manager = WatcherManager::new().without_real_fs();
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
    let preserved = manager
        .snapshot(&main_unit)
        .expect("unwatch 只释放资源，不得丢弃权威数据（否则非激活单元永远无法显示）");
    assert_eq!(
        preserved.version, stale_version,
        "保留的必须是切走前那份**最新**数据，不得回退"
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

    // 重新挂载主仓单元：worker 的首轮推送必须**接在同一号段之后**（号段与数据同表，
    // 淘汰/重算都不会回退），且必须反映切走期间的写入。
    //
    // 注意判据的变化（C1）：切走不再丢弃数据，所以重新挂载后**先读到**的是保留下来那份
    // （`preserved`），这是合法且必要的（非激活单元要能显示）。要断言「重算确实发生」，
    // 必须等一个**新号**，而不是等「非空」。
    std::fs::write(root.join("added-while-unmounted.txt"), "x\n").unwrap();
    manager.watch(main_unit.clone(), sink.clone());
    let remounted = wait_for_snapshot_newer_than(&manager, &main_unit, stale_version);
    assert!(
        paths_of(&remounted.entries).contains(&Path::new("added-while-unmounted.txt")),
        "重新挂载后的新快照必须反映切走期间的写入，实际 {:?}",
        paths_of(&remounted.entries)
    );
}

/// 项目被移除时必须释放该项目下**所有**单元（旧实现只有 project 粒度，天然覆盖；
/// 身份补全后这里是唯一还能把两个单元一起收口的入口）。
#[test]
fn unwatch_project_releases_every_workspace_of_that_project() {
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
    let manager = WatcherManager::new().without_real_fs();
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
        WorkspaceRef::resolve("p2", &other.to_string_lossy(), None, &ExecTarget::Local).unwrap();
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
/// 形态：挂 A（主仓）→ 在 A 内写 → `poke(A)`；`unwatch(A)` 换挂 B（同一项目的 linked
/// worktree）→ 在 B 内写 → `poke(B)`。这里的 `unwatch(A)` 是**有意保留**的：C2 起生产路径
/// 切换视图不再释放 A（`ensure_mounted` 只增不减），但「释放后 poke 仍打对被写入单元」这条
/// 收口（worktree 被删 / 项目移除）仍需覆盖，而它与「A 的数据保留下来」的组合正是本用例
/// 断言的对象。
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
    let manager = WatcherManager::new().without_real_fs();

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
    assert_eq!(snap_a.workspace_key, unit_a.key());
    assert_eq!(
        paths_of(&snap_a.entries),
        vec![Path::new("main-only.txt")],
        "A 的快照必须是 A 自己的写入"
    );

    // ── 阶段 2：切换视图 —— 释放 A，挂载同一项目的 linked worktree 单元 B
    manager.unwatch(&unit_a);
    manager.watch(unit_b.clone(), sink.clone());
    // C1：切走**只释放资源**，A 的权威数据留在登记表里 —— 这正是「非激活单元也能显示」
    // 的前提。断言因此从「必须未知」改为「仍在，且仍是 A 自己的数据」：挂载 B 不得把
    // A 的槽位串成 B 的内容（跨单元串数据是身份补全要根治的另一类缺陷）。
    let preserved_a = manager
        .snapshot(&unit_a)
        .expect("切走视图不得丢弃 A 的权威数据");
    assert_eq!(preserved_a.workspace_key, unit_a.key());
    assert_eq!(
        paths_of(&preserved_a.entries),
        vec![Path::new("main-only.txt")],
        "A 保留下来的必须仍是 A 自己的数据，不得被 B 的挂载覆盖"
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
        snap_b.workspace_key,
        unit_b.key(),
        "快照必须落在 worktree 单元的槽上"
    );
    assert_eq!(snap_b.worktree_path.as_deref(), unit_b.worktree_path());
    assert_eq!(
        paths_of(&snap_b.entries),
        vec![Path::new("worktree-only.txt")],
        "必须是相对 worktree 根的 B 自己的写入，不得串主仓内容"
    );

    // 未挂载的 A 没有 worker 可戳；poke(B) 也不得**改写** A 的数据（跨单元泄漏）。
    // C1 起 A 的权威数据在切走后仍然保留（这正是非激活单元可显示的前提），所以判据是
    // 「一字未动」而不是「必须为空」。
    let a_after = manager.snapshot(&unit_a).expect("A 的权威数据必须保留");
    assert_eq!(
        a_after.version, preserved_a.version,
        "poke(B) 不得推进 A 的号（跨单元泄漏）"
    );
    assert_eq!(
        paths_of(&a_after.entries),
        paths_of(&preserved_a.entries),
        "poke(B) 不得改写 A 的数据（跨单元泄漏）"
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
    // 不建真实流：用 `take_test_event_sink` 拿回调，主动投喂「worktree 内文件变更」，
    // 验证「事件 → scheduler → worker 重算 → 推送快照」这条链**不需要手动 poke**。
    // 这正是本用例名里的 `without_manual_poke`。
    let manager = WatcherManager::new().without_real_fs();
    manager.watch(unit_b.clone(), sink.clone());
    assert!(
        manager.poke_status_worker_and_wait(&unit_b, FIRST_EVENT_TIMEOUT),
        "夹具前提：挂载后 worker 可产出首个快照"
    );
    let mut feed = manager
        .take_test_event_sink()
        .expect("noop 模式必须交出回调");
    let first = manager.snapshot(&unit_b).expect("首个快照");
    let pushed_at_first = sink.count(GIT_STATUS_SNAPSHOT_EVENT);
    assert!(
        first.entries.is_empty(),
        "夹具前提：新 worktree 起始干净，但快照必须已存在"
    );

    // 一次「新增」+ 一次「删除跟踪文件」：两类都是用户日常编辑，都不该需要手动刷新
    std::fs::write(worktree.join("edited-in-wt.txt"), "x\n").unwrap();
    std::fs::remove_file(worktree.join("README.md")).expect("remove tracked file");
    // 投喂内容变更事件：这才是「事件驱动」的输入（真实 FS 下由内核产生）
    feed_content_change(&mut feed, &worktree.join("edited-in-wt.txt"));
    feed_content_change(&mut feed, &worktree.join("README.md"));
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
    assert_eq!(latest.workspace_key, unit_b.key());
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

/// **AC1 / AC11①（PRD）**：反复切换 20 次**既不重建也不累积** —— 两个单元都留在表里，
/// 各自的 watcher 只建过一次。
///
/// 判据翻转（C2）：旧不变量是「始终只剩当前那一个单元」（排他挂载），新的前提是
/// 「挂载一个单元不释放任何别的单元」—— 两个单元都应常驻，而**重建次数**才是资源泄漏的判据
/// （每重建一套就再泄漏一套线程与文件描述符）。`watcher_set_creations` 直接量它：map 尺寸
/// 测不出「重复 insert 覆盖旧 handle」那条路径。
///
/// **不启动任何 OS 监听**：`without_real_fs` 用 `PlatformWatcher::Noop` 替换真实流，编排与
/// 状态机（幂等检查、票号签发、handle 登记）照常执行 —— 20 次真实建流只是给 macOS 的
/// fseventsd 交税（单次建流有系统级成本，见 2026-10-10 事故）。真实目录上的「挂载/释放确实
/// 生效」由本文件 `repo_with_linked_worktree` 系列用例覆盖。
#[test]
fn repeated_switches_keep_both_units_without_rebuilding() {
    let tmp = tempfile::tempdir().unwrap();
    let main = tmp.path().join("repo");
    let worktree = tmp.path().join("repo-wt");
    let main_unit = main_unit(&main);
    let wt_unit = worktree_unit(&main, &worktree);

    let sink = CollectingSink::new();
    let manager = WatcherManager::new().without_real_fs();
    // 前置：两个单元都已挂载（各自建一套资源）。
    for unit in [&main_unit, &wt_unit] {
        assert_eq!(
            manager.ensure_mounted(vec![(unit.clone(), sink.clone())]),
            vec![unit.key()],
            "首次挂载是新建"
        );
    }
    for i in 0..20 {
        // 生产形态：可见集合每轮只含当前视图那一个单元（前端 C4 才发集合），但后端**不得**
        // 因此释放另一个 —— 它只是不在这一轮的集合里，不是不存在。
        let unit = if i % 2 == 0 { &wt_unit } else { &main_unit };
        let created = manager.ensure_mounted(vec![(unit.clone(), sink.clone())]);
        assert!(
            created.is_empty(),
            "第 {i} 次切换不得重建已挂载单元（重建=再泄漏一套线程/句柄），实际新建 {created:?}"
        );
        assert_eq!(
            manager.watched_units().len(),
            2,
            "第 {i} 次切换后两个单元都必须仍在表里（释放只由单元消失触发），实际 {:?}",
            manager.watched_units()
        );
        assert!(manager.is_watched(&main_unit) && manager.is_watched(&wt_unit));
    }
    assert_eq!(
        manager.watcher_set_creations(),
        2,
        "两个单元各只建一套资源（重复切换不得重建）"
    );

    // 收尾：单元消失（项目关闭 / worktree 删除）才是释放的唯一原因
    manager.unwatch(&main_unit);
    manager.unwatch(&wt_unit);
    assert!(
        manager.watched_units().is_empty(),
        "unwatch 必须能清空挂载，残留即资源累积"
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
    let manager = WatcherManager::new().without_real_fs();
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

/// **新鲜度栅栏（取代旧 R2.4 的「按是否挂载」守卫）**：判据是**时间**，不是资源状态。
///
/// 旧实现按「该单元是否挂载」拒写 pull —— 把资源状态当成了数据新鲜度的代理，于是未挂载单元
/// 的 pull 结果永远不可信（每次读都必须现算），而挂载单元在冷窗口里只能报错。
/// 现在判据是事实本身：**一轮重算的结果只在「它开始之后没有更新的登记落地」时才被采纳**。
///
/// 钉住的竞态形态不变：`compute_and_record` 的 git 子进程耗时以百毫秒计，期间 worker
/// 完全可能推送**更新**的数据；晚到的 pull 若照常写表，登记表盖的号还会让它看起来比被它
/// 覆盖的 push 更新 —— 前端按 version 门控就会接受这份旧数据（= 静默过期）。
#[test]
fn a_pull_started_before_a_newer_snapshot_is_discarded() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("repo");
    std::fs::create_dir_all(&root).unwrap();
    git2::Repository::init(&root).expect("init git repo");

    let unit = main_unit(&root);
    let manager = WatcherManager::new().without_real_fs();

    // 一轮 pull 的开始时刻
    let started = Instant::now();
    // 期间有更新的登记落地（同一条写入路径：push 也走 upsert）
    let newer = manager
        .record_pull(
            pull_snapshot(&unit, parse_porcelain("?? newer.txt")),
            started,
        )
        .expect("首份登记必须被采纳");
    // 晚到的旧结果
    let late = manager.record_pull(
        pull_snapshot(&unit, parse_porcelain("?? late.txt")),
        started,
    );
    assert!(late.is_none(), "晚到的旧 pull 不得覆盖更新的登记");
    assert_eq!(
        paths_of(&manager.snapshot(&unit).expect("槽位仍在").entries),
        vec![Path::new("newer.txt")],
        "登记表里留下的必须是更新的那份"
    );
    assert_eq!(
        manager.snapshot(&unit).expect("槽位仍在").version,
        newer.version
    );
}

/// 反方向：**在最后一次登记之后**才开始的重算必须被采纳 —— 即便是「挂载中」的单元。
///
/// 这条是旧 R2.4 守卫的直接反面：旧实现里挂载中的单元永远拒写 pull（回读槽位），
/// 于是「挂载了但 worker 没算出首个快照」的冷窗口只能报错（`NotFound("not available yet")`）。
#[test]
fn a_pull_started_after_the_last_snapshot_is_accepted_even_when_mounted() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("repo");
    std::fs::create_dir_all(&root).unwrap();
    git2::Repository::init(&root).expect("init git repo");
    std::fs::write(root.join("pushed.txt"), "x\n").unwrap();

    let unit = main_unit(&root);
    let sink = CollectingSink::new();
    let manager = WatcherManager::new().without_real_fs();
    manager.watch(unit.clone(), sink.clone());
    assert!(manager.poke_status_worker_and_wait(&unit, FIRST_EVENT_TIMEOUT));
    let push = manager.snapshot(&unit).expect("push 快照必须已落地");

    let accepted = manager.record_pull(
        pull_snapshot(&unit, parse_porcelain("?? from-a-later-pull.txt")),
        Instant::now(),
    );
    let accepted = accepted.expect("挂载中单元的**更新**重算必须被采纳");
    assert!(
        accepted.version > push.version,
        "采纳的重算必须比它之前那份更新：{} <= {}",
        accepted.version,
        push.version
    );
    assert_eq!(
        paths_of(&manager.snapshot(&unit).expect("槽位仍在").entries),
        vec![Path::new("from-a-later-pull.txt")]
    );
}

/// **AC1 的直接判据**：挂载另一个单元（哪怕是**别的项目**）**不得释放**任何已有挂载。
///
/// 这是旧不变量「全局至多一套挂载」的反方向断言（C2 改写，不是删除）：互踢的结构性消失点
/// 就在于「没有互斥槽位可抢」—— 只要这条成立，主仓与 linked worktree 交替激活就只是两次
/// 幂等挂载，各自的 worker / FSEvents 流 / manifest 一次建好、不再销毁重建。
#[test]
fn mounting_the_target_keeps_every_other_unit() {
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
        WorkspaceRef::resolve("p2", &other.to_string_lossy(), None, &ExecTarget::Local).unwrap();

    let sink = CollectingSink::new();
    let manager = WatcherManager::new().without_real_fs();
    let created = manager.ensure_mounted(vec![
        (unit_a.clone(), sink.clone()),
        (unit_other_project.clone(), sink.clone()),
    ]);
    assert_eq!(created.len(), 2, "两个单元都是新建，实际 {created:?}");
    assert_eq!(manager.watched_units().len(), 2);

    // 挂载 unit_b（生产形态：`activate()` 现在就是单元素集合的 `ensure_mounted`）
    let created = manager.ensure_mounted(vec![(unit_b.clone(), sink.clone())]);
    assert_eq!(created, vec![unit_b.key()], "只有目标单元是新建的");

    assert_eq!(
        manager.watched_units().len(),
        3,
        "三个单元必须同时在表里（清单即互踢已消失），实际 {:?}",
        manager.watched_units()
    );
    for unit in [&unit_a, &unit_b, &unit_other_project] {
        assert!(
            manager.is_watched(unit),
            "挂载目标不得释放任何其它单元：{} 被摘了",
            unit.thread_tag()
        );
    }
}

/// **R1.1 / AC1 的最小形态**：依次挂载 A、B 之后两者都在表里。
///
/// 这是本任务的红→绿判据：在「至多一套挂载」的实现下，挂 B 会先释放 A，第二句断言必红。
/// 它同时钉住幂等的另一半 —— 已经挂上的 A 不会被 B 的挂载重建（`watcher_set_creations`
/// 每单元恰好一次）。
#[test]
fn mounting_two_units_keeps_both_mounted() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("repo");
    let worktree = tmp.path().join("repo-wt");
    for dir in [&root, &worktree] {
        std::fs::create_dir_all(dir).unwrap();
        git2::Repository::init(dir).expect("init git repo");
    }

    let unit_a = main_unit(&root);
    let unit_b = worktree_unit(&root, &worktree);
    let sink = CollectingSink::new();
    let manager = WatcherManager::new().without_real_fs();

    assert_eq!(
        manager.ensure_mounted(vec![(unit_a.clone(), sink.clone())]),
        vec![unit_a.key()],
        "首次挂载 A 是新建"
    );
    assert!(manager.is_watched(&unit_a));

    assert_eq!(
        manager.ensure_mounted(vec![(unit_b.clone(), sink.clone())]),
        vec![unit_b.key()],
        "挂载 B 是新建，且不得重建 A"
    );
    assert!(
        manager.is_watched(&unit_a),
        "挂载 B 不得释放 A（互斥槽位已删除）"
    );
    assert!(manager.is_watched(&unit_b));

    let watched = manager.watched_units();
    assert_eq!(watched.len(), 2, "两个单元必须同时在表里，实际 {watched:?}");
    assert!(watched.contains(&unit_a.key()) && watched.contains(&unit_b.key()));
    assert_eq!(
        manager.watcher_set_creations(),
        2,
        "每个单元各建一套资源（重申/并存都不重建）"
    );
}

/// **凭证闸门 · 正当路径**：挂载在册 ⇒ 当期票号的 Push 必须写入且 emit。
///
/// 闸门的第一半是「不得误杀合法推送」—— worker 冷启动的首个快照在 handle 登记之前就
/// 可能到达（`watch()` 的设计），票号因此先于 worker 签发。本测试用与 worker 回调
/// **同一条** `deliver_push` 显式投递，不依赖线程时序。
#[test]
fn push_with_current_ticket_is_written_and_emitted() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("repo");
    std::fs::create_dir_all(&root).unwrap();
    git2::Repository::init(&root).expect("init git repo");

    let unit = main_unit(&root);
    let sink = CollectingSink::new();
    let manager = WatcherManager::new().without_real_fs();
    manager.watch(unit.clone(), sink.clone());
    assert!(
        manager.poke_status_worker_and_wait(&unit, FIRST_EVENT_TIMEOUT),
        "夹具前提：首轮重算落地（此后 worker 空闲 ⇒ 本次投递是唯一事件源）"
    );

    let ticket = manager
        .current_ticket(&unit.key())
        .expect("挂载在册 ⇒ 有票");
    let baseline = sink.count(GIT_STATUS_SNAPSHOT_EVENT);
    let stamped = manager
        .deliver_push_with_ticket(
            sink.clone(),
            &ticket,
            pull_snapshot(&unit, parse_porcelain("?? held.txt")),
        )
        .expect("当期票号的推送必须被接受");
    assert!(
        paths_of(&stamped.entries).contains(&Path::new("held.txt")),
        "写入槽位的必须就是这份快照"
    );
    assert!(
        sink.count(GIT_STATUS_SNAPSHOT_EVENT) > baseline,
        "接受即伴随一次快照事件（worker 空闲 ⇒ 增量只能来自本次投递）"
    );
    assert_eq!(
        manager.snapshot(&unit).expect("槽位已写入").version,
        stamped.version,
        "事件与槽位同版本（注册表统一盖章）"
    );
}

/// **凭证闸门 · 释放后**：旧票的晚到推送必须被拒 —— 不写槽位、不 emit、票号已注销。
///
/// 这是 2026-10 CI 竞态的确定性复现：worker 的推送回调活在 `watch()` 栈之外，释放后仍可能
/// 在飞；此前没有任何校验，晚到推送会把已作废的槽位重新填上权威数据（概率性暴露 ⇒ 只在慢机
/// CI 偶发）。C2 保留票号正是为了这条 —— `unwatch`（worktree 被删 / 项目移除）依然存在。
#[test]
fn push_after_release_with_stale_ticket_is_rejected() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("repo");
    std::fs::create_dir_all(&root).unwrap();
    git2::Repository::init(&root).expect("init git repo");

    let unit = main_unit(&root);
    let sink = CollectingSink::new();
    let manager = WatcherManager::new().without_real_fs();
    manager.watch(unit.clone(), sink.clone());
    assert!(
        manager.poke_status_worker_and_wait(&unit, FIRST_EVENT_TIMEOUT),
        "夹具前提：首轮重算落地（此后 worker 空闲，不存在第三方事件源）"
    );
    let stale = manager
        .current_ticket(&unit.key())
        .expect("挂载在册 ⇒ 有票");

    let before_release = manager.snapshot(&unit).expect("释放前必须有权威数据");
    manager.unwatch(&unit);
    assert!(
        manager.current_ticket(&unit.key()).is_none(),
        "释放必须注销票号"
    );

    let baseline = sink.count(GIT_STATUS_SNAPSHOT_EVENT);
    let rejected = manager.deliver_push_with_ticket(
        sink.clone(),
        &stale,
        pull_snapshot(&unit, parse_porcelain("?? late.txt")),
    );
    assert!(rejected.is_none(), "释放后旧票号的推送必须被拒");
    // 「被拒」的判据是**数据一字未动**（不是「槽位必须为空」）：C1 起释放不丢数据，
    // 旧票晚到推送必须连号带内容都改不了。
    let after = manager.snapshot(&unit).expect("释放留下的权威数据仍在");
    assert_eq!(
        after.version, before_release.version,
        "被拒的推送不得推进号"
    );
    assert_eq!(
        paths_of(&after.entries),
        paths_of(&before_release.entries),
        "被拒的推送不得改写权威数据"
    );
    assert_eq!(
        sink.count(GIT_STATUS_SNAPSHOT_EVENT),
        baseline,
        "被拒的推送不得 emit（陈旧事件会把已释放单元重新画到界面上）"
    );
}

/// **凭证闸门 · 释放 → 重挂载**：旧挂载的晚到推送不得写进新挂载的槽位。
///
/// `watchers.contains_key` 形态的守卫会放行这种更隐蔽的变体（新挂载在册、但数据属于旧
/// worker，还会拿到更大 version 覆盖新数据）；票号以「单元 key + 序号」双重比对拒掉。
#[test]
fn remount_rejects_previous_mounts_late_push() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("repo");
    std::fs::create_dir_all(&root).unwrap();
    git2::Repository::init(&root).expect("init git repo");

    let unit = main_unit(&root);
    let sink = CollectingSink::new();
    let manager = WatcherManager::new().without_real_fs();
    manager.watch(unit.clone(), sink.clone());
    assert!(
        manager.poke_status_worker_and_wait(&unit, FIRST_EVENT_TIMEOUT),
        "夹具前提：首挂载首轮重算落地"
    );
    let stale = manager.current_ticket(&unit.key()).expect("首挂载有票");

    manager.unwatch(&unit);
    manager.watch(unit.clone(), sink.clone());
    assert!(
        manager.poke_status_worker_and_wait(&unit, FIRST_EVENT_TIMEOUT),
        "夹具前提：重挂载首轮重算落地（此后 worker 空闲）"
    );
    let fresh = manager.current_ticket(&unit.key()).expect("重挂载有新票");
    let before = manager.snapshot(&unit).expect("重挂载后槽位有权威数据");

    let rejected = manager.deliver_push_with_ticket(
        sink.clone(),
        &stale,
        pull_snapshot(&unit, parse_porcelain("?? from-stale-mount.txt")),
    );
    assert!(rejected.is_none(), "旧挂载的晚到推送必须被拒");
    let after = manager.snapshot(&unit).expect("槽位仍在");
    assert_eq!(
        after.version, before.version,
        "被拒的写入不得动槽位（version 不得推进）"
    );
    assert!(
        !paths_of(&after.entries).contains(&Path::new("from-stale-mount.txt")),
        "旧 worker 的数据不得出现"
    );

    let stamped = manager
        .deliver_push_with_ticket(
            sink.clone(),
            &fresh,
            pull_snapshot(&unit, parse_porcelain("?? from-fresh-mount.txt")),
        )
        .expect("重挂载的新票必须可用");
    assert!(
        paths_of(&stamped.entries).contains(&Path::new("from-fresh-mount.txt")),
        "新票的写入必须生效"
    );
}

/// **票号 compare-and-remove 的必备性**：并发「释放 + 重挂载」交错时，
/// 释放**不得**误吊销新挂载刚签发的票。
///
/// 为什么单靠 [`remount_rejects_previous_mounts_late_push`] 不够：那条的序列是
/// 完整的 `unwatch` → `watch`，此时「无条件删除」与「compare-and-remove」行为等价
/// （删除落点都是旧票）。真正区分两者的是**交错**：
///
/// ```text
/// 线程 A: release_one 取出 handle（票 = seq1），此时尚未执行吊销
/// 线程 B: watch() 挂载成功，签发 seq2
/// 线程 A: 执行吊销 —— 无条件删除会删掉 seq2（新挂载此后收不到任何数据）
/// ```
///
/// `release_one` 保证「取出 handle」与「吊销」在同一函数内先后发生，因此这里用
/// **直接构造该交错**的方式验证：先记下旧票，重新挂载拿到新票，再以旧票走一次
/// 与 `release_one` 相同的 compare-and-remove 路径。
///
/// 变异验证：把 `revoke_ticket_if` 的 `if tickets.get(key) == Some(&seq)` 改成无条件
/// `tickets.remove(key)` ⇒ 本用例变红（新票被误杀）。
#[test]
fn release_does_not_revoke_a_ticket_issued_by_a_concurrent_remount() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("repo");
    std::fs::create_dir_all(&root).unwrap();
    git2::Repository::init(&root).expect("init git repo");

    let unit = main_unit(&root);
    let sink = CollectingSink::new();
    let manager = WatcherManager::new().without_real_fs();
    manager.watch(unit.clone(), sink.clone());
    let stale = manager.current_ticket(&unit.key()).expect("首挂载有票");

    // 交错：新旧票同时存在过（模拟「A 已取出 handle、B 已完成重挂载」的中间态）。
    manager.unwatch(&unit);
    manager.watch(unit.clone(), sink.clone());
    let fresh = manager.current_ticket(&unit.key()).expect("重挂载有新票");
    assert_ne!(
        stale.seq, fresh.seq,
        "夹具前提：重挂载必须签发新票（否则本用例区分不了两种吊销策略）"
    );

    // 释放**旧挂载**（此时注册表里挂着的是新票）：不得动到 fresh。
    // 这一句等价于 `release_one` 的票号分支 —— 旧 handle 的 ticket 就是 `stale`。
    manager.revoke_dead_mount_for_test(&stale);

    assert_eq!(
        manager.current_ticket(&unit.key()).map(|t| t.seq),
        Some(fresh.seq),
        "旧挂载的释放不得误吊销新挂载的票（误杀 = 新挂载此后收不到任何数据）"
    );

    // 新票必须仍然可用 —— 这是「误吊销」真正的后果，不只差一个 HashMap 条目。
    let stamped = manager
        .deliver_push_with_ticket(
            sink.clone(),
            &fresh,
            pull_snapshot(&unit, parse_porcelain("?? still-writable.txt")),
        )
        .expect("新票必须仍然有效");
    assert!(
        paths_of(&stamped.entries).contains(&Path::new("still-writable.txt")),
        "新挂载的写入必须生效"
    );
}

/// 号段单调：**同一个不变量**的四条操作序列（R4：由三条用例合并成一条）。
///
/// 不变量：`version` 由注册表（`version_floors`）单点签发，**释放只作废数据、不作废号段**。
/// 打破它 = 「切走再切回」的第一份快照被前端闸门（`version <= prev` 丢弃）静默扔掉，
/// 界面继续显示离开时的旧数据 —— 正是 issue #2「需要手动刷新才恢复」的形态。
///
/// **为什么合并**：原 `unmounted_pulls_advance_the_same_registry_sequence` /
/// `remount_continues_the_unit_version_sequence` / `pull_after_a_release_still_continues_the_sequence`
/// 三兄弟各自重复构造一遍夹具，验的是同一条不变量；差别只在「用哪种操作序列破它」。
/// 合并后**每条失败模式仍各有一个子场景**（见下 ①–④），不是按行数砍覆盖：
///
/// | 子场景 | 失败模式（改坏什么会红） |
/// | --- | --- |
/// | ① pull → pull | 号源改成「每次 pull 从 1 起」/ 未挂载 pull 不登记 |
/// | ② 挂载内 push → push | worker 推送不走注册表盖章 |
/// | ③ 释放 → 重挂载 | `release_one` 连带清 `version_floors`（原缺陷） |
/// | ④ 挂载 → 释放 → pull | 释放后的 pull 另起号段 |
///
/// 变异验证：把 `release_one` 改成同时 `version_floors.remove(workspace)` ⇒ ③④ 变红。
#[test]
fn version_sequence_stays_monotonic_across_every_producer_and_release() {
    let tmp = tempfile::tempdir().unwrap();
    // 真 git 仓库夹具：`watch()` 会驱动 worker 跑一次真 `git status`，非仓库目录产不出快照
    let (main, worktree) = repo_with_linked_worktree(tmp.path());
    let unit = worktree_unit(&main, &worktree);
    let sink = CollectingSink::new();
    // 断言对象是 **version 号段**（纯内存状态机），不需要真实内核投递。
    let manager = WatcherManager::new().without_real_fs();
    assert!(!manager.is_watched(&unit), "夹具前提：起始未挂载");

    // ① pull → pull：未挂载单元（WSL / SSH / 侧栏取计数）两次算出的号必须递增。
    let first_pull = manager
        .record_pull(
            pull_snapshot(&unit, parse_porcelain("?? a.txt")),
            Instant::now(),
        )
        .expect("首份登记必须被采纳");
    let second_pull = manager
        .record_pull(
            pull_snapshot(&unit, parse_porcelain("?? b.txt")),
            Instant::now(),
        )
        .expect("后一份登记必须被采纳");
    assert_eq!(first_pull.version, 1, "号源从 1 起");
    assert_eq!(
        second_pull.version,
        first_pull.version + 1,
        "① 后一次 pull 必须比前一次新（否则前端闸门会留下旧的那份）"
    );
    assert_eq!(
        paths_of(&manager.snapshot(&unit).expect("槽位仍在").entries),
        vec![Path::new("b.txt")],
        "① 未挂载单元的数据源就是 pull 本身"
    );
    assert_eq!(second_pull.workspace_key, unit.key());
    let mut high_water = second_pull.version;

    // ② 挂载内：worker 的 push 与 pull 共用同一条号段（挂载首轮也必须接在后面）。
    manager.watch(unit.clone(), sink.clone());
    let mounted = wait_for_snapshot_newer_than(&manager, &unit, high_water);
    assert!(
        mounted.version > high_water,
        "② 挂载首轮快照要接在同一号段之后：{} <= {}",
        mounted.version,
        high_water
    );
    high_water = mounted.version;

    std::fs::write(worktree.join("in-cycle.txt"), "x\n").unwrap();
    assert!(
        manager.poke_status_worker_and_wait(&unit, FIRST_EVENT_TIMEOUT),
        "② 夹具前提：写后 poke 必须落地"
    );
    let in_cycle = manager.snapshot(&unit).expect("写后快照");
    assert!(
        paths_of(&in_cycle.entries).contains(&Path::new("in-cycle.txt")),
        "② 写后快照必须含本轮写入"
    );
    assert!(
        in_cycle.version > high_water,
        "② 同一挂载周期内 version 必须前进：{high_water} -> {}",
        in_cycle.version
    );
    assert!(
        manager.poke_status_worker_and_wait(&unit, FIRST_EVENT_TIMEOUT),
        "② 二次 poke 仍必须落地"
    );
    let after_poke = manager.snapshot(&unit).expect("二次 poke 后快照");
    assert!(
        after_poke.version >= in_cycle.version,
        "② 号段只能前进不能倒退：{} -> {}",
        in_cycle.version,
        after_poke.version
    );
    high_water = after_poke.version;

    // ③ 释放 → 重挂载：数据保留，号段不得退回（原缺陷：每次释放号都从 1 重新起）。
    manager.unwatch(&unit);
    let kept = manager
        .snapshot(&unit)
        .expect("③ 释放只释放资源，不丢弃权威数据（C1）");
    assert_eq!(
        kept.version, high_water,
        "③ 释放后保留的必须是切走前那份最新数据"
    );
    manager.watch(unit.clone(), sink.clone());
    let after_remount = wait_for_snapshot_newer_than(&manager, &unit, high_water);
    assert!(
        after_remount.version > high_water,
        "③ version 跨挂载周期也必须单调：切回后的第一份是 {}，而前端槽位里还留着切走前的 {}\
         ，`version <= prev` 会把这份新数据静默丢弃",
        after_remount.version,
        high_water
    );
    high_water = after_remount.version;
    manager.unwatch(&unit);

    // ④ 释放之后 pull：号不得回退到切走前那一段。
    let after_release_pull = manager
        .record_pull(
            pull_snapshot(&unit, parse_porcelain("?? c.txt")),
            Instant::now(),
        )
        .expect("释放之后的重算必须被采纳（数据与资源生命周期解耦）");
    assert!(
        after_release_pull.version > high_water,
        "④ 释放之后 pull 拿到的号不得回退到切走前那一段：{} <= {}",
        after_release_pull.version,
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
/// 生产代码（notify → ThrottleScheduler → `worker.check()` → `deliver_push` → `sink.emit`），
/// 因此两者的差值就是「worktree 单元有没有被特殊地拖慢」—— 这正是 AC4 要的对比。
///
/// **这里必须用真实 FSEvents**（`WatcherManager::new()`，不带 `without_real_fs`）：
/// 被测对象就是「内核投递 + 调度 + 重算 + 盖章」这条**完整链路**的墙钟耗时。
/// 用 `Noop` 替身会把链路首段抽掉，测出来的只是 debounce + worker 的耗时，
/// 那不是 AC4 要回答的问题（且会因永不投递事件而在第 0 轮超时）。
/// 因此本测量 `#[ignore]` + 串行闸，不进 CI。
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
    // 整数 ceil 除法：`ceil((n-1)·pct/100)`，与浮点写法等价但无 `as` 截断/符号风险。
    let rank = ((sorted.len() - 1) * pct).div_ceil(100);
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
    let _guard = real_fs_guard();
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

// ── 挂载集合的并发判据（C2 翻转）────────────────────────────────────────────
//
// 新不变量（旧 D-B 已反转）：「可见集合里的每个单元都可以同时挂载」。它仍属于**资源所有者**：
// `ensure_mounted` 在同一临界区内完成「已挂载则不重建」的判定与登记（`watch_lock`），
// 因此并发调用既不会互踢、也不会给同一单元建出两套监听。

/// 指定项目 id 的主仓形态单元（key 只含 project_id，故两单元必须用不同 project id 才不同址）。
fn workspace_of(project_id: &str, root: &Path) -> WorkspaceRef {
    WorkspaceRef::resolve(
        project_id,
        &root.to_string_lossy(),
        None,
        &ExecTarget::Local,
    )
    .expect("tempdir-derived unit path must resolve")
}

/// 并发挂**不同**单元：两个都必须挂上（且各建一套资源）—— 互斥槽位已删除。
///
/// 旧判据是「最终恰好一套挂载」（互踢的正方向）。C2 删除排他后，同一个布障并发必须得到
/// **2 套**：既没有谁被释放，也没有谁被重复建。
#[test]
fn concurrent_mount_of_different_units_keeps_both_mounted() {
    let tmp = tempfile::tempdir().unwrap();
    let dir_a = tmp.path().join("unit-a");
    let dir_b = tmp.path().join("unit-b");
    std::fs::create_dir_all(&dir_a).unwrap();
    std::fs::create_dir_all(&dir_b).unwrap();

    let manager = WatcherManager::new().without_real_fs();
    let sink = CollectingSink::new();
    // 两个线程在同一时刻冲进 `ensure_mounted`
    let barrier = Arc::new(std::sync::Barrier::new(2));
    let units = [workspace_of("p1", &dir_a), workspace_of("p2", &dir_b)];
    let keys: Vec<String> = units.iter().map(WorkspaceRef::key).collect();

    let handles: Vec<_> = units
        .into_iter()
        .map(|unit| {
            let manager = manager.clone();
            let sink = Arc::clone(&sink) as Arc<dyn super::super::sink::WatcherEventSink>;
            let barrier = Arc::clone(&barrier);
            std::thread::spawn(move || {
                barrier.wait();
                let _ = manager.ensure_mounted(vec![(unit, sink)]);
            })
        })
        .collect();
    for handle in handles {
        handle.join().expect("mount thread should not panic");
    }

    assert_eq!(
        manager.watched_units().len(),
        2,
        "并发挂载两个不同单元后两者都必须常驻（互斥槽位已删除）：{:?}",
        manager.watched_units()
    );
    for key in &keys {
        assert!(
            manager.watched_units().contains(key),
            "{key} 被另一个单元的挂载释放了（排他语义回潮）"
        );
    }
    assert_eq!(
        manager.watcher_set_creations(),
        2,
        "两个单元各建一套资源，不得互相重建"
    );
}

/// 并发挂**同一**单元：只允许建一套 watcher（重复挂载会翻倍投递事件并再泄漏一套线程）。
#[test]
fn concurrent_mount_of_same_unit_creates_exactly_one_watcher_set() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("ws");
    std::fs::create_dir_all(&dir).unwrap();
    let unit = workspace_of("p1", &dir);

    let manager = WatcherManager::new().without_real_fs();
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
                let _ = manager.ensure_mounted(vec![(unit, sink)]);
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

/// 重申挂载同一单元 = 空操作（`ensure_mounted` 的语义是「确保该单元挂载」，不是「注册一次」）。
///
/// 契约来源：调用方会**合法地**重申同一单元 —— 前端首个快照未落地时的有界重试，以及激活态被
/// 后端改写成 canonical 形态后的一次重发。重申若直接转给 `watch`，每次都命中它的「重复注册」
/// 告警分支；那条 WARN 的诊断语义是「有人绕过了唯一挂载入口」（D-B 落地前正是它暴露了启动期
/// 双发起点，现场核对以「0 条 already watched」为证据），被合法路径触发即失效。
///
/// 本用例钉住重申的**可观察契约**：不重建资源、不动挂载集合、不释放任何单元。
#[test]
fn ensure_mounted_reasserting_same_unit_is_a_noop() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().to_path_buf();
    let sink = CollectingSink::new();
    let manager = WatcherManager::new().without_real_fs();

    assert_eq!(
        manager.ensure_mounted(vec![(main_unit(&root), sink.clone())]),
        vec![main_unit(&root).key()],
        "首次挂载是新建的那一个单元"
    );
    assert_eq!(manager.watcher_set_creations(), 1);

    assert!(
        manager
            .ensure_mounted(vec![(main_unit(&root), sink.clone())])
            .is_empty(),
        "重申挂载不得新建、也不得释放任何单元（含自身）"
    );
    assert_eq!(
        manager.watcher_set_creations(),
        1,
        "重申挂载不得重建 watcher（重建=再泄漏一套线程/句柄）"
    );
    assert_eq!(manager.watched_units(), vec![main_unit(&root).key()]);

    // 重申不能被实现成「摘掉再挂」：事件投递必须仍然可用
    let mut feed = manager.take_test_event_sink().expect("回调");
    feed_content_change(&mut feed, &root.join("after-reassert.txt"));
    assert!(
        wait_for_event(&sink, FILE_CHANGED_EVENT, Duration::from_secs(2)),
        "重申挂载后事件投递必须仍然可用"
    );
}

/// 并发 pull **同一未挂载单元**：取号互不撞号，槽位永远收敛到最大号且条目与号同轮。
///
/// 钉住的竞态形态：旧实现里取号（`version_floors` 锁）与槽位插入（`store` 锁）是两次
/// 独立持锁，并发生产者能交错出「取小号却后插入」—— 槽位回退到旧数据而号段已前进，
/// 下一份快照无缝接号，前端 version 闸门对这段陈旧窗口毫无感知。修法是守卫+取号+插入
/// 同一次 `store` 持锁（见 `stamp_and_insert` 的锁纪律）。
#[test]
fn concurrent_pulls_on_one_unit_never_regress_the_slot() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("ws");
    std::fs::create_dir_all(&dir).unwrap();
    let unit = workspace_of("p1", &dir);
    let manager = WatcherManager::new().without_real_fs();
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
                let snap = manager.record_pull(
                    pull_snapshot(&unit, parse_porcelain(&format!("?? f{i}.txt"))),
                    Instant::now(),
                );
                snap.map(|snap| (snap.version, snap.entries[0].path.clone()))
            })
        })
        .collect();
    let results: Vec<_> = handles
        .into_iter()
        .map(|h| h.join().expect("pull thread should not panic"))
        .collect();

    // 新鲜度栅栏允许「开始得更早的那轮被丢弃」（并发下合法的合并），因此断言的是
    // 「被采纳的那些**恰好取走连续的号**」—— 不得撞号、不得跳号；被丢弃的那几轮不取号。
    let accepted: Vec<(u64, std::path::PathBuf)> = results.into_iter().flatten().collect();
    assert!(!accepted.is_empty(), "并发重算至少有一轮必须被采纳");
    let mut versions: Vec<u64> = accepted.iter().map(|(v, _)| *v).collect();
    versions.sort_unstable();
    let expected: Vec<u64> = (1..=accepted.len() as u64).collect();
    assert_eq!(
        versions, expected,
        "被采纳的重算必须取走连续号（不撞号、不跳号）"
    );

    // 槽位必须收敛到最大号，且条目正是拿到最大号那一轮的数据（不得「取小号后插入」回退）
    let slot = manager.snapshot(&unit).expect("槽位必须在");
    assert_eq!(slot.version, accepted.len() as u64);
    let (max_version, max_path) = accepted
        .iter()
        .max_by_key(|(v, _)| *v)
        .expect("accepted 非空");
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
    // 不建真实流：投喂「`.git/refs/remotes/**` 变更」合成事件，验证
    // 「纯 ref 变化 → scheduler → worker 重算 → 推送快照」不依赖手动 poke。
    let manager = WatcherManager::new().without_real_fs();
    manager.watch(unit.clone(), sink.clone());
    assert!(
        manager.poke_status_worker_and_wait(&unit, FIRST_EVENT_TIMEOUT),
        "夹具前提：挂载即应产出首份快照"
    );
    let mut feed = manager
        .take_test_event_sink()
        .expect("noop 模式必须交出回调");
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
    // 投喂 refs 变更事件（真实 FS 下内核会产生）
    // ⚠️ 必须归一：`resolve_git_meta_paths` 对 git_dir 做了 `canonicalize`
    // （macOS 的 tempdir 在 `/var` → `/private/var` 符号链接下），未归一的路径
    // 与分类用的 `refs_dir` 前缀不匹配 ⇒ 事件被归为 Nothing。
    // 真实 FSEvents 上报的也是 realpath，故这里归一是**忠实模拟**，不是测试取巧。
    let fed_path = main
        .join(".git")
        .join(&upstream_ref)
        .canonicalize()
        .expect("fed path must canonicalize");
    feed_content_change(&mut feed, &fed_path);

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
