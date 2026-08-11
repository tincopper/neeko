//! 浏览器注入脚本通知基地址平台差异集中化。
//!
//! Tauri 在不同平台暴露已注册 URI scheme 的访问 URL 不同:
//! - Windows (WebView2): `http://<scheme>.localhost/<path>`
//! - macOS (WKWebView) / Linux (WebKitGTK): `<scheme>://localhost/<path>`

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
pub use windows::*;

#[cfg(not(target_os = "windows"))]
mod unix;
#[cfg(not(target_os = "windows"))]
pub use unix::*;
