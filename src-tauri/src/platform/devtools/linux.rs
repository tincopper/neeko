//! Linux DevTools 适配:WebKitGTK open_devtools + is_attached 轮询 + detach。

use std::sync::atomic::{AtomicBool, Ordering};

/// 轮询次数:30 轮 × 100ms = 3s 超时。
const DETACH_POLL_ROUNDS: u32 = 30;
/// 轮询间隔:每 100ms 检查一次 inspector 状态。
const DETACH_POLL_INTERVAL_MS: u64 = 100;

/// 打开 DevTools 并确保以独立窗口显示(Linux 实现)。
///
/// WebKitGTK 的 attached/detached 决策也在异步 open 阶段,提前 detach 会被覆盖。
/// 因此轮询 `is_attached()` 为 true 后立即 detach;detach 幂等,独立窗口下为 no-op。
pub async fn ensure_detached_devtools(webview: &tauri::Webview) {
    webview.open_devtools();

    let detached = std::sync::Arc::new(AtomicBool::new(false));
    for _ in 0..DETACH_POLL_ROUNDS {
        tokio::time::sleep(std::time::Duration::from_millis(DETACH_POLL_INTERVAL_MS)).await;
        let flag = detached.clone();
        let _ = webview.with_webview(move |platform| {
            use webkit2gtk::{WebInspectorExt, WebViewExt};
            let gtk_webview = platform.inner();
            if let Some(inspector) = gtk_webview.inspector() {
                if inspector.is_attached() {
                    inspector.detach();
                    flag.store(true, Ordering::Relaxed);
                }
            }
        });
        if detached.load(Ordering::Relaxed) {
            break;
        }
    }
}

/// Linux 的 detach 会触发 zoom/bounds 副作用,需要补偿。
#[must_use]
pub const fn needs_side_effect_compensation() -> bool {
    true
}

/// Linux 创建 webview 时强制 Inspector 以独立窗口显示。
///
/// WebKitGTK 默认将 Inspector 附着在 webview 底部(占用页面区域),
/// 连接 attach 信号并返回 false 可使其显示为独立窗口。
pub fn configure_inspector(webview: &tauri::Webview) {
    use webkit2gtk::{WebInspectorExt, WebViewExt};
    let _ = webview.with_webview(|platform| {
        let inner = platform.inner();
        if let Some(inspector) = inner.inspector() {
            let _ = inspector.connect_attach(|_| false);
        }
    });
}
