//! macOS DevTools 适配:WKWebView `_inspector` show + isVisible 轮询 + detach。

use std::sync::atomic::{AtomicBool, Ordering};

/// 轮询次数:30 轮 × 100ms = 3s 超时。
const DETACH_POLL_ROUNDS: u32 = 30;
/// 轮询间隔:每 100ms 检查一次 inspector 状态。
const DETACH_POLL_INTERVAL_MS: u64 = 100;

/// 打开 DevTools 并确保以独立窗口显示(macOS 实现)。
///
/// 不能"先 show 再立即 detach":WebKit 的 attached/detached 决策发生在异步
/// `open()` 阶段(`show` -> `connect` -> IPC -> `openLocalInspectorFrontend()`
/// 会用 `shouldOpenAttached()` 重新赋值 `m_isAttached`),提前调用的 detach
/// 会被覆盖。因此必须轮询等待 open 完成后再 detach;detach 幂等,独立窗口下为 no-op。
pub async fn ensure_detached_devtools(webview: &tauri::Webview) {
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
    let detached = std::sync::Arc::new(AtomicBool::new(false));
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
                    flag.store(true, Ordering::Relaxed);
                }
            }
        });
        if detached.load(Ordering::Relaxed) {
            break;
        }
    }
}

/// macOS 的 detach 会触发 zoom/bounds 副作用,需要补偿。
#[must_use]
pub const fn needs_side_effect_compensation() -> bool {
    true
}

/// macOS 创建 webview 时无需额外 Inspector 配置。
pub const fn configure_inspector(_webview: &tauri::Webview) {}
