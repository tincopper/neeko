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
/// 通知基地址(平台差异集中化于 `crate::platform::notify_base`)。
pub use crate::platform::notify_base::notify_base;

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
        base = notify_base(),
        label = label_json,
    )
}

/// 返回滚动条样式注入脚本(惰性:已存在则跳过)。
#[must_use]
pub const fn scrollbar_script() -> &'static str {
    SCROLLBAR_SCRIPT
}

/// 构建元素选择器注入脚本:设置主题变量 + notify base + label + picker 脚本本体。
///
/// `label` 嵌入脚本供 picker 提交 payload 携带(webview 唯一标识,前端据此将
/// prompt 路由到对应项目/ tab 的 Agent CLI 终端)。
pub fn build_picker_script(
    theme_colors: Option<std::collections::HashMap<String, String>>,
    label: &str,
) -> Result<String, crate::AppError> {
    let theme_json = serde_json::to_string(&theme_colors.unwrap_or_default())
        .unwrap_or_else(|_| "{}".to_string());
    let notify_base_json = serde_json::to_string(notify_base())
        .map_err(|e| crate::AppError::Unknown(format!("Failed to serialize notify_base: {}", e)))?;
    let label_json = serde_json::to_string(label).unwrap_or_else(|_| "\"\"".to_string());
    Ok(format!(
        "window.__NEEKO_THEME__ = {};\nwindow.__NEEKO_NOTIFY_BASE__ = {};\nwindow.__NEEKO_BROWSER_LABEL__ = {};\n{}",
        theme_json, notify_base_json, label_json, PICKER_SCRIPT
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
            notify_base().ends_with('/'),
            "notify_base must end with '/': {}",
            notify_base()
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn notify_base_uses_localhost_http_form_on_windows() {
        // WebView2 routes register_uri_scheme_protocol("neeko", ...) via
        // http://neeko.localhost/<path>.
        assert_eq!(notify_base(), "http://neeko.localhost/");
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn notify_base_uses_custom_scheme_off_windows() {
        // WKWebView / WebKitGTK route register_uri_scheme_protocol via
        // <scheme>://localhost/<path>.
        assert_eq!(notify_base(), "neeko://localhost/");
    }

    #[test]
    fn notify_base_serializes_as_json_string_literal() {
        // The injected script depends on serde_json wrapping notify_base in
        // double quotes so it becomes a valid JS string literal.
        let json = serde_json::to_string(notify_base()).unwrap();
        assert!(json.starts_with('"') && json.ends_with('"'));
        assert!(json.contains(notify_base()));
    }

    #[test]
    fn build_meta_script_contains_label_and_endpoint() {
        let script = build_meta_script("neeko-browser-test");
        assert!(script.contains("page-meta"));
        assert!(script.contains("neeko-browser-test"));
        assert!(script.contains("document.title"));
    }

    #[test]
    fn build_picker_script_embeds_label_for_routing() {
        let script = build_picker_script(None, "neeko-browser-tab-t1").unwrap();
        assert!(script.contains("__NEEKO_BROWSER_LABEL__"));
        assert!(script.contains("neeko-browser-tab-t1"));
    }

    #[test]
    fn build_picker_script_quotes_label_as_json() {
        // label 必须以 JSON 字符串字面量嵌入,避免破坏注入脚本语法
        let script = build_picker_script(None, "neeko-browser-\"x\"").unwrap();
        assert!(script.contains("__NEEKO_BROWSER_LABEL__ = \"neeko-browser-\\\"x\\\"\";"));
    }

    #[test]
    fn scrollbar_script_is_idempotent_guard() {
        let script = scrollbar_script();
        // 脚本包含幂等守卫:已存在 #neeko-scrollbar 则跳过
        assert!(script.contains("getElementById('neeko-scrollbar')"));
        assert!(script.contains("return;"));
    }
}
