//! 非 macOS 平台专属菜单默认实现（Windows / Linux 无平台专属菜单）。

/// 构建平台专属编辑子菜单（无平台专属菜单时返回 `None`）。
///
/// Windows / Linux 无平台专属菜单，返回 `Ok(None)`；macOS 实现在 [`super::macos`]。
pub fn build_edit_submenu(
    _handle: &tauri::AppHandle,
) -> tauri::Result<Option<tauri::menu::Submenu<tauri::Wry>>> {
    Ok(None)
}
