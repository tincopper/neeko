//! 本地进程启动标志平台差异集中化。
//!
//! - Windows:`CREATE_NO_WINDOW` 隐藏控制台窗口
//! - Unix:`process_group(0)` 创建新进程组防止信号传播

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
pub use windows::*;

#[cfg(unix)]
mod unix;
#[cfg(unix)]
pub use unix::*;
