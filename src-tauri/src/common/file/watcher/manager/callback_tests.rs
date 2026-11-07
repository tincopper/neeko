//! A 层回调测试：直接喂合成 `notify::Event` 给 `build_notify_callback`。
//!
//! **为什么不走真实 FSEvents**：`build_notify_callback` 的 9 个参数全是 channel /
//! trait object / 纯值，返回 `impl FnMut(Result<Event, _>)` —— 它本身就是纯函数。
//! 原先所有测试都从「真实文件变更」进入，绕 FSEvents 投递 → 内核 → debounce 线程
//! 三层异步，只为验证这一层的行为（实测代价：27 条并发流让 fseventsd 到 95%+）。
//!
//! **本文件的约束**：
//! - 零 `std::thread::sleep` —— 同步调用回调，同步断言（唯一例外：规则-缓存
//!   联动用例是 `#[tokio::test]`，无 sleep）；
//! - 不建任何 watcher / 不建真实 git 仓库（`GitIgnoreFilter` 只需 tempdir 里的
//!   `.gitignore` 文本；规则-缓存联动用例额外需要 `.git` **目录标记**喂
//!   `is_git_repo`、并经 `resolve_gitignore_filter` 预置读层缓存 —— 两者都不建流）。
//!
//! 需要验证「事件确实从内核到达」的用例不在本文件（那是 C 层，见 `lifecycle_tests`）。

use super::callbacks::build_notify_callback;
use crate::common::executor::factory::ExecTarget;
use crate::common::file::watcher::debounce::TreeChangeMsg;
use crate::common::file::watcher::gitignore::GitIgnoreFilter;
use crate::common::file::watcher::registration::WatchMaintenance;
use crate::common::file::watcher::sink::test_support::CollectingSink;
use crate::common::file::watcher::types::FILE_TREE_CHANGED_EVENT;
use crate::common::git::WorkspaceRef;
use notify::event::{CreateKind, DataChange, ModifyKind};
use notify::{Event, EventKind};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc};

/// 回调测试的完整夹具：全部 channel + sink，**无 watcher**。
struct CallbackHarness {
    callback: Box<dyn FnMut(Result<Event, notify::Error>)>,
    sink: Arc<CollectingSink>,
    maintenance_rx: mpsc::Receiver<WatchMaintenance>,
    debounce_rx: mpsc::Receiver<PathBuf>,
    tree_rx: mpsc::Receiver<TreeChangeMsg>,
    scheduler_rx: mpsc::Receiver<()>,
}

impl CallbackHarness {
    fn new(root: &Path, git_repo: bool) -> Self {
        Self::with_filter(root, git_repo, true)
    }

    /// `with_filter=false` 时传 `None`，即**非 git 单元**路径 —— 此时
    /// `relevant_event_paths` 走 `is_hard_noise_path` 分支（`classify.rs:9-20`）。
    /// 这是唯一能真正验证 `classify.rs` 自身 hard-noise 判据的形态；
    /// 传 `Some(filter)` 时该判据由 `GitIgnoreFilter::should_ignore` 内部承担
    /// （`gitignore.rs:242`），测的是另一层。
    fn with_filter(root: &Path, git_repo: bool, use_filter: bool) -> Self {
        Self::with_git_meta(root, git_repo, use_filter, None)
    }

