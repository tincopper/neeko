//! 文件 watcher 的注册策略平台差异集中化。
//!
//! Linux inotify 支持低成本逐目录注册，采用 Selective；macOS FSEvents 与
//! Windows ReadDirectoryChangesW 采用整树 Recursive 注册 + 回调过滤。业务代码
//! 只消费 [`watch_selectively`] 统一接口，不得在 watcher 内部平铺平台 cfg。

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
pub use linux::*;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
pub use windows::*;
