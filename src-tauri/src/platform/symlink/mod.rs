//! 技能目录链接创建平台差异集中化。
//!
//! - Unix:创建符号链接(symlink)
//! - 非 Unix(Windows):目录递归复制

#[cfg(unix)]
mod unix;
#[cfg(unix)]
pub use unix::*;

#[cfg(not(unix))]
mod windows;
#[cfg(not(unix))]
pub use windows::*;