    /// 同 [`Self::with_filter`]，但启用**合并路径**的 git 元数据分支。
    ///
    /// 传 `Some(paths)` 时，回调内部会按生产顺序构造三条 git 元数据回调
    /// （`git_meta_merge::build_callbacks`，与 `core.rs` 同一构造点），
    /// 并复用本 harness 自己的 `scheduler_tx` —— 这样「index → 调度信号」
    /// 与「head → emit 事实」都能在 `scheduler_rx` / `sink` 上断言。
    fn with_git_meta(
        root: &Path,
        git_repo: bool,
        use_filter: bool,
        git_meta_paths: Option<crate::common::file::watcher::git_meta::GitMetaPaths>,
    ) -> Self {
        let repo = WorkspaceRef::resolve("p1", &root.to_string_lossy(), None, &ExecTarget::Local)
            .expect("tempdir-derived unit path must resolve");
        let sink = CollectingSink::new();
        let filter = use_filter.then(|| Arc::new(GitIgnoreFilter::new(root.to_path_buf())));

        let (maintenance_tx, maintenance_rx) = mpsc::channel();
        let (debounce_tx, debounce_rx) = mpsc::channel();
        let (tree_tx, tree_rx) = mpsc::channel();
        let (scheduler_tx, scheduler_rx) = mpsc::channel();

        let git_meta = git_meta_paths.map(|paths| {
            super::git_meta_merge::build_callbacks(
                &repo.key(),
                &repo,
                &paths,
                sink.clone(),
                Some(scheduler_tx.clone()),
            )
        });

        let cb = build_notify_callback(
            repo,
            sink.clone(),
            filter,
            maintenance_tx,
            debounce_tx,
            tree_tx,
            Some(scheduler_tx),
            git_repo,
            git_meta,
        );

        // 包一层：让调用方只喂 `Event` 而非 `Result`
        let boxed: Box<dyn FnMut(Result<Event, notify::Error>)> = Box::new(cb);

        Self {
            callback: boxed,
            sink,
            maintenance_rx,
            debounce_rx,
            tree_rx,
            scheduler_rx,
        }
    }

    fn feed(&mut self, kind: EventKind, path: &Path) {
        (self.callback)(Ok(Event::new(kind).add_path(path.to_path_buf())));
    }
}

/// 写一份 `.gitignore`（只是文本，不建流）。
fn write_gitignore(root: &Path, body: &str) {
    std::fs::write(root.join(".gitignore"), body).expect("write .gitignore");
}

// ── 内容事件过滤 ──────────────────────────────────────────────────────

#[test]
fn gitignored_path_is_dropped_before_reaching_sink() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    write_gitignore(root, "*.log\n");
    let mut h = CallbackHarness::new(root, false);

    h.feed(
        EventKind::Modify(ModifyKind::Data(DataChange::Content)),
        &root.join("debug.log"),
    );

    assert!(
        h.debounce_rx.try_recv().is_err(),
        "被 .gitignore 忽略的路径不得进入 file-changed debounce"
    );
    assert!(h.sink.event_names().is_empty(), "不得投递任何前端事件");
}

#[test]
fn normal_source_path_reaches_debounce() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    write_gitignore(root, "*.log\n");
    let mut h = CallbackHarness::new(root, false);
    let src = root.join("src").join("main.rs");

    h.feed(
        EventKind::Modify(ModifyKind::Data(DataChange::Content)),
        &src,
    );

    assert_eq!(
        h.debounce_rx.try_recv().ok(),
        Some(src),
        "可见源码路径必须投递给 file-changed debounce"
    );
}

/// 验证 `classify.rs` 自身的 hard-noise 判据。
///
/// **必须用 `None` filter**：传 `Some(filter)` 时 `.git` 由
/// `GitIgnoreFilter::should_ignore` 内部拦住（`gitignore.rs:242`），
/// `is_hard_noise_path` 在 `relevant_event_paths` 里根本不参与 ——
/// 那样的用例在「删掉 hard-noise 判据」时**不会变红**（已实测）。
#[test]
fn hard_noise_git_path_is_dropped_without_filter() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    // 非 git 单元：filter=None → relevant_event_paths 走 is_hard_noise_path 分支
    let mut h = CallbackHarness::with_filter(root, false, false);

    h.feed(
        EventKind::Modify(ModifyKind::Data(DataChange::Content)),
        &root.join(".git").join("index"),
    );

    assert!(
        h.debounce_rx.try_recv().is_err(),
        ".git 路径不得进入 debounce"
    );
    assert!(
        h.sink.event_names().is_empty(),
        ".git 不是项目内容，不得投递"
    );
    assert!(h.scheduler_rx.try_recv().is_err(), "不得驱动 git worker");
}

