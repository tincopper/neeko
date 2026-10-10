//! watcher 事件路径分类的纯逻辑测试。

use super::classify::{relevant_event_paths, structure_event_paths};
use crate::common::file::watcher::gitignore::GitIgnoreFilter;
use std::path::Path;

fn gitignore_filter(root: &Path) -> GitIgnoreFilter {
    std::fs::write(root.join(".gitignore"), "*.log\n").unwrap();
    GitIgnoreFilter::new(root.to_path_buf())
}

#[test]
fn content_event_paths_drop_gitignored_and_hard_noise_paths() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    let filter = gitignore_filter(root);
    let paths = vec![
        root.join("debug.log"),
        root.join("src/main.rs"),
        root.join(".git/index"),
    ];

    let relevant = relevant_event_paths(&paths, Some(&filter));

    assert_eq!(relevant, vec![root.join("src/main.rs")]);
}

/// 非结构事件一律不触发文件树刷新（与改造前一致）。
#[test]
fn non_structure_event_paths_do_not_trigger_tree_refresh() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    let filter = gitignore_filter(root);
    let paths = vec![root.join("src/main.rs")];

    assert!(structure_event_paths(&paths, false, Some(&filter)).is_empty());
}

/// 无 filter（非 git 项目）：行为与改造前一致 —— 仅排除 `.git` / `.DS_Store`
/// 硬噪声，gitignore 无从感知。
#[test]
fn structure_event_paths_without_filter_matches_legacy_hard_noise_only() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    let paths = vec![
        root.join("debug.log"),
        root.join("build/output.log"),
        root.join(".git/index"),
        root.join(".DS_Store"),
    ];

    let tree_paths = structure_event_paths(&paths, true, None);

    assert_eq!(
        tree_paths,
        vec![root.join("debug.log"), root.join("build/output.log")]
    );
}

/// 硬噪声即使位于 ignored 子树内也一律丢弃（`.git` 元数据 / `.DS_Store`）。
#[test]
fn structure_event_paths_drop_hard_noise_paths() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    let filter = gitignore_filter(root);
    let paths = vec![root.join(".git/index"), root.join(".DS_Store")];

    assert!(structure_event_paths(&paths, true, Some(&filter)).is_empty());
}

/// 未被忽略的路径原样保留（含未被忽略的 build 输出目录 —— 禁止硬编码黑名单）。
#[test]
fn structure_event_paths_keep_non_ignored_paths() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    let filter = gitignore_filter(root);
    let paths = vec![
        root.join("src/new.rs"),
        root.join("build/output"),
        root.join("dist/app.js"),
    ];

    let tree_paths = structure_event_paths(&paths, true, Some(&filter));

    assert_eq!(
        tree_paths,
        vec![
            root.join("src/new.rs"),
            root.join("build/output"),
            root.join("dist/app.js"),
        ]
    );
}

/// ignored 子树**内部**路径在结构事件中一律丢弃（监听层不订阅 ignored 内部，R1/D3）：
/// `target/debug/deps/x.o` 不产生任何 tree 失效目标。
#[test]
fn structure_event_paths_drop_ignored_subtree_internal_paths() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    std::fs::create_dir_all(root.join("target/debug/deps")).unwrap();
    std::fs::write(root.join("target/debug/deps/x.o"), "").unwrap();
    std::fs::write(root.join(".gitignore"), "target/\n").unwrap();
    let filter = GitIgnoreFilter::new(root.to_path_buf());

    let paths = vec![root.join("target/debug/deps/x.o")];
    let tree_paths = structure_event_paths(&paths, true, Some(&filter));

    assert!(tree_paths.is_empty());
}

/// 一批位于同一 ignored 子树内的路径全部丢弃（消除 `target/**` 构建 churn）；
/// 而 ignored 根的重复边界事件（如 remove+create）去重为一条。
#[test]
fn structure_event_paths_drop_ignored_internal_churn_and_dedupe_boundary() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    std::fs::create_dir_all(root.join("target/debug/deps")).unwrap();
    std::fs::write(root.join(".gitignore"), "target/\n").unwrap();
    let filter = GitIgnoreFilter::new(root.to_path_buf());

    let paths = vec![
        root.join("target/debug/a.o"),
        root.join("target/debug/deps/b.o"),
        root.join("target/release/c.o"),
    ];
    let tree_paths = structure_event_paths(&paths, true, Some(&filter));
    assert!(tree_paths.is_empty(), "ignored 内部 churn 不得产生失效目标");

    // ignored 根的重复边界事件去重为一条
    let boundary = [root.join("target"), root.join("target")];
    let deduped = structure_event_paths(&boundary, true, Some(&filter));
    assert_eq!(deduped, vec![root.join("target")]);
}

