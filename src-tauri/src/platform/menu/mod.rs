//! 菜单平台差异集中化（Platform Adapter）。
//!
//! 目前仅 macOS 需要平台专属菜单：Edit 子菜单（Cut/Copy/Paste/Select All）
//! 使用 `PredefinedMenuItem` 标准角色，映射到 Cocoa 标准 selector 并自动绑定
//! Cmd+X/C/V/A，由 macOS NSResponder chain 原生派发给聚焦的 webview。
//!
//! 跨平台护栏：此主题**必须**保持 macOS-only。Windows/Linux 无此菜单、无加速键
//! 拦截，Ctrl+C/V/A 原生直达 webview，本已一致；若在 Win/Linux 添加带编辑快捷键
//! 的菜单项，Win32/GTK 加速键同样会先于 webview 截获按键，重演 macOS 的同类问题
//! （详见任务 design.md §8）。非 macOS 由下方默认实现返回 `Ok(None)`，菜单构建方
//! 无条件调用本门面即可。

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(not(target_os = "macos"))]
mod default;
#[cfg(not(target_os = "macos"))]
pub use default::*;
