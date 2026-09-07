//! watcher 事件路径分类的纯逻辑测试。

use super::classify::{relevant_event_paths, structure_event_paths};
use crate::common::file::watcher::gitignore::GitIgnoreFilter;
use std::path::{Path, PathBuf};

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

#[test]
fn structure_event_paths_retain_gitignored_but_drop_hard_noise_paths() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    let paths = vec![
        root.join("debug.log"),
        root.join("build/output.log"),
        root.join(".git/index"),
        root.join(".DS_Store"),
    ];

    let tree_paths = structure_event_paths(&paths, true);

    assert_eq!(
        tree_paths,
        vec![root.join("debug.log"), root.join("build/output.log")]
    );
}

#[test]
fn non_structure_event_paths_do_not_trigger_tree_refresh() {
    let paths = vec![PathBuf::from("/tmp/project/debug.log")];

    assert!(structure_event_paths(&paths, false).is_empty());
}
