//! Shell 任务命令构建平台差异集中化。
//!
//! - Windows:`cmd /c <command>`
//! - Unix:`sh -c <command>` + locale 环境变量(LANG/LC_ALL/LC_CTYPE)

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
pub use windows::*;

#[cfg(unix)]
mod unix;
#[cfg(unix)]
pub use unix::*;
