//! registration 测试：计划纯函数 + Selective 状态机（mock watcher 注入，跨平台确定性）。

use super::super::gitignore::GitIgnoreFilter;
use super::strategy::{
    compute_watch_dirs, WatchRegistration, WatchStrategy, MAX_WATCH_DIRS, MAX_WATCH_FAILURES,
};
use notify::{EventHandler, RecursiveMode, Watcher};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex as StdMutex;

/// 计划纯函数：可见目录全部注册（浅→深），.git 与 ignored 子树排除
#[test]
fn compute_watch_dirs_includes_visible_and_excludes_ignored() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    std::fs::create_dir_all(root.join("src/deep")).unwrap();
    std::fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
    std::fs::create_dir_all(root.join(".git/objects")).unwrap();
    std::fs::write(root.join(".gitignore"), "node_modules/\n").unwrap();

    let filter = GitIgnoreFilter::new(root.to_path_buf());
    let plan = compute_watch_dirs(root, Some(&filter), 100);

    let names: Vec<String> = plan
        .iter()
        .map(|p| {
            p.strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/")
        })
        .collect();
    // 根 + src + src/deep；node_modules 与 .git 排除
    assert!(names.contains(&String::new()), "根目录必须注册");
    assert!(names.contains(&"src".to_string()) && names.contains(&"src/deep".to_string()));
    assert!(
        !names.iter().any(|n| n.contains("node_modules")),
        "ignored 子树不注册"
    );
    assert!(!names.iter().any(|n| n.contains(".git")), ".git 不注册");
}

/// max_dirs 截断：达到上限即截止（调用方据此降级整树）
#[test]
fn compute_watch_dirs_respects_cap() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    for i in 0..20 {
        std::fs::create_dir_all(root.join(format!("d{i}"))).unwrap();
    }
    let plan = compute_watch_dirs(root, None, 5);
    assert_eq!(plan.len(), 5);
}

/// 无 filter（非 git 项目）：全部目录可见（排除 .git 仍生效）
#[test]
fn compute_watch_dirs_without_filter_includes_all_but_git() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    std::fs::create_dir_all(root.join("a/b")).unwrap();
    std::fs::create_dir_all(root.join(".git/x")).unwrap();
    let plan = compute_watch_dirs(root, None, 100);
    assert_eq!(plan.len(), 3, "根 + a + a/b（.git 排除）");
}

/// 策略决策：非 git（filter=None）不得走 Selective（由 register_root 内部分派，
/// 此处断言平台常量存在性 + 枚举相等性语义）
#[test]
fn watch_strategy_platform_constant_defined() {
    // 平台差异必须经 platform facade 决策；这里同时验证 facade 与 enum 的映射。
    let selective = crate::platform::watch_strategy::watch_selectively();
    let strategy = WatchStrategy::for_platform();
    assert_eq!(
        strategy == WatchStrategy::Selective,
        selective,
        "watch strategy must follow platform::watch_strategy facade"
    );
    assert_ne!(WatchStrategy::Selective, WatchStrategy::Recursive);
}

fn selective_test_filter(root: &Path) -> GitIgnoreFilter {
    std::fs::write(root.join(".gitignore"), "ignored/\n").unwrap();
    GitIgnoreFilter::new(root.to_path_buf())
}

/// 注入式 mock watcher：`fail_paths` 中的目录 watch 失败（模拟 inotify
/// EMFILE / 权限拒绝），记录全部 watch/unwatch 调用供断言。
/// notify 对不可监听路径的行为三平台不统一，直接用真实 watcher 断言
/// 降级会 flaky —— 与 git_meta 的 watch_fn 注入先例同因。
struct FailureWatch {
    fail_paths: HashSet<PathBuf>,
    watched: StdMutex<Vec<(PathBuf, bool)>>, // (path, recursive)
    unwatched: StdMutex<Vec<PathBuf>>,
}

impl FailureWatch {
    fn new(fail_paths: &[&str]) -> Self {
        Self {
            fail_paths: fail_paths.iter().map(PathBuf::from).collect(),
            watched: StdMutex::new(Vec::new()),
            unwatched: StdMutex::new(Vec::new()),
        }
    }

    fn watched_recursive_count(&self) -> usize {
        self.watched
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, recursive)| *recursive)
            .count()
    }
}

impl Watcher for FailureWatch {
    fn new<F: EventHandler>(_event_handler: F, _config: notify::Config) -> notify::Result<Self> {
        // mock 不经 new 构造（测试直接 FailureWatch::new），占位满足 trait
        Err(notify::Error::generic(
            "FailureWatch is constructed directly",
        ))
    }

