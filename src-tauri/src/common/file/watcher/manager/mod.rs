//! `WatcherManager` 编排：为每个项目启动文件监听，聚合各子模块。
//!
//! 原 manager.rs（591 行）超健康线（300-400），按职责拆分：
//! - [`classify`]：watcher 事件路径分类（内容事件 / 结构事件过滤）；
//! - [`handle`]：单项目 watcher 句柄（聚合全部运行资源）；
//! - [`callbacks`]：notify 事件回调构建（闭包体抽离，组装编排保持精简）；
//! - [`core`]：`WatcherManager`（watch / unwatch / stop_all）。

mod callbacks;
mod classify;
mod core;
mod handle;

#[cfg(test)]
mod tests;

pub use core::WatcherManager;
