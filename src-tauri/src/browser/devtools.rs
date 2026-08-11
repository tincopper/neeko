//! DevTools 打开逻辑:统一调用平台适配层,并补偿 detach 副作用。
//!
//! 各平台 detach 差异(确保 Inspector 以独立窗口打开)集中在
//! `crate::platform::devtools`;本文件仅保留与平台无关的副作用补偿逻辑。

use super::webview_ops::sync_bounds;

/// 补偿延迟:detach 后等待 WebKit 异步副作用完成再重置缩放。
const COMPENSATION_DELAY_MS: u64 = 200;

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
/// detach 与平台差异逻辑集中在 `crate::platform::devtools`;
/// 是否需要 bounds/zoom 补偿由平台适配层决定(Windows 原生独立窗口无需补偿)。
pub async fn open_devtools_detached(
    webview: &tauri::Webview,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) {
    crate::platform::devtools::ensure_detached_devtools(webview).await;

    if crate::platform::devtools::needs_side_effect_compensation() {
        compensate_side_effects(webview, x, y, width, height).await;
    }
}
