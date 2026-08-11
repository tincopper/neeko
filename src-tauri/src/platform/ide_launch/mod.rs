//! IDE 启动平台差异集中化。
//!
//! - Windows:`cmd /C` 启动
//! - Unix:直接 spawn
//! - macOS:LaunchServices `open -a` 降级(命令未找到时按 app name 查找 /Applications/*.app)

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
