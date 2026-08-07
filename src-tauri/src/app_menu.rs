//! 应用菜单构建与菜单事件转发（Cmd+W 关闭标签页 / macOS Edit 命令）。

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};

/// File 菜单「关闭标签页」项 id（菜单构建与事件分发共用）。
const MENU_CLOSE_TAB_ID: &str = "close_tab";

/// 关闭标签页事件名（Cmd+W 菜单转发），与前端 `src/shared/events.ts` `CLOSE_TAB_EVENT` 同步。
const CLOSE_TAB_EVENT: &str = "close-tab";

/// 菜单「粘贴」事件名（macOS 自定义菜单转发），与前端 `src/shared/events.ts` `MENU_PASTE_EVENT` 同步。
const MENU_PASTE_EVENT: &str = "menu-paste";

/// macOS Edit 菜单项 id（构建与分发共用，单一事实源）。
#[cfg(target_os = "macos")]
mod edit_menu {
    pub const CUT: &str = "cut";
    pub const COPY: &str = "copy";
    pub const PASTE: &str = "paste";
    pub const SELECT_ALL: &str = "select_all";
}

/// macOS Edit 菜单命令的转发动作（纯逻辑，可独立单测）。
#[cfg(target_os = "macos")]
#[derive(Debug, PartialEq, Eq)]
enum EditMenuAction {
    /// 在 webview 中执行的 JS 片段。
    EvalJs(&'static str),
    /// 转发粘贴事件到前端。
    EmitPaste,
}

/// 菜单项 id → 转发动作。非 Edit 菜单项返回 `None`。
#[cfg(target_os = "macos")]
fn resolve_edit_menu_action(id: &str) -> Option<EditMenuAction> {
    match id {
        edit_menu::CUT => Some(EditMenuAction::EvalJs("document.execCommand('cut')")),
        edit_menu::COPY => Some(EditMenuAction::EvalJs("document.execCommand('copy')")),
        edit_menu::SELECT_ALL => Some(EditMenuAction::EvalJs("document.execCommand('selectAll')")),
        edit_menu::PASTE => Some(EditMenuAction::EmitPaste),
        _ => None,
    }
}

/// 构建 macOS Edit 子菜单（Cut/Copy/Paste/Select All），事件转发见 `handle_menu_event`。
#[cfg(target_os = "macos")]
fn build_edit_submenu(
    handle: &tauri::AppHandle,
) -> tauri::Result<tauri::menu::Submenu<tauri::Wry>> {
    let cut = MenuItemBuilder::with_id(edit_menu::CUT, "Cut")
        .accelerator("CmdOrCtrl+X")
        .build(handle)?;
    let copy = MenuItemBuilder::with_id(edit_menu::COPY, "Copy")
        .accelerator("CmdOrCtrl+C")
        .build(handle)?;
    let paste = MenuItemBuilder::with_id(edit_menu::PASTE, "Paste")
        .accelerator("CmdOrCtrl+V")
        .build(handle)?;
    let select_all = MenuItemBuilder::with_id(edit_menu::SELECT_ALL, "Select All")
        .accelerator("CmdOrCtrl+A")
        .build(handle)?;
    SubmenuBuilder::new(handle, "Edit")
        .items(&[&cut, &copy, &paste])
        .separator()
        .item(&select_all)
        .build()
}

/// 构建应用主菜单：File（Cmd+W 关闭标签页）+ macOS Edit（剪贴板命令）。
///
/// macOS delivers webview copy/paste/cut/select-all as native Edit menu
/// accelerators, not as raw key events. A custom menu without an Edit
/// submenu silently breaks Cmd+C/V/X/A in every focus context (terminal,
/// editor, input fields). Restore the standard items here and forward them
/// to the webview in [`handle_menu_event`].
pub fn build_menu(handle: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let close_tab = MenuItemBuilder::with_id(MENU_CLOSE_TAB_ID, "Close Tab")
        .accelerator("CmdOrCtrl+W")
        .build(handle)?;
    let file = SubmenuBuilder::new(handle, "File")
        .item(&close_tab)
        .build()?;

    let mut menu = MenuBuilder::new(handle).item(&file);

    #[cfg(target_os = "macos")]
    {
        menu = menu.item(&build_edit_submenu(handle)?);
    }

    menu.build()
}

/// 处理菜单事件：Cmd+W 关闭标签页（全平台）+ Edit 命令转发（macOS）。
///
/// `paste` is routed to the frontend (menu-paste) instead of
/// document.execCommand('paste'): triggering a programmatic paste makes
/// WKWebView show the native paste callout. The frontend reads the clipboard
/// via the clipboard-manager plugin and inserts it with
/// execCommand('insertText') (no callout, keeps undo).
pub fn handle_menu_event(app: &tauri::AppHandle, id: &str, cmd_w_flag: &AtomicBool) {
    if id == MENU_CLOSE_TAB_ID {
        cmd_w_flag.store(true, Ordering::SeqCst);
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.emit(CLOSE_TAB_EVENT, ());
        }
        return;
    }

    // Forward Edit menu commands to the focused webview so copy/paste/
    // cut/select-all reach the terminal, editor and input fields.
    #[cfg(target_os = "macos")]
    if let Some(action) = resolve_edit_menu_action(id) {
        if let Some(window) = app.get_webview_window("main") {
            match action {
                EditMenuAction::EvalJs(js) => {
                    let _ = window.eval(js);
                }
                EditMenuAction::EmitPaste => {
                    let _ = window.emit(MENU_PASTE_EVENT, ());
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn resolves_edit_menu_cut_copy_select_all_to_eval_js() {
        assert_eq!(
            resolve_edit_menu_action(edit_menu::CUT),
            Some(EditMenuAction::EvalJs("document.execCommand('cut')"))
        );
        assert_eq!(
            resolve_edit_menu_action(edit_menu::COPY),
            Some(EditMenuAction::EvalJs("document.execCommand('copy')"))
        );
        assert_eq!(
            resolve_edit_menu_action(edit_menu::SELECT_ALL),
            Some(EditMenuAction::EvalJs("document.execCommand('selectAll')"))
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn resolves_edit_menu_paste_to_emit_paste() {
        assert_eq!(
            resolve_edit_menu_action(edit_menu::PASTE),
            Some(EditMenuAction::EmitPaste)
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn rejects_unknown_and_close_tab_menu_ids() {
        assert_eq!(resolve_edit_menu_action(MENU_CLOSE_TAB_ID), None);
        assert_eq!(resolve_edit_menu_action("bogus"), None);
    }
}
