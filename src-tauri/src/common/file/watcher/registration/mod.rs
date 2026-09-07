//! 项目根的 watch 注册策略（S2 排除式监听：注册层排除 ignored 子树）。
//!
//! 业界公理 2「排除发生在注册层，不在回调里」的平台现实：
//! - **Linux (inotify)**：支持按目录注册 —— 走「可见目录逐个 NonRecursive 注册」，
//!   ignored 子树在内核层就不再产生事件（纯计划函数 + 降级兜底）；
//! - **macOS (FSEvents)**：事件按路径前缀送达，无法按目录排除 —— 保持整树
//!   Recursive 注册，回调层 GitIgnoreFilter 过滤（调研文档已明确该限制）；
//! - **Windows (ReadDirectoryChangesW)**：每目录一个 64KB 缓冲句柄，万级目录
//!   句柄/内存不可行 —— 保持整树 Recursive 注册，回调层过滤。
//!
//! 结构变化的注册维护（新建/移入目录、.gitignore 编辑）经**独立维护线程**执行
//! —— notify 回调内禁止再调 `watch()`（FSEvents 死锁，见 manager 既有约束）。
//!
//! 原 registration.rs（710 行）超健康线，按职责拆分：
//! [`strategy`]（注册策略与状态机）+ [`maintenance`]（维护线程）+ `tests`（集中测试）。

mod maintenance;
mod strategy;

#[cfg(test)]
mod tests;

pub(in crate::common::file::watcher) use maintenance::spawn_maintenance_thread;
pub(in crate::common::file::watcher) use strategy::{WatchMaintenance, WatchRegistration};
