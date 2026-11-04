//! `WatcherManager` 编排：为每个项目启动文件监听，聚合各子模块。
//!
//! 原 manager.rs（591 行）超健康线（300-400），按职责拆分：
//! - [`classify`]：watcher 事件路径分类（内容事件 / 结构事件过滤）；
//! - [`handle`]：单项目 watcher 句柄（聚合全部运行资源）；
//! - [`callbacks`]：notify 事件回调构建（闭包体抽离，组装编排保持精简）；
//! - [`git_meta_merge`]：git 元数据并入主 watcher 的判定与回调构造；
//! - [`core`]：`WatcherManager`（ensure_mounted / unwatch / stop_all）；
//! - [`store`]：每单元权威 status 登记表（快照 + `computed_at` + `dirty` + 号段）。

mod callbacks;
mod classify;
mod core;
mod git_meta_merge;
mod handle;
mod store;

#[cfg(test)]
mod callback_tests;
#[cfg(test)]
mod lifecycle_tests;
#[cfg(test)]
mod tests;

pub use core::WatcherManager;
pub use store::DirtyMask;
