//! 文件 watcher 后端**能力位**（红线 10：平台差异集中化）。
//!
//! 第一性原理：`Selective` / `Recursive` 从来不是同层的「策略选择」，而是「后端支持剪枝」
//! 与「后端不支持、只能兜底」的能力差异被伪装成了选择。本主题把该差异显式化为单一决策点
//! [`watch_backend`]，`registration/strategy.rs` 只消费能力枚举，不再自行判断平台。
//!
//! | [`WatchBackend`] | 注册方式 | ignored 子树 |
//! | --- | --- | --- |
//! | `SubtreeExclusion` | 根递归 + exclusion 列表 | **物理不投递**（macOS FSEvents exclusion） |
//! | `SelectiveRegistration` | 逐可见目录 NonRecursive | 不注册（Linux inotify） |
//! | `RecursiveFilterOnly` | 根递归 | 回调丢弃（Windows 现状，降级态） |
//!
//! 排除集合的来源是 `WatchManifest.ignored_roots`，经 [`build_exclusion_paths`] 归一后传给
//! [`create_file_watcher`]；工厂在构造期把集合烘焙进后端，由 macOS 实现在
//! `FSEventStreamStart` 之前调用 `FSEventStreamSetExclusionPaths`。
//!
//! 模块布局遵循 `platform/<theme>/` 约定（`mod.rs` 只做声明与 re-export）：
//! - [`types`] 能力枚举；[`factory`] 构造工厂；[`platform_watcher`] 平台门面；
//! - `linux` / `macos` / `windows` 只声明各自的平台能力位；`macos_fsevent` 是 macOS 后端实现。

mod factory;
mod platform_watcher;
mod types;

#[cfg(target_os = "macos")]
mod macos_fsevent;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
pub use linux::watch_backend;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::watch_backend;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
pub use windows::watch_backend;

pub use factory::{build_exclusion_paths, create_file_watcher, DISABLE_FSEVENT_EXCLUSION_ENV};
pub use platform_watcher::PlatformWatcher;
pub use types::WatchBackend;
