//! Windows DevTools 适配:WebView2 open_devtools 原生独立窗口。

/// 打开 DevTools 并确保以独立窗口显示(Windows 实现)。
///
/// WebView2 的 `open_devtools()` 本来就是独立窗口,无需 detach 处理。
pub async fn ensure_detached_devtools(webview: &tauri::Webview) {
    webview.open_devtools();
}

/// Windows WebView2 原生独立窗口,无 zoom/bounds 副作用,无需补偿。
#[must_use]
pub const fn needs_side_effect_compensation() -> bool {
    false
}

/// Windows 创建 webview 时无需额外 Inspector 配置。
pub const fn configure_inspector(_webview: &tauri::Webview) {}
