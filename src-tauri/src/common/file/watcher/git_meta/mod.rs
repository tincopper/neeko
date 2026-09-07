//! git 元数据监听与分类（原 git_meta.rs 1163 行超健康线 300-400，按职责拆分）：
//! - [`paths`]：监听路径解析（HEAD / index / git_dir / linked worktree 根）；
//! - [`classify`]：事件分类（HEAD / index / worktree / 无关）；
//! - [`watcher`]：watcher 组装、回调分派与 worktrees 自愈补挂。

mod classify;
mod paths;
mod watcher;

#[cfg(test)]
mod tests;

pub(super) use paths::resolve_git_meta_paths;
pub(super) use watcher::{create_git_meta_watcher, GitMetaWatcherHandle};
