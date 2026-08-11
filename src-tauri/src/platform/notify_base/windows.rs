//! Windows 通知基地址:WebView2 通过 http://neeko.localhost/ 路由。

/// Windows (WebView2) 访问注册 URI scheme 的 base URL。
#[must_use]
pub const fn notify_base() -> &'static str {
    "http://neeko.localhost/"
}
