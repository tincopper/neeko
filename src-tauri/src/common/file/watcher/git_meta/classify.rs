//! git 元数据事件分类：把 notify 事件路径判定为该单元的 HEAD / index / 无关。

use std::path::{Path, PathBuf};

/// Git 元数据事件分类结果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum GitMetaChange {
    /// 无关路径（config / ORIG_HEAD / 别的单元等），不处理
    Nothing,
    /// 本单元 index 变更 → 需要重查（覆盖 ignored_files 与 staged 状态）
    IndexChanged,
    /// 本单元 HEAD 变更（分支切换）
    HeadChanged,
}

/// 将一次 git 元数据事件涉及的路径分类为 HEAD / index / 无关。
///
/// 优先级：index 优先于 HEAD —— `git commit` 会同时改写 index（清空暂存）与 HEAD，
/// 此时按 index 处理，确保全量刷新覆盖 ignored_files。
pub(super) fn classify_git_meta_event(
    paths: &[PathBuf],
    head: &Path,
    index: &Path,
) -> GitMetaChange {
    if paths.iter().any(|p| p == index) {
        return GitMetaChange::IndexChanged;
    }
    if paths.iter().any(|p| p == head) {
        return GitMetaChange::HeadChanged;
    }
    GitMetaChange::Nothing
}
