//! Browser webview Tauri 命令入口层。
//!
//! 本文件仅包含 `#[tauri::command]` 函数,职责限定为:
//! 1. 接收前端参数
//! 2. 基本校验(委托 url_validator)
//! 3. 调度对应 service 函数
//! 4. 返回 `Result<T, AppError>`
//!
//! 所有业务逻辑(创建/操作 webview、DevTools 适配、脚本注入)均在同级
//! service 模块中实现,禁止在此平铺。

use tauri::Manager;

use crate::AppError;

use super::devtools::open_devtools_detached;
use super::scripts::build_picker_script;
use super::url_validator::{resolve_allowed_file_root, resolve_project_root, validate_url_scheme};
use super::webview_ops::{create_webview, set_webview_bounds};

/// 创建内嵌浏览器 webview（Rust 侧真实创建，支持事件通知）
/// 返回 webview label
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn create_browser_webview(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::app_state::AppStateWrapper>,
    label: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<String, AppError> {
    let allowed_root = resolve_allowed_file_root(&state, &label);
    validate_url_scheme(&url, allowed_root.as_deref())?;
    create_webview(&app, &label, &url, x, y, width, height).await
}

/// 导航到新 URL
#[tauri::command]
pub async fn browser_navigate(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::app_state::AppStateWrapper>,
    label: String,
    url: String,
) -> Result<(), AppError> {
    let allowed_root = resolve_allowed_file_root(&state, &label);
    validate_url_scheme(&url, allowed_root.as_deref())?;

    let webview = app
        .get_webview(&label)
        .ok_or_else(|| AppError::NotFound(format!("Browser webview not found: {}", label)))?;

    let parsed_url: url::Url = url
        .trim()
        .parse()
        .map_err(|e: url::ParseError| AppError::InvalidInput(format!("Invalid URL: {}", e)))?;

    webview
        .navigate(parsed_url)
        .map_err(|e| AppError::Unknown(format!("Failed to navigate: {}", e)))?;
    Ok(())
}

/// 更新浏览器 webview 的位置和大小
#[tauri::command]
pub async fn browser_set_bounds(
    app: tauri::AppHandle,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), AppError> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| AppError::NotFound(format!("Browser webview not found: {}", label)))?;
    set_webview_bounds(&webview, x, y, width, height)
        .map_err(|e| AppError::Unknown(format!("Failed to set bounds: {}", e)))?;
    Ok(())
}

/// 打开 DevTools
#[tauri::command]
pub async fn browser_open_devtools(
    app: tauri::AppHandle,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), AppError> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| AppError::NotFound(format!("Browser webview not found: {}", label)))?;
    open_devtools_detached(&webview, x, y, width, height).await;
    Ok(())
}

/// 重置浏览器 webview 页面缩放为 100%
#[tauri::command]
pub async fn browser_reset_zoom(app: tauri::AppHandle, label: String) -> Result<(), AppError> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| AppError::NotFound(format!("Browser webview not found: {}", label)))?;
    webview
        .set_zoom(1.0)
        .map_err(|e| AppError::Unknown(format!("Failed to reset zoom: {}", e)))?;
    Ok(())
}

/// 关闭/销毁浏览器 webview
#[tauri::command]
pub async fn browser_close(app: tauri::AppHandle, label: String) -> Result<(), AppError> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| AppError::NotFound(format!("Browser webview not found: {}", label)))?;
    webview
        .close()
        .map_err(|e| AppError::Unknown(format!("Failed to close webview: {}", e)))?;
    Ok(())
}

/// 显示/隐藏浏览器 webview
#[tauri::command]
pub async fn browser_set_visible(
    app: tauri::AppHandle,
    label: String,
    visible: bool,
) -> Result<(), AppError> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| AppError::NotFound(format!("Browser webview not found: {}", label)))?;
    if visible {
        webview
            .show()
            .map_err(|e| AppError::Unknown(format!("Failed to show webview: {}", e)))?;
    } else {
        webview
            .hide()
            .map_err(|e| AppError::Unknown(format!("Failed to hide webview: {}", e)))?;
    }
    Ok(())
}

/// 后退
#[tauri::command]
pub async fn browser_go_back(app: tauri::AppHandle, label: String) -> Result<(), AppError> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| AppError::NotFound(format!("Browser webview not found: {}", label)))?;
    webview
        .eval("window.history.back()")
        .map_err(|e| AppError::Unknown(format!("Failed to go back: {}", e)))?;
    Ok(())
}

/// 前进
#[tauri::command]
pub async fn browser_go_forward(app: tauri::AppHandle, label: String) -> Result<(), AppError> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| AppError::NotFound(format!("Browser webview not found: {}", label)))?;
    webview
        .eval("window.history.forward()")
        .map_err(|e| AppError::Unknown(format!("Failed to go forward: {}", e)))?;
    Ok(())
}

/// 用系统默认浏览器打开 URL
///
/// 使用 `open` crate(`shellexecute-on-windows` feature):Windows 走
/// ShellExecuteExW(不经 `cmd` 解释,消除 shell 注入面),macOS 调 `open`,
/// Linux 调 `xdg-open`;`that_detached` 不阻塞调用方。
///
/// `project_id` 提供 file:// 白名单上下文:有项目时仅允许打开项目根内的
/// 本地文件(与 webview 导航同一套校验);无项目时只允许 http/https。
#[tauri::command]
pub fn open_in_default_browser(
    state: tauri::State<'_, crate::app_state::AppStateWrapper>,
    url: String,
    project_id: Option<String>,
) -> Result<(), AppError> {
    let allowed_root = project_id
        .as_deref()
        .and_then(|id| resolve_project_root(&state, id));
    validate_url_scheme(&url, allowed_root.as_deref())?;
    open::that_detached(url).map_err(|e| AppError::Io(format!("Failed to open URL: {e}")))?;
    Ok(())
}

/// 启动元素选择器：注入高亮 + tooltip + 点击捕获脚本
#[tauri::command]
pub async fn browser_start_picker(
    app: tauri::AppHandle,
    label: String,
    theme_colors: Option<std::collections::HashMap<String, String>>,
) -> Result<(), AppError> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| AppError::NotFound(format!("Browser webview not found: {}", label)))?;
    let script = build_picker_script(theme_colors)?;
    webview
        .eval(&script)
        .map_err(|e| AppError::Unknown(format!("Failed to inject picker script: {}", e)))?;
    Ok(())
}

/// 停止元素选择器
#[tauri::command]
pub async fn browser_stop_picker(app: tauri::AppHandle, label: String) -> Result<(), AppError> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| AppError::NotFound(format!("Browser webview not found: {}", label)))?;
    webview
        .eval("window.__NEEKO_PICKER__ && window.__NEEKO_PICKER__.stop()")
        .map_err(|e| AppError::Unknown(format!("Failed to stop picker: {}", e)))?;
    Ok(())
}
