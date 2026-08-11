//! 文件管理器 reveal 平台差异集中化。
//!
//! 统一接口：
//! - [`build_reveal_command`]：构建在系统文件管理器中 reveal 指定路径的命令（不执行）。
//! - [`normalize_path`]：规范化路径分隔符（Windows 统一为反斜杠）。

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
