//! File-system watcher service for detecting changes and emitting events.
//!
//! 按职责拆分为五个子模块（本文件仅做声明与 re-export，业务实现见各子模块）：
//! - [`types`]：事件名常量 + 事件 payload 类型；
//! - [`debounce`]：Throttle / Debounce 线程基建；
//! - [`gitignore`]：git 语义忽略过滤器；
//! - [`git_meta`]：git 元数据（HEAD / index / worktrees）监听与分类；
//! - [`manager`]：`WatcherManager` 编排（watch / unwatch / stop_all）；
//! - [`sink`]：事件出口抽象（唯一接触 `AppHandle::emit` 的地方，测试可注入收集器）。

#![allow(clippy::unwrap_used, clippy::expect_used)]

mod debounce;
mod git_meta;
mod gitignore;
mod manager;
mod manifest;
mod types;

// 对外公共面（`file/mod.rs` 与 `app_state.rs` 依赖）：事件 payload 类型 + 管理器；
// 事件名常量一并暴露（保持原公共 API 不变）。
mod registration;
mod sink;

pub use gitignore::GitIgnoreFilter;
pub use manager::{DirtyMask, WatcherManager};
// 事件出口（组合根注入；测试注入收集器）
pub use sink::{AppHandleSink, WatcherEvent, WatcherEventSink};
// 测试用收集器 + **唯一的 sink 等待原语**：跨域单测（如 git 服务层编排）需要驱动端口时复用同一实现。
// 等待只能按单元归属（`wait_for_unit_event` 强制 `workspace_key`）—— 批量入口给整批单元
// 注入同一个端口，无归属判据会把别单元的事件当成自己的收敛证据（2026-11 CI 假失败）。
#[cfg(test)]
pub(crate) use sink::test_support::{wait_for_unit_event, wait_for_unit_snapshot, CollectingSink};
pub use types::{
    FileChangedEvent, FileTreeChangedEvent, FILE_CHANGED_EVENT, FILE_TREE_CHANGED_EVENT,
    GIT_CHANGED_EVENT,
};