// ── 结构事件边界 ──────────────────────────────────────────────────────

#[test]
fn structure_event_keeps_ignored_root_boundary() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    write_gitignore(root, "target/\n");
    let mut h = CallbackHarness::new(root, false);
    let ignored_root = root.join("target");

    h.feed(EventKind::Create(CreateKind::Folder), &ignored_root);

    assert_eq!(
        h.tree_rx.try_recv().ok(),
        Some(TreeChangeMsg::Path(ignored_root)),
        "ignored 根自身的边界事件必须保留（灰节点更新）"
    );
}

#[test]
fn structure_event_drops_ignored_subtree_internal() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    write_gitignore(root, "target/\n");
    let mut h = CallbackHarness::new(root, false);

    h.feed(
        EventKind::Create(CreateKind::File),
        &root.join("target").join("x.o"),
    );

    assert!(
        h.tree_rx.try_recv().is_err(),
        "ignored 子树内部路径必须丢弃（否则每次构建都刷整棵树）"
    );
}

#[test]
fn non_structure_event_does_not_trigger_tree_refresh() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    write_gitignore(root, "");
    let mut h = CallbackHarness::new(root, false);

    h.feed(
        EventKind::Modify(ModifyKind::Data(DataChange::Content)),
        &root.join("a.txt"),
    );

    assert!(h.tree_rx.try_recv().is_err(), "内容事件不是结构事件");
}

// ── gitignore 规则热重载 ──────────────────────────────────────────────

#[test]
fn gitignore_change_triggers_reload_all() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    write_gitignore(root, "");
    let mut h = CallbackHarness::new(root, false);

    h.feed(
        EventKind::Modify(ModifyKind::Data(DataChange::Content)),
        &root.join(".gitignore"),
    );

    match h.maintenance_rx.try_recv() {
        Ok(WatchMaintenance::ReloadAll) => {}
        other => panic!("`.gitignore` 变更必须投递 ReloadAll，实际 = {other:?}"),
    }
}

/// `.gitignore` 纯内容编辑不是结构事件、不会自发触发树刷新，而 ignored 灰显
/// 只活在读层快照里（`FileNode.ignored` 在 loadDir/refreshTree 时计算一次）——
/// 规则变化后必须主动请求**全量**树刷新，否则已展示节点的灰显停在旧值
/// （一条根 `.gitignore` 规则可命中任意深度，定向重载单桶无法覆盖）。
#[test]
fn gitignore_content_change_requests_full_tree_refresh() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    write_gitignore(root, "");
    let mut h = CallbackHarness::new(root, false);

    h.feed(
        EventKind::Modify(ModifyKind::Data(DataChange::Content)),
        &root.join(".gitignore"),
    );

    assert_eq!(
        h.tree_rx.try_recv().ok(),
        Some(TreeChangeMsg::FullRefresh),
        "规则变化必须请求全量树刷新（空 dirs = 前端全树兜底）"
    );
}

/// `.git/info/exclude` 同属规则源，必须走同一条全量刷新请求。
#[test]
fn info_exclude_change_also_requests_full_tree_refresh() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    write_gitignore(root, "");
    std::fs::create_dir_all(root.join(".git").join("info")).unwrap();
    let mut h = CallbackHarness::new(root, false);

    h.feed(
        EventKind::Modify(ModifyKind::Data(DataChange::Content)),
        &root.join(".git").join("info").join("exclude"),
    );

    assert_eq!(
        h.tree_rx.try_recv().ok(),
        Some(TreeChangeMsg::FullRefresh),
        "exclude 规则变化必须同样请求全量树刷新"
    );
}

