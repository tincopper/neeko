//! 本地进程启动标志平台差异集中化。
//!
//! - Windows:`CREATE_NO_WINDOW` 隐藏控制台窗口
//! - Unix:`apply_child_flags(_, kill_tree=true)` 创建新进程组;`kill_process_tree` 按组杀后代
//! - Windows:`taskkill /F /T` 按父 pid 遍历树
//!
//! **执行接口豁免**（AGENTS.md 规则 #1）：本模块是 OS 进程原语层。`kill_process_tree`
//! 需同步、fire-and-forget 地发信号，且位于 async executor **之下** —— 走 `core::exec`
//! 会形成循环依赖，故直接使用 `std::process::Command`（Windows `taskkill`）/ `libc`。

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
pub use windows::*;

#[cfg(unix)]
mod unix;
#[cfg(unix)]
pub use unix::*;