/// ignored 根**自身**的创建/删除仍保留为灰节点更新（AC2）。
#[test]
fn structure_event_paths_keep_ignored_root_boundary_change() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    std::fs::create_dir_all(root.join("target")).unwrap();
    std::fs::write(root.join(".gitignore"), "target/\n").unwrap();
    let filter = GitIgnoreFilter::new(root.to_path_buf());

    // 创建：ignored 根作为结构事件路径
    let created = structure_event_paths(&[root.join("target")], true, Some(&filter));
    assert_eq!(created, vec![root.join("target")]);

    // 删除：ignored 根从磁盘消失后仍保留（父目录可见监听捕获边界变化）
    std::fs::remove_dir_all(root.join("target")).unwrap();
    let removed = structure_event_paths(&[root.join("target")], true, Some(&filter));
    assert_eq!(removed, vec![root.join("target")]);
}

/// 嵌套 gitignore：子包 ignored 根的**内部**路径丢弃；
/// 子包 ignored 根**自身**的边界事件保留为其所在层级（分层剪枝语义，不误伤可见子树）。
#[test]
fn structure_event_paths_nested_ignored_root_boundary_only() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    let app = root.join("packages/app");
    std::fs::create_dir_all(app.join("dist/assets")).unwrap();
    std::fs::write(root.join(".gitignore"), "/target/\n").unwrap();
    std::fs::write(app.join(".gitignore"), "dist/\n").unwrap();
    let filter = GitIgnoreFilter::new(root.to_path_buf());

    let internal = structure_event_paths(&[app.join("dist/assets/app.js")], true, Some(&filter));
    assert!(internal.is_empty());

    let boundary = structure_event_paths(&[app.join("dist")], true, Some(&filter));
    assert_eq!(boundary, vec![app.join("dist")]);
}

/// D2 用户级 `watcherExclude` 与 gitignore 走同一忽略判定：被排除子树**内部**的
/// 结构事件一律丢弃（配置后该子树零监听），ignored 根**自身**的边界事件仍保留；
/// 未被排除的可见路径不受影响。
#[test]
fn structure_event_paths_honor_user_watcher_excludes() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    std::fs::create_dir_all(root.join("target/debug")).unwrap();
    // .gitignore 为空：命中只能来自用户排除层
    std::fs::write(root.join(".gitignore"), "").unwrap();
    let filter = GitIgnoreFilter::with_user_excludes(root.to_path_buf(), &["target/".into()]);

    let paths = vec![root.join("target/debug/x.o"), root.join("src/main.rs")];
    let tree_paths = structure_event_paths(&paths, true, Some(&filter));
    assert_eq!(
        tree_paths,
        vec![root.join("src/main.rs")],
        "用户排除子树内部 churn 不得产生失效目标"
    );

    // ignored 根自身的边界事件保留（灰节点更新）
    let boundary = structure_event_paths(&[root.join("target")], true, Some(&filter));
    assert_eq!(boundary, vec![root.join("target")]);
}

/// 非 ignored 路径仍照常保留（保证边界收窄不误伤可见子树）。
#[test]
fn structure_event_paths_keep_visible_paths_mixed_with_ignored() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    std::fs::create_dir_all(root.join("target/debug")).unwrap();
    std::fs::write(root.join(".gitignore"), "target/\n").unwrap();
    let filter = GitIgnoreFilter::new(root.to_path_buf());

    let paths = vec![
        root.join("target/debug/x.o"),
        root.join("src/main.rs"),
        root.join("README.md"),
    ];
    let tree_paths = structure_event_paths(&paths, true, Some(&filter));

    assert_eq!(
        tree_paths,
        vec![root.join("src/main.rs"), root.join("README.md")]
    );
}
