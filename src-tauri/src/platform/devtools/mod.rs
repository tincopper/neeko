//! DevTools 打开平台差异集中化。
//!
//! 统一接口：
//! - [`ensure_detached_devtools`]：打开 DevTools 并确保独立窗口（含 detach 轮询）。
//! - [`needs_side_effect_compensation`]：是否需要 bounds/zoom 副作用补偿。
//! - [`configure_inspector`]：创建 webview 时的 Inspector 独立窗口配置（非 Linux 为 no-op）。

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
pub use linux::*;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
pub use windows::*;