/// 规则变化必须连**读层现场构建的过滤器缓存**（`LOCAL_GITIGNORE_CACHE`）一起失效。
///
/// 漂移复盘：该缓存原由「worktree 区域回调」失效（`a15f7fb9`），per-unit 重构
/// （`200f6918`）删除该回调后失效点断线——缓存只在单元未挂载窗口被查询，但规则
/// 可在该窗口外变化且无人清缓存。挂载单元的 rules_changed 分支是规则变化的唯一
/// 权威观测点，必须顺带失效读层缓存。
///
/// 断言形态：预置缓存（未挂载读的同路径：existing=None → 现场构建入缓存）→ 喂
/// `.gitignore` 内容事件 → 同 root 再解析必须**重建**（非 `Arc::ptr_eq`）。
/// 无生产接线时本测试稳定红（缓存未清 → 命中缓存 → ptr_eq）。
///
/// 与 `services/tests/tree_read.rs` 的缓存测试共享全局缓存：干扰窗口仅为
/// 「插入 → 查询」的连续同步段（中间无调度点，微秒级），且本测试失败方向单一
/// （外来清空只会虚假变绿、不会偶发红；反向对彼测试是 ~10⁻⁷ 量级的理论红窗）
/// —— 不值得为此加跨文件测试互斥锁。
#[tokio::test]
async fn gitignore_change_invalidates_read_layer_filter_cache() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    std::fs::create_dir_all(root.join(".git")).unwrap();
    std::fs::write(root.join(".gitignore"), "*.log\n").unwrap();

    let first = crate::common::file::services::resolve_gitignore_filter(
        &ExecTarget::Local,
        None,
        root,
        &[],
    )
    .await
    .expect("预置缓存：首次现场构建");

    let mut h = CallbackHarness::new(root, false);
    h.feed(
        EventKind::Modify(ModifyKind::Data(DataChange::Content)),
        &root.join(".gitignore"),
    );

    let after = crate::common::file::services::resolve_gitignore_filter(
        &ExecTarget::Local,
        None,
        root,
        &[],
    )
    .await
    .expect("事件后同 root 再解析");
    assert!(
        !Arc::ptr_eq(&first, &after),
        "规则变化事件必须失效读层过滤器缓存（否则未挂载读命中旧规则）"
    );
}

// ── git 元数据分类的「单元身份」边界 ──────────────────────────────────
//
// 这两条守的是原 `writes_in_unmounted_sibling_unit_leak_nothing_into_mounted_unit`
// 里**唯一可证伪**的部分（历史缺陷：`.git/worktrees/**` 的事件被广播给所有消费者）。
//
// 为什么必须下沉到这个层：那条用例改成 `without_real_fs()` 之后，兄弟单元的写入
// **不产生任何事件**是由夹具构造（watcher = `Noop` + `skip_real_fs` 跳过 git_meta 流）
// 保证的，不是代码保证的 —— 断言退化成恒真。真正属于本仓判据的是回调层的两件事：
//   1. 落在**本单元** git_dir 下的路径 → 正确分类（index / refs / head）；
//   2. 落在**别的单元** gitdir 下的路径 → `Nothing`，不得驱动本单元重算。
// 这两条喂合成事件即可确定性覆盖，零流零 sleep。

