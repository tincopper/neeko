//! git 元数据监听与分类：每个Workspace一条，只看自己的 HEAD / index。
//! - [`paths`]：监听路径解析（HEAD / index / git_dir，含 linked worktree 的 gitdir 指针）；
//! - [`classify`]：事件分类（HEAD / index / 无关）；
//! - [`watcher`]：watcher 组装与回调分派。

mod classify;
mod paths;
mod watcher;

#[cfg(test)]
mod tests;

pub(super) use paths::resolve_git_meta_paths;
pub(super) use watcher::{create_git_meta_watcher, GitMetaWatcherHandle};
