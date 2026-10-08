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
    /// 本单元 refs 变更（`refs/**` 或 `packed-refs`）—— 本地分支 / remote-tracking
    /// ref 变化，影响 `@{upstream}...HEAD` 的 ahead/behind。外部 `git push` / `fetch`
    /// 只改这里，不改 HEAD / index / workdir。
    RefsChanged,
}

/// 将一次 git 元数据事件涉及的路径分类为 HEAD / index / refs / 无关。
///
/// 优先级：index > HEAD > refs —— `git commit` 会同时改写 index（清空暂存）与 HEAD，
/// 此时按 index 处理，确保全量刷新覆盖 ignored_files。refs 是最弱的信号：任何
/// `refs/**`（含 `refs/heads` / `refs/remotes` / `refs/tags`）或 `packed-refs` 变化
/// 都归入它，且**只作查询调度提示**（事实仍由 `git-status-snapshot` 携带）。
pub(super) fn classify_git_meta_event(
    paths: &[PathBuf],
    head: &Path,
    index: &Path,
    refs_dir: &Path,
    packed_refs: &Path,
) -> GitMetaChange {
    if paths.iter().any(|p| p == index) {
        return GitMetaChange::IndexChanged;
    }
    if paths.iter().any(|p| p == head) {
        return GitMetaChange::HeadChanged;
    }
    if paths
        .iter()
        .any(|p| p == packed_refs || p.starts_with(refs_dir))
    {
        return GitMetaChange::RefsChanged;
    }
    GitMetaChange::Nothing
}
