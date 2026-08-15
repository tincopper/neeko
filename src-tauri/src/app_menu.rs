//! 应用菜单构建与菜单事件转发（Cmd+W 关闭标签页 / macOS Edit 命令原生处理）。

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{MenuBuilder, MenuItemBuilder, MenuItemKind, SubmenuBuilder};
use tauri::{Emitter, Manager};

/// File 菜单「关闭标签页」项 id（菜单构建与事件分发共用）。
const MENU_CLOSE_TAB_ID: &str = "close_tab";

/// View 菜单 id（供 `sync_devtools_menu_item` 按 id 查找子菜单）。
const MENU_VIEW_ID: &str = "view";

/// View 菜单「切换 DevTools」项 id（release 构建需启用 `devtools` feature 才生效）。
const MENU_TOGGLE_DEVTOOLS_ID: &str = "toggle_devtools";

/// 配置键 `enableDevTools` 单一事实源，与前端 `src/shared/types/settings.ts`
/// 的 `AppConfig.enableDevTools` 字段对应。
pub const CONFIG_KEY_ENABLE_DEVTOOLS: &str = "enableDevTools";

/// DevTools 门控：仅当配置中 `enableDevTools` 为布尔 `true` 时放行（缺键 /
/// 非布尔 / `false` 一律视为关闭）。纯函数，可独立单测。
#[must_use]
pub fn is_devtools_enabled(config: &serde_json::Value) -> bool {
    config
        .get(CONFIG_KEY_ENABLE_DEVTOOLS)
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

/// 关闭标签页事件名（Cmd+W 菜单转发），与前端 `src/shared/events.ts` `CLOSE_TAB_EVENT` 同步。
const CLOSE_TAB_EVENT: &str = "close-tab";

/// 构建应用主菜单：File（Cmd+W 关闭标签页）+ macOS Edit（剪贴板命令）。
///
/// macOS delivers webview copy/paste/cut/select-all as native Edit menu
/// accelerators, not as raw key events. A custom menu without an Edit
/// submenu silently breaks Cmd+C/V/X/A in every focus context (terminal,
/// editor, input fields). Restore the standard items as `PredefinedMenuItem`
/// roles so the macOS responder chain delivers them to the focused webview
/// natively (see [`crate::platform::menu::build_edit_submenu`]).
pub fn build_menu(handle: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let close_tab = MenuItemBuilder::with_id(MENU_CLOSE_TAB_ID, "Close Tab")
        .accelerator("CmdOrCtrl+W")
        .build(handle)?;
    let file = SubmenuBuilder::new(handle, "File")
        .item(&close_tab)
        .build()?;

    let mut menu = MenuBuilder::new(handle).item(&file);

    // View 菜单:Toggle DevTools(Cmd+Alt+I / Ctrl+Alt+I)。
    // release 构建需启用 `devtools` feature,否则 `open_devtools` 为 no-op。
    // 构建期按配置初始化 enabled 状态；运行中改设置由 `save_config` →
    // `sync_devtools_menu_item` 即时同步，无需重启。
    let toggle_devtools = MenuItemBuilder::with_id(MENU_TOGGLE_DEVTOOLS_ID, "Toggle DevTools")
        .accelerator("CmdOrCtrl+Alt+I")
        .enabled(crate::theme::common::read_config_bool(
            CONFIG_KEY_ENABLE_DEVTOOLS,
        ))
        .build(handle)?;
    let view = SubmenuBuilder::with_id(handle, MENU_VIEW_ID, "View")
        .item(&toggle_devtools)
        .build()?;
    menu = menu.item(&view);

    if let Some(edit) = crate::platform::menu::build_edit_submenu(handle)? {
        menu = menu.item(&edit);
    }

    menu.build()
}

/// 同步 View 菜单 DevTools 项的 enabled 状态（save_config 后调用，即时生效，
/// 无需重启）。复用 `is_devtools_enabled` 纯判断，避免重复读盘；菜单尚未构建
/// 或项缺失时静默跳过。
pub fn sync_devtools_menu_item(app: &tauri::AppHandle, enabled: bool) {
    let Some(menu) = app.menu() else { return };
    let Some(MenuItemKind::Submenu(view)) = menu.get(MENU_VIEW_ID) else {
        return;
    };
    let Some(MenuItemKind::MenuItem(item)) = view.get(MENU_TOGGLE_DEVTOOLS_ID) else {
        return;
    };
    if let Err(e) = item.set_enabled(enabled) {
        log::error!("Failed to sync DevTools menu item enabled state: {e}");
    }
}

/// 处理菜单事件：Cmd+W 关闭标签页（全平台）+ DevTools 切换。
///
/// macOS Edit 命令（Cut/Copy/Paste/Select All）**不经过这里**：它们由
/// `PredefinedMenuItem` 标准角色经 NSResponder chain 原生派发给聚焦的 webview
/// （见 `crate::platform::menu::build_edit_submenu`），无需手动转发。
pub fn handle_menu_event(app: &tauri::AppHandle, id: &str, cmd_w_flag: &AtomicBool) {
    if id == MENU_CLOSE_TAB_ID {
        cmd_w_flag.store(true, Ordering::SeqCst);
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.emit(CLOSE_TAB_EVENT, ());
        } else {
            log::warn!("[menu] main webview window not found; close-tab event not emitted");
        }
        return;
    }

    if id == MENU_TOGGLE_DEVTOOLS_ID {
        // 门控：仅当设置中开启 enableDevTools 时才打开 DevTools（release 构建
        // 需启用 `devtools` feature，否则 open_devtools 为 no-op）。与 build_menu
        // 同源读取 read_config_bool，菜单处理器不依赖 AppStateWrapper。
        if crate::theme::common::read_config_bool(CONFIG_KEY_ENABLE_DEVTOOLS) {
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn devtools_gate_defaults_off_when_key_missing() {
        assert!(!is_devtools_enabled(&serde_json::json!({})));
    }

    #[test]
    fn devtools_gate_accepts_explicit_true() {
        assert!(is_devtools_enabled(
            &serde_json::json!({ "enableDevTools": true })
        ));
    }

    #[test]
    fn devtools_gate_rejects_false_and_non_boolean() {
        assert!(!is_devtools_enabled(
            &serde_json::json!({ "enableDevTools": false })
        ));
        assert!(!is_devtools_enabled(
            &serde_json::json!({ "enableDevTools": "yes" })
        ));
        assert!(!is_devtools_enabled(
            &serde_json::json!({ "enableDevTools": 1 })
        ));
    }
}
