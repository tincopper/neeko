//! 进程树快照平台差异集中化。
//!
//! 统一接口：[`snapshot_process_tree`] 快照本机所有存活进程的 `(pid → ppid, pid → sid)`。

mod types;
pub use types::ProcessTree;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
pub use linux::*;
