//! 注入脚本常量与构建:页面元信息回传脚本、滚动条样式脚本、元素选择器脚本。
//!
//! 这些脚本通过 `webview.eval()` 注入到浏览器 webview 中,用于采集页面状态
//! 和统一样式。脚本内容在此集中管理,避免散落在 command 函数中。

/// Base URL the injected picker script uses to notify the Rust side via
/// `<img src=...>` requests handled by `register_uri_scheme_protocol("neeko", ...)`.
///
/// Tauri exposes the registered scheme via different access URLs per platform:
/// - Windows (WebView2): `http://<scheme>.localhost/<path>`
/// - macOS (WKWebView) / Linux (WebKitGTK): `<scheme>://localhost/<path>`
///
/// Hardcoding the Windows form previously broke picker -> Rust notifications
/// (prompt-submitted / picker-cancelled / element-picked) on macOS and Linux.
#[cfg(target_os = "windows")]
pub const NOTIFY_BASE: &str = "http://neeko.localhost/";
/// Base URL (non-Windows):`neeko://localhost/`(WKWebView / WebKitGTK)。
#[cfg(not(target_os = "windows"))]
pub const NOTIFY_BASE: &str = "neeko://localhost/";

/// Element picker injection script.
/// Phase 1: highlight + tooltip on hover, click to select.
/// Phase 2: inline prompt textarea appears next to selected element.
///          Enter submits, Shift/Ctrl/Alt+Enter inserts newline, ESC / ✕ / click-outside cancels.
/// Theme colours are read from `window.__NEEKO_THEME__` (set before injection) with dark fallbacks.
/// 脚本本体见同目录 `picker_script.js`(include_str! 引入)。
pub const PICKER_SCRIPT: &str = include_str!("picker_script.js");

/// 注入细滚动条样式(与应用 thin-scrollbar 6px 一致),避免网页默认滚动条过粗。
/// 颜色优先跟随主题变量 `window.__NEEKO_THEME__`,否则用灰色兜底。
const SCROLLBAR_SCRIPT: &str = r#"(function(){if(document.getElementById('neeko-scrollbar'))return;var t=window.__NEEKO_THEME__||{};var thumb=t['--bg-hover']||'rgba(128,128,128,0.45)';var hover=t['--text-muted']||'rgba(128,128,128,0.7)';var s=document.createElement('style');s.id='neeko-scrollbar';s.textContent='html{scrollbar-width:thin!important;scrollbar-color:'+thumb+' transparent!important}::-webkit-scrollbar{width:6px!important;height:6px!important}::-webkit-scrollbar-track{background:transparent!important}::-webkit-scrollbar-thumb{background:'+thumb+'!important;border-radius:3px!important}::-webkit-scrollbar-thumb:hover{background:'+hover+'!important}::-webkit-scrollbar-corner{background:transparent!important}';(document.head||document.documentElement).appendChild(s);})()"#;

/// 构建页面元信息(title/favicon)回传脚本。
///
/// 页面加载完成后注入,通过 `neeko://page-meta` POST 回传标题与 favicon,
/// label 嵌入脚本以区分多项目 webview。
#[must_use]
pub fn build_meta_script(label: &str) -> String {
    let label_json = serde_json::to_string(label).unwrap_or_else(|_| "\"\"".to_string());
    format!(
        "fetch('{base}page-meta',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{label:{label},title:document.title||'',favicon:(document.querySelector('link[rel~=\"icon\"]')||{{}}).href||''}})}})",
        base = NOTIFY_BASE,
        label = label_json,
    )
}

/// 返回滚动条样式注入脚本(惰性:已存在则跳过)。
#[must_use]
pub const fn scrollbar_script() -> &'static str {
    SCROLLBAR_SCRIPT
}

/// 构建元素选择器注入脚本:设置主题变量 + notify base + picker 脚本本体。
pub fn build_picker_script(
    theme_colors: Option<std::collections::HashMap<String, String>>,
) -> Result<String, crate::AppError> {
    let theme_json = serde_json::to_string(&theme_colors.unwrap_or_default())
        .unwrap_or_else(|_| "{}".to_string());
    let notify_base_json = serde_json::to_string(NOTIFY_BASE)
        .map_err(|e| crate::AppError::Unknown(format!("Failed to serialize NOTIFY_BASE: {}", e)))?;
    Ok(format!(
        "window.__NEEKO_THEME__ = {};\nwindow.__NEEKO_NOTIFY_BASE__ = {};\n{}",
        theme_json, notify_base_json, PICKER_SCRIPT
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notify_base_ends_with_slash() {
        // The picker script concatenates `base + path`, so a missing trailing
        // slash would silently produce a malformed URL on every notify().
        assert!(
            NOTIFY_BASE.ends_with('/'),
            "NOTIFY_BASE must end with '/': {}",
            NOTIFY_BASE
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn notify_base_uses_localhost_http_form_on_windows() {
        // WebView2 routes register_uri_scheme_protocol("neeko", ...) via
        // http://neeko.localhost/<path>.
        assert_eq!(NOTIFY_BASE, "http://neeko.localhost/");
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn notify_base_uses_custom_scheme_off_windows() {
        // WKWebView / WebKitGTK route register_uri_scheme_protocol via
        // <scheme>://localhost/<path>.
        assert_eq!(NOTIFY_BASE, "neeko://localhost/");
    }

    #[test]
    fn notify_base_serializes_as_json_string_literal() {
        // The injected script depends on serde_json wrapping NOTIFY_BASE in
        // double quotes so it becomes a valid JS string literal.
        let json = serde_json::to_string(NOTIFY_BASE).unwrap();
        assert!(json.starts_with('"') && json.ends_with('"'));
        assert!(json.contains(NOTIFY_BASE));
    }

    #[test]
    fn build_meta_script_contains_label_and_endpoint() {
        let script = build_meta_script("neeko-browser-test");
        assert!(script.contains("page-meta"));
        assert!(script.contains("neeko-browser-test"));
        assert!(script.contains("document.title"));
    }

    #[test]
    fn scrollbar_script_is_idempotent_guard() {
        let script = scrollbar_script();
        // 脚本包含幂等守卫:已存在 #neeko-scrollbar 则跳过
        assert!(script.contains("getElementById('neeko-scrollbar')"));
        assert!(script.contains("return;"));
    }
}
