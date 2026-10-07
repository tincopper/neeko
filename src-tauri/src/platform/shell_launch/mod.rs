//! Shell 选择平台差异集中化。
//!
//! 承载两类用法：
//! - PTY 任务命令构建（`build_task_command`）：Windows `cmd /c <command>`、
//!   Unix `sh -c <command>` + locale 环境变量(LANG/LC_ALL/LC_CTYPE)；
//! - **命令执行（非 PTY）的 shell 选择**（`shell_argv`）：由 `core::exec::collect_script`
//!   消费，业务层不得自选 shell（红线 2）。

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
pub use windows::*;

#[cfg(unix)]
mod unix;
#[cfg(unix)]
pub use unix::*;
