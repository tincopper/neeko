//! macOS 专属菜单：Edit 子菜单（Cut/Copy/Paste/Select All）。
//!
//! 使用标准角色项 `PredefinedMenuItem`（muda 映射到 Cocoa 标准 selector
//! `cut:`/`copy:`/`paste:`/`selectAll:` 并自动绑定 Cmd+X/C/V/A），由 macOS 的
//! NSResponder chain 派发给**当前聚焦的 webview**（主界面 / 浏览器子 webview /
//! 远程页面），在其自身文档内原生执行 —— 无需任何手动转发、eval 或聚焦判定，
//! 也不会触发 WKWebView 的程序化粘贴确认气泡。

use tauri::menu::{PredefinedMenuItem, SubmenuBuilder};

/// 构建 macOS Edit 子菜单（Cut/Copy/Paste/Select All）。
pub fn build_edit_submenu(
    handle: &tauri::AppHandle,
) -> tauri::Result<Option<tauri::menu::Submenu<tauri::Wry>>> {
    let cut = PredefinedMenuItem::cut(handle, None)?;
    let copy = PredefinedMenuItem::copy(handle, None)?;
    let paste = PredefinedMenuItem::paste(handle, None)?;
    let select_all = PredefinedMenuItem::select_all(handle, None)?;
    let submenu = SubmenuBuilder::new(handle, "Edit")
        .items(&[&cut, &copy, &paste])
        .separator()
        .item(&select_all)
        .build()?;
    Ok(Some(submenu))
}
