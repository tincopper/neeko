//! 主机用户 PATH 解析平台差异集中化。
//!
//! 统一接口：[`resolve_host_path`] 解析主机用户 shell PATH；
//! [`prepend_neeko_bin`] 把 Neeko 自管工具目录（`~/.neeko/bin`）置顶。

#[cfg(unix)]
mod unix;
#[cfg(unix)]
pub use unix::*;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::*;