/// 本单元 `.git/index` 写入 → 只发查询调度信号，**不** emit 事实（公理 1：信号≠事实）。
#[test]
fn own_git_index_event_signals_scheduler_without_emitting_a_fact() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    write_gitignore(root, "");
    std::fs::create_dir_all(root.join(".git").join("refs")).unwrap();

    let paths = super::super::git_meta::resolve_git_meta_paths(root)
        .expect("tempdir-derived git repo must resolve meta paths");
    let mut h = CallbackHarness::with_git_meta(root, true, false, Some(paths.clone()));

    // `paths.index` 由 `resolve_git_meta_paths` 从**已归一**的 git_dir 派生，
    // 与真实 FSEvents 上报的 realpath 同形态，可直接喂。
    h.feed(
        EventKind::Modify(ModifyKind::Data(DataChange::Content)),
        &paths.index,
    );

    assert!(
        h.scheduler_rx.try_recv().is_ok(),
        "本单元的 index 写入必须驱动一次查询调度"
    );
    assert!(
        h.debounce_rx.try_recv().is_err(),
        "index 是 git 元数据，不得进入 file-changed（否则与 git 写 index 形成自反馈）"
    );
    assert!(
        h.sink.event_names().is_empty(),
        "index 只发信号不发事实，实际投递了 {:?}",
        h.sink.event_names()
    );
}

/// **单元身份边界**：别的单元的 gitdir（`main/.git/worktrees/other/HEAD`）事件
/// 落在本单元的订阅范围内（同一棵树）时，必须归为 `Nothing` —— 不得驱动本单元重算。
///
/// 变异验证：把 `callbacks.rs` 里 `p.starts_with(&ctx.paths.git_dir)` 的前缀判定
/// 换成「路径含 `.git` 组件」⇒ 本用例变红（别的单元 HEAD 被当成本单元的 HEAD）。
#[test]
fn sibling_unit_gitdir_event_is_classified_as_nothing() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    write_gitignore(root, "");
    // 主仓私有 gitdir：`<root>/.git/`；兄弟单元的私有 gitdir 在
    // `<root>/.git/worktrees/other/`（真实 linked worktree 布局）。
    std::fs::create_dir_all(root.join(".git").join("refs")).unwrap();
    let sibling_gitdir = root.join(".git").join("worktrees").join("other");
    std::fs::create_dir_all(&sibling_gitdir).unwrap();
    // 兄弟单元的 HEAD 必须真实存在才能 `canonicalize`（见下方归一说明）。
    std::fs::write(sibling_gitdir.join("HEAD"), "ref: refs/heads/other\n").unwrap();

    let paths = super::super::git_meta::resolve_git_meta_paths(root)
        .expect("tempdir-derived git repo must resolve meta paths");
    let mut h = CallbackHarness::with_git_meta(root, true, false, Some(paths.clone()));

    // ⚠️ **必须归一后再喂**：`resolve_git_meta_paths` 对 git_dir 做了 `canonicalize`
    // （macOS 的 tempdir 在 `/var` → `/private/var` 符号链接下），未归一的路径过不了
    // 回调里的 `starts_with(&ctx.paths.git_dir)` 前缀判定 ⇒ 事件被提前判为「不碰 git_dir」
    // 而根本不进分类 —— 断言会**空过**（变异验证时抓到的正是这种假绿）。
    // 真实 FSEvents 上报的就是 realpath，故归一是忠实模拟，不是测试取巧。
    let sibling_head = root
        .join(".git")
        .join("worktrees")
        .join("other")
        .join("HEAD")
        .canonicalize()
        .expect("夹具路径必须能归一（父目录已创建）");
    h.feed(
        EventKind::Modify(ModifyKind::Data(DataChange::Content)),
        &sibling_head,
    );

    assert!(
        h.scheduler_rx.try_recv().is_err(),
        "别的单元的 HEAD 变化不得驱动本单元重算（跨单元泄漏的原始形态）"
    );
    assert!(
        h.sink.event_names().is_empty(),
        "别的单元的 HEAD 变化不得被当成本单元的 `git-changed` 广播，实际 {:?}",
        h.sink.event_names()
    );
    assert!(
        h.debounce_rx.try_recv().is_err(),
        "git 元数据路径不得进入 file-changed"
    );
}

// ── 测试模式与生产扇出同构 ──────────────────────────────────────────

