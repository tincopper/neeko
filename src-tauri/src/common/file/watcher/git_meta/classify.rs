//! git 元数据事件分类：把 notify 事件路径判定为 HEAD / index / worktree / 无关。

use std::path::{Path, PathBuf};

/// Git 元数据事件分类结果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum GitMetaChange {
    /// 无关路径（config / ORIG_HEAD 等），不处理
    Nothing,
    /// 主 index 变更 → 需要全量刷新（覆盖 ignored_files）
    IndexChanged,
    /// 主 HEAD 变更（分支切换）
    HeadChanged,
    /// worktree 区域（`.git/worktrees/*` 的 HEAD/index）或 linked worktree 工作
    /// 目录内任何变更 → 前端按 activeWorktree 刷新（G3：不再依赖 has_wt 判定，
    /// worktree 内 git add / commit / 外部文件编辑一律即时感知）。
    WorktreeMetaChanged,
}

/// 将一次 git 元数据事件涉及的路径分类为 HEAD / index / worktree / 无关。
///
/// 优先级：主 index 优先于主 HEAD —— `git commit` 会同时改写 index（清空暂存）
/// 与 HEAD，此时按 index 处理，确保全量刷新覆盖 ignored_files。
/// worktree 区域（`.git/worktrees`）与 linked worktree 工作目录事件独立分类，
/// 不再借用主 HEAD 的 `has_wt` 语义（G3 精确化）。
pub(super) fn classify_git_meta_event(
    paths: &[PathBuf],
    head: &Path,
    index: &Path,
    worktrees_dir: Option<&Path>,
    worktree_roots: &[PathBuf],
) -> GitMetaChange {
    if paths.iter().any(|p| p == index) {
        return GitMetaChange::IndexChanged;
    }
    if paths.iter().any(|p| p == head) {
        return GitMetaChange::HeadChanged;
    }
    let in_worktrees_meta = worktrees_dir
        .map(|w| paths.iter().any(|p| p.starts_with(w)))
        .unwrap_or(false);
    let in_worktree_root = worktree_roots
        .iter()
        .any(|root| paths.iter().any(|p| p.starts_with(root)));
    if in_worktrees_meta || in_worktree_root {
        GitMetaChange::WorktreeMetaChanged
    } else {
        GitMetaChange::Nothing
    }
}