    fn kind() -> notify::WatcherKind {
        // 「Fake watcher for testing」——mock 语义正贴合
        notify::WatcherKind::NullWatcher
    }

    fn watch(&mut self, path: &Path, recursive_mode: RecursiveMode) -> notify::Result<()> {
        // fail_paths 为相对路径片段：按路径末端组件匹配（测试构造用相对名，
        // 而注册计划产出绝对路径）
        let matches_fail = path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| self.fail_paths.contains(Path::new(n)))
            .unwrap_or(false);
        if matches_fail {
            return Err(notify::Error::generic("simulated watch failure"));
        }
        self.watched.lock().unwrap().push((
            path.to_path_buf(),
            recursive_mode == RecursiveMode::Recursive,
        ));
        Ok(())
    }

    fn unwatch(&mut self, path: &Path) -> notify::Result<()> {
        self.unwatched.lock().unwrap().push(path.to_path_buf());
        Ok(())
    }
}

/// 降级路径 1：单目录 watch 连续失败 ≥ MAX_WATCH_FAILURES → 降级整树
/// （registered 清空 + 一次 Recursive 注册 + degraded 置位）。
#[test]
fn register_selective_degrades_after_repeated_failures() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    for i in 0..(MAX_WATCH_FAILURES + 2) {
        std::fs::create_dir_all(root.join(format!("d{i}"))).unwrap();
    }
    // 让每个目录都失败（覆盖根下全部计划目录）
    let fail_all: Vec<String> = (0..(MAX_WATCH_FAILURES + 2))
        .map(|i| format!("d{i}"))
        .collect();
    let mut watcher = FailureWatch::new(&fail_all.iter().map(String::as_str).collect::<Vec<_>>());

    let filter = selective_test_filter(root);
    let mut reg = WatchRegistration::default();
    reg.register_selective(&mut watcher, root, Some(&filter));

    assert!(
        watcher.watched_recursive_count() >= 1,
        "降级后必须有一次整树 Recursive 注册"
    );
    // root 成功注册后，子目录连续失败触发降级；降级必须先解除 root。
    // 混合成功/失败场景的完整 unwatch 断言见下方「部分失败后降级」用例。
    assert_eq!(watcher.unwatched.lock().unwrap().len(), 1);
}

/// 部分成功 + 连续失败阈值 → 降级时先解除已成功注册的目录（drain 语义）
#[test]
fn register_selective_degrade_unwatches_partially_registered() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    // 2 个可成功目录 + MAX_WATCH_FAILURES 个连续失败目录（顺序计划：先成功后失败）
    for i in 0..2 {
        std::fs::create_dir_all(root.join(format!("ok{i}"))).unwrap();
    }
    for i in 0..=MAX_WATCH_FAILURES {
        std::fs::create_dir_all(root.join(format!("bad{i}"))).unwrap();
    }
    let fail: Vec<String> = (0..=MAX_WATCH_FAILURES)
        .map(|i| format!("bad{i}"))
        .collect();
    let mut watcher = FailureWatch::new(&fail.iter().map(String::as_str).collect::<Vec<_>>());

    let mut reg = WatchRegistration::default();
    // 手动走 Selective（绕过平台分派；当前平台若为 macOS/Windows 也可测状态机）
    let filter = selective_test_filter(root);
    reg.register_selective(&mut watcher, root, Some(&filter));

    assert!(reg.degraded, "连续失败达阈值必须降级");
    assert_eq!(
        watcher.watched_recursive_count(),
        1,
        "降级整树 Recursive 注册一次"
    );
    assert_eq!(
        watcher.unwatched.lock().unwrap().len(),
        3,
        "降级时解除全部已成功注册目录（root + ok0 + ok1）"
    );
}

/// 降级路径 2：计划目录数 ≥ MAX_WATCH_DIRS → 直接降级整树（不逐个尝试）
#[test]
fn register_selective_degrades_when_plan_exceeds_cap() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    for i in 0..(MAX_WATCH_DIRS + 2) {
        // 子目录数远超上限（扁平目录树，read_dir 成本可控）
        std::fs::create_dir_all(root.join(format!("x{i}"))).unwrap();
    }
    let filter = selective_test_filter(root);
    let mut watcher = FailureWatch::new(&[]);
    let mut reg = WatchRegistration::default();
    reg.register_selective(&mut watcher, root, Some(&filter));

    assert_eq!(watcher.watched_recursive_count(), 1, "超限直接整树注册一次");
    assert!(
        watcher.watched.lock().unwrap().len() <= 2,
        "超限路径不得逐目录注册（root Recursive + 可能的降级 Recursive）"
    );
}

