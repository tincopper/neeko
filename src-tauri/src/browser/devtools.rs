//! DevTools 平台适配:确保 Inspector 以独立窗口(detached)形式打开。
//!
//! 各平台默认行为差异:
//! - Windows (WebView2):`open_devtools()` 本来就是独立窗口,无需处理。
//! - Linux (WebKitGTK):Inspector 默认附着在页面底部,show 后轮询
//!   `is_attached()`,一旦 open 完成且以 attached 显示立即 `detach()` 转独立窗口。
//! - macOS (WKWebView):`_inspector show` 默认附着,show 后轮询 `isVisible`,
//!   探测私有 `detach` selector 强制独立窗口(不存在则安全降级为默认行为)。
//!
//! 不能"先 show 再立即 detach":WebKit 的 attached/detached 决策发生在异步
//! `open()` 阶段(`show` -> `connect` -> IPC -> `openLocalInspectorFrontend()`
//! 会用 `shouldOpenAttached()` 重新赋值 `m_isAttached`),提前调用的 detach
//! 会被覆盖。因此必须轮询等待 open 完成后再 detach;detach 幂等,独立窗口下为 no-op。

use super::webview_ops::sync_bounds;

/// 轮询次数:30 轮 × 100ms = 3s 超时。
const DETACH_POLL_ROUNDS: u32 = 30;
/// 轮询间隔:每 100ms 检查一次 inspector 状态。
const DETACH_POLL_INTERVAL_MS: u64 = 100;
/// 补偿延迟:detach 后等待 WebKit 异步副作用完成再重置缩放。
const COMPENSATION_DELAY_MS: u64 = 200;

/// 打开 DevTools 并确保以独立窗口显示。
///
/// 本函数仅负责 detach 逻辑,不涉及 bounds/zoom 补偿。
async fn ensure_detached_devtools(webview: &tauri::Webview) {
    #[cfg(target_os = "macos")]
    {
        use objc2::msg_send;
        use objc2::rc::Retained;
        use objc2::runtime::AnyObject;
        use objc2::sel;

        // show:同步创建 inspector page,触发异步 open 流程
        let _ = webview.with_webview(|platform| unsafe {
            let wv: &objc2_web_kit::WKWebView = &*platform.inner().cast();
            let tool: Retained<AnyObject> = msg_send![wv, _inspector];
            let () = msg_send![&tool, show];
        });

        // 轮询 isVisible(open() 已执行、m_isVisible 置 true)后立即 detach。
        // detach 成功后立即 break:避免命令拖满 30 轮(3s)才返回。
        let detached = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        for _ in 0..DETACH_POLL_ROUNDS {
            tokio::time::sleep(std::time::Duration::from_millis(DETACH_POLL_INTERVAL_MS)).await;
            let flag = detached.clone();
            let _ = webview.with_webview(move |platform| unsafe {
                let wv: &objc2_web_kit::WKWebView = &*platform.inner().cast();
                let tool: Retained<AnyObject> = msg_send![wv, _inspector];
                let is_visible: bool = msg_send![&tool, isVisible];
                if is_visible {
                    let can_detach: bool = msg_send![&tool, respondsToSelector: sel!(detach)];
                    if can_detach {
                        let () = msg_send![&tool, detach];
                        flag.store(true, std::sync::atomic::Ordering::Relaxed);
                    }
                }
            });
            if detached.load(std::sync::atomic::Ordering::Relaxed) {
                break;
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        webview.open_devtools();

        // 与 macOS 同理:WebKitGTK 的 attached/detached 决策也在异步 open 阶段,
        // 提前 detach 会被覆盖。轮询 is_attached() 为 true 后立即 detach。
        #[cfg(target_os = "linux")]
        {
            let detached = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
            for _ in 0..DETACH_POLL_ROUNDS {
                tokio::time::sleep(std::time::Duration::from_millis(DETACH_POLL_INTERVAL_MS)).await;
                let flag = detached.clone();
                let _ = webview.with_webview(move |platform| {
                    use webkit2gtk::{WebInspectorExt, WebViewExt};
                    let gtk_webview = platform.inner();
                    if let Some(inspector) = gtk_webview.inspector() {
                        if inspector.is_attached() {
                            inspector.detach();
                            flag.store(true, std::sync::atomic::Ordering::Relaxed);
                        }
                    }
                });
                if detached.load(std::sync::atomic::Ordering::Relaxed) {
                    break;
                }
            }
        }
    }
}

/// 补偿 DevTools 打开后的副作用:恢复 bounds + 重置 zoom。
///
/// WebKit 的 detach 会触发异步 zoom 变化与 webview reposition,需立即恢复 bounds,
/// 并在延迟后再次重置 zoom + bounds 作为兜底。
async fn compensate_side_effects(
    webview: &tauri::Webview,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) {
    sync_bounds(webview, x, y, width, height);
    tokio::time::sleep(std::time::Duration::from_millis(COMPENSATION_DELAY_MS)).await;
    let _ = webview.set_zoom(1.0);
    sync_bounds(webview, x, y, width, height);
}

/// 打开 DevTools(独立窗口)并补偿副作用。
///
/// 调用者负责获取 webview 并传入 panel rect 用于 bounds 恢复。
pub async fn open_devtools_detached(
    webview: &tauri::Webview,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) {
    ensure_detached_devtools(webview).await;

    // Windows WebView2 原生独立窗口,无 zoom/bounds 副作用,无需补偿。
    #[cfg(not(target_os = "windows"))]
    {
        compensate_side_effects(webview, x, y, width, height).await;
    }
}