/// **回归钉子**：`without_real_fs()` 交出的扇出器必须与生产选中的那条传输同构。
///
/// 钉住的缺陷形态（CI 实测，2026-10-26）：合成模式原先只交出主回调，于是
/// 「非 macOS → `merge=false` → 走独立流」的平台上，`.git/refs/**` 事件既不经合并
/// 分类（没合并），也不经独立流（被 `skip_real_fs` 跳过）—— **两条传输全无**，
/// 事件当硬噪声丢弃，用例却以为在验证生产链路。表现：macOS 绿、Linux/Windows 红。
///
/// 本用例断言的是**路由本身**，不依赖平台当前选哪条：refs 路径投进扇出器后，
/// 调度信号必须恰好出现一次（合并→回调内分类；不合并→独立流出口）。
/// 变异验证：删掉 `TestEventSinks::feed` 的 git-meta 分支（回到「只有主回调」）⇒
/// `merge=false` 那一轮计数为 0 ⇒ 本用例红。
#[test]
fn synthetic_sinks_route_git_paths_to_whichever_transport_is_live() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    write_gitignore(root, "");
    std::fs::create_dir_all(root.join(".git").join("refs").join("remotes")).unwrap();
    std::fs::write(root.join(".git").join("HEAD"), "ref: refs/heads/main\n").unwrap();

    let paths = super::super::git_meta::resolve_git_meta_paths(root)
        .expect("tempdir-derived git repo must resolve meta paths");
    let unit = crate::common::git::WorkspaceRef::resolve(
        "p1",
        &root.to_string_lossy(),
        None,
        &ExecTarget::Local,
    )
    .expect("unit path must resolve");

    // 两种传输形态各跑一遍：同一断言对两者都成立，不随平台能力位漂移而失效。
    for merge in [true, false] {
        let sink = CollectingSink::new();
        let (scheduler_tx, scheduler_rx) = mpsc::channel();
        let (maintenance_tx, _maintenance_rx) = mpsc::channel();
        let (debounce_tx, _debounce_rx) = mpsc::channel();
        let (tree_tx, _tree_rx) = mpsc::channel();

        let callbacks = super::git_meta_merge::build_callbacks(
            &unit.key(),
            &unit,
            &paths,
            sink.clone(),
            Some(scheduler_tx.clone()),
        );
        // 与 `core.rs` 同一互斥分配规则：合并 → 进主回调；不合并 → 进独立流出口。
        let (merged, standalone) = if merge {
            (Some(callbacks), None)
        } else {
            (None, Some(callbacks))
        };

        let main_cb = super::callbacks::build_notify_callback(
            unit.clone(),
            sink.clone(),
            None,
            maintenance_tx,
            debounce_tx,
            tree_tx,
            Some(scheduler_tx),
            true,
            merged,
        );
        let main_cb: Box<dyn FnMut(Result<notify::Event, notify::Error>) + Send> =
            Box::new(main_cb);

        let mut stream = super::core::TestWatchStream {
            main: main_cb,
            git_meta: standalone,
        };

        let ref_path = paths.refs_dir.join("remotes").join("origin").join("main");
        stream.feed(Ok(notify::Event::new(EventKind::Modify(ModifyKind::Data(
            DataChange::Content,
        )))
        .add_path(ref_path)));

        assert!(
            scheduler_rx.try_recv().is_ok(),
            "merge={merge}: refs 变化必须驱动一次查询调度 —— 两条传输不得同时落空"
        );
    }
}

// ── overflow / 错误事件 ───────────────────────────────────────────────

#[test]
fn error_event_emits_tree_changed_with_empty_dirs() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    write_gitignore(root, "");
    let mut h = CallbackHarness::new(root, false);

    (h.callback)(Err(notify::Error::generic("overflow")));

    // 错误事件 → 空 dirs 的 tree-changed（前端退回全树刷新）
    let names = h.sink.event_names();
    assert_eq!(
        names,
        vec![FILE_TREE_CHANGED_EVENT.to_string()],
        "overflow 必须投递一条 tree-changed，实际 = {names:?}"
    );
}
