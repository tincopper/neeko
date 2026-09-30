//! git 元数据路径解析与事件分类的纯函数测试。
//!
//! 身份补全后（每个仓库单元自带一条 git 元数据 watcher），本文件钉住两件事：
//! 1. linked worktree 解析到**它自己的**私有 gitdir（HEAD / index），不是主仓的；
//! 2. 分类只认本单元的 HEAD / index —— 别的工作树的元数据路径一律 `Nothing`
//!    （旧实现靠主仓递归监听 `.git/worktrees/**` 代收，事件会串到错误身份上）。

use super::super::classify::{classify_git_meta_event, GitMetaChange};
use super::super::paths::{resolve_git_head_path, resolve_git_meta_paths};
use std::path::{Path, PathBuf};

/// 在临时目录里造一个普通仓库（`.git` 为目录）。夹具路径一律由 `tempdir()` 派生（红线 13）。
fn normal_repo(tmp: &Path) -> PathBuf {
    let repo = tmp.join("repo");
    std::fs::create_dir_all(repo.join(".git")).unwrap();
    std::fs::write(repo.join(".git").join("HEAD"), "ref: refs/heads/main\n").unwrap();
    std::fs::write(repo.join(".git").join("index"), "\0TREE").unwrap();
    repo
}

/// 在临时目录里造一个 linked worktree：`main/.git/worktrees/<name>/` 为私有 gitdir，
/// `wt/.git` 为指向它的指针文件（真实 git 形态）。返回 `(主仓, 工作树目录, 私有 gitdir)`。
fn linked_worktree(tmp: &Path, name: &str) -> (PathBuf, PathBuf, PathBuf) {
    let main = normal_repo(tmp);
    let private = main.join(".git").join("worktrees").join(name);
    std::fs::create_dir_all(&private).unwrap();
    std::fs::write(private.join("HEAD"), "ref: refs/heads/feature\n").unwrap();
    std::fs::write(private.join("index"), "\0TREE-WT").unwrap();
    let wt = tmp.join(format!("wt-{name}"));
    std::fs::create_dir_all(&wt).unwrap();
    std::fs::write(wt.join(".git"), format!("gitdir: {}\n", private.display())).unwrap();
    (main, wt, private)
}

#[test]
fn resolve_git_head_path_normal_repo() {
    let tmp = tempfile::tempdir().unwrap();
    let repo = normal_repo(tmp.path());
    assert_eq!(
        resolve_git_head_path(&repo),
        Some(repo.join(".git").join("HEAD"))
    );
}

#[test]
fn resolve_git_head_path_linked_worktree_follows_pointer_file() {
    let tmp = tempfile::tempdir().unwrap();
    let (_main, wt, private) = linked_worktree(tmp.path(), "dev");
    assert_eq!(resolve_git_head_path(&wt), Some(private.join("HEAD")));
}

#[test]
fn resolve_git_head_path_not_a_repo() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("plain");
    std::fs::create_dir_all(&dir).unwrap();
    assert_eq!(resolve_git_head_path(&dir), None);
}

#[test]
fn resolve_git_meta_paths_normal_repo() {
    let tmp = tempfile::tempdir().unwrap();
    let repo = normal_repo(tmp.path());
    let meta = resolve_git_meta_paths(&repo).expect("normal repo must resolve");
    // git_dir 经 canonicalize（与 notify 上报的 realpath 对齐），head/index 由其派生
    let canonical_git = repo.join(".git").canonicalize().unwrap();
    assert_eq!(meta.git_dir, canonical_git);
    assert_eq!(meta.head, canonical_git.join("HEAD"));
    assert_eq!(meta.index, canonical_git.join("index"));
}

/// 核心性质：**每个单元只看自己的 gitdir**。linked worktree 的 HEAD/index 必须落在其
/// 私有 gitdir（`main/.git/worktrees/<name>/`），而不是主仓 `.git/`。
#[test]
fn resolve_git_meta_paths_linked_worktree_uses_private_gitdir() {
    let tmp = tempfile::tempdir().unwrap();
    let (main, wt, private) = linked_worktree(tmp.path(), "dev");
    let meta = resolve_git_meta_paths(&wt).expect("linked worktree must resolve");
    let main_meta = resolve_git_meta_paths(&main).expect("main repo must resolve");

    assert_eq!(meta.git_dir, private.canonicalize().unwrap());
    assert_eq!(meta.index, private.canonicalize().unwrap().join("index"));
    // 两个单元的路径集合必须完全不相交 —— 否则一方事件会喂给另一方
    assert_ne!(meta.git_dir, main_meta.git_dir);
    assert_ne!(meta.index, main_meta.index);
    assert_ne!(meta.head, main_meta.head);
}

#[test]
fn resolve_git_meta_paths_not_a_repo() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("plain");
    std::fs::create_dir_all(&dir).unwrap();
    assert!(resolve_git_meta_paths(&dir).is_none());
}

#[test]
fn classify_index_takes_priority_over_head() {
    let head = PathBuf::from("git/HEAD");
    let index = PathBuf::from("git/index");
    assert_eq!(
        classify_git_meta_event(&[head.clone(), index.clone()], &head, &index),
        GitMetaChange::IndexChanged,
        "git commit 同时改 index 与 HEAD → 按 index 处理，保证全量刷新覆盖 ignored_files"
    );
}

#[test]
fn classify_head_and_index_and_unrelated() {
    let head = PathBuf::from("git/HEAD");
    let index = PathBuf::from("git/index");
    assert_eq!(
        classify_git_meta_event(std::slice::from_ref(&index), &head, &index),
        GitMetaChange::IndexChanged
    );
    assert_eq!(
        classify_git_meta_event(std::slice::from_ref(&head), &head, &index),
        GitMetaChange::HeadChanged
    );
    assert_eq!(
        classify_git_meta_event(&[PathBuf::from("git/config")], &head, &index),
        GitMetaChange::Nothing
    );
    assert_eq!(
        classify_git_meta_event(&[], &head, &index),
        GitMetaChange::Nothing
    );
}

/// 跨单元隔离：别的工作树的 HEAD / index 路径不得被本单元分类为任何变化。
#[test]
fn classify_ignores_other_unit_metadata_paths() {
    let tmp = tempfile::tempdir().unwrap();
    let (main, _wt, private) = linked_worktree(tmp.path(), "dev");
    let main_meta = resolve_git_meta_paths(&main).unwrap();

    // 主仓的 watcher 看到另一个工作树的 HEAD（其私有 gitdir 下的路径）→ Nothing
    let other_head = private.canonicalize().unwrap().join("HEAD");
    assert_eq!(
        classify_git_meta_event(&[other_head], &main_meta.head, &main_meta.index),
        GitMetaChange::Nothing,
        "主仓不得代收其它工作树的元数据事件（旧实现靠递归监听 .git/worktrees/**）"
    );
}
