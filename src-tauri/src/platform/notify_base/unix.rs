//! 非 Windows 通知基地址:WKWebView / WebKitGTK 通过 neeko://localhost/ 路由。

/// macOS (WKWebView) / Linux (WebKitGTK) 访问注册 URI scheme 的 base URL。
#[must_use]
pub const fn notify_base() -> &'static str {
    "neeko://localhost/"
}