/// 维护路径：on_dir_added 对新增可见子树补 NonRecursive 注册；
/// 降级后为 no-op。
#[test]
fn on_dir_added_registers_new_subtree_and_noop_after_degrade() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    let mut watcher = FailureWatch::new(&[]);
    let mut reg = WatchRegistration::default();
    reg.register_root(&mut watcher, root, None::<&GitIgnoreFilter>);

    let added = root.join("new-dir");
    std::fs::create_dir_all(&added).unwrap();
    reg.on_dir_added(&mut watcher, root, &added, None);
    // 非 git（filter=None）→ register_root 走整树，on_dir_added 短路：
    // 不产生额外 NonRecursive 注册
    let nonrecursive = watcher
        .watched
        .lock()
        .unwrap()
        .iter()
        .filter(|(_, r)| !*r)
        .count();
    assert_eq!(nonrecursive, 0, "无 filter 时维护不逐目录注册");

    // 降级态短路：degraded 后维护 no-op
    reg.degrade_recursive(&mut watcher, root);
    let before = watcher.watched.lock().unwrap().len();
    reg.on_dir_added(&mut watcher, root, &added, None);
    assert_eq!(
        watcher.watched.lock().unwrap().len(),
        before,
        "降级后维护 no-op"
    );
}

/// 删除/移出目录后，必须清除该目录及其子孙的注册状态，避免 stale。
#[test]
fn on_dir_removed_unwatches_dir_and_descendants() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    std::fs::create_dir_all(root.join("removed/child")).unwrap();

    let mut watcher = FailureWatch::new(&[]);
    let mut reg = WatchRegistration::default();
    let removed = root.join("removed");
    reg.registered.insert(removed.clone());
    reg.registered.insert(removed.join("child"));

    reg.remove_dir(&mut watcher, &removed);

    assert!(reg.registered.is_empty());
    let unwatched = watcher.unwatched.lock().unwrap().clone();
    assert!(unwatched.contains(&removed));
    assert!(unwatched.contains(&removed.join("child")));
}

/// Selective 注册已达上限时，新增目录必须降级整树，而不是静默不监听。
#[test]
fn on_dir_added_degrades_when_already_at_cap() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    let added = root.join("live-added");
    std::fs::create_dir_all(&added).unwrap();
    let filter = selective_test_filter(root);

    let mut watcher = FailureWatch::new(&[]);
    let mut reg = WatchRegistration {
        registered: (0..MAX_WATCH_DIRS)
            .map(|i| root.join(format!("registered-{i}")))
            .collect(),
        degraded: false,
    };

    reg.add_dir(&mut watcher, root, &added, Some(&filter));

    assert!(reg.degraded, "触顶后必须降级，不能静默丢失监听");
    assert_eq!(reg.registered.len(), 0, "降级时应清空 stale selective 集合");
    assert_eq!(watcher.watched_recursive_count(), 1);
}

/// 维护路径：on_rules_changed 先解除全部已注册目录，再按新计划重注册。
#[test]
fn on_rules_changed_unwatches_all_then_reregisters() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    std::fs::create_dir_all(root.join("pkg/src")).unwrap();
    std::fs::write(
        root.join(".gitignore"),
        "unused
",
    )
    .unwrap();
    let filter = GitIgnoreFilter::new(root.to_path_buf());

    let mut watcher = FailureWatch::new(&[]);
    let mut reg = WatchRegistration::default();
    // 手动走 Selective（在 macOS/Windows 上绕过平台分派，专注状态机）
    reg.register_selective(&mut watcher, root, Some(&filter));
    let registered_before = reg.registered.len();
    assert!(
        registered_before >= 2,
        "根 + pkg + pkg/src 至少 3（根自身在 registered）"
    );

    // 规则变化：Selective 平台（Linux）→ drain 全部 + 重注册；
    // Recursive 平台（macOS/Windows）→ 策略性 no-op（整树注册本就无视规则分层）。
    // 用 cfg 断言两端语义，编译期各平台只编译自己那条。
    reg.on_rules_changed(&mut watcher, root, Some(&filter));
    #[cfg(target_os = "linux")]
    {
        assert!(
            watcher.unwatched.lock().unwrap().len() >= registered_before,
            "Linux 重算应解除全部已注册目录"
        );
        assert_eq!(reg.registered.len(), registered_before, "重注册后集合恢复");
    }
    #[cfg(not(target_os = "linux"))]
    {
        assert_eq!(
            watcher.unwatched.lock().unwrap().len(),
            0,
            "Recursive 平台维护 no-op（整树注册与规则无关）"
        );
        assert_eq!(reg.registered.len(), registered_before, "集合不变");
    }
}
