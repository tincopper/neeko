//! 系统字体枚举平台差异集中化（红线 10）。
//!
//! 每个平台一个实现文件，均暴露统一接口 [`get_system_fonts`]；过滤私有字体、
//! 排序去重由 `common::utils::fonts` 的编排层统一完成。
//!
//! 命令执行（Windows PowerShell / Linux fc-list）经统一接口
//! `core::exec::collect_blocking`，不再直接 `std::process::Command`（红线 1）。

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
pub use windows::*;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
pub use linux::*;

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
mod default;
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
pub use default::*;
