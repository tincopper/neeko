//! Webview 生命周期操作:创建、bounds 规范化与设置。
//!
//! 所有 bounds 写入均经过 [`normalize_bounds`] 规范化,抵消 wry 在 macOS
//! child webview 上的 i32 截断问题。这是唯一的规范化层,前端无需重复处理。

use tauri::webview::{PageLoadEvent, WebviewBuilder};
use tauri::{Emitter, Manager, WebviewUrl};
use url::Url;

use crate::AppError;

use super::events::{
    EVENT_BROWSER_LOADING, EVENT_BROWSER_OPEN_URL, EVENT_BROWSER_PAGE_LOADED,
    EVENT_BROWSER_URL_CHANGED,
};
use super::scripts::{build_meta_script, scrollbar_script};

/// 创建内嵌浏览器 webview 并挂载到主窗口。
///
/// 包含:URL 解析、旧 webview 清理、WebviewBuilder 组装(导航/加载/新窗口事件
/// 回调 + 脚本注入)、Linux Inspector 独立窗口配置。返回 webview label。
pub async fn create_webview(
    app: &tauri::AppHandle,
    label: &str,
    url: &str,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<String, AppError> {
    let parsed_url: Url = url
        .trim()
        .parse()
        .map_err(|e: url::ParseError| AppError::InvalidInput(format!("Invalid URL: {}", e)))?;

    // 如果已经存在同 label 的 webview，先关闭
    if let Some(existing) = app.get_webview(label) {
        let _ = existing.close();
        // 短暂等待关闭完成
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }

    let window = app
        .get_window("main")
        .ok_or_else(|| AppError::NotFound("Main window not found".into()))?;

    // 创建前规范化坐标,避免 wry 对小数坐标的 i32 截断导致 webview 上移
    let (x, y, width, height) = normalize_bounds(x, y, width, height);

    let tauri_url = WebviewUrl::External(parsed_url);

    // 克隆 app handle 和 label 给 handler 内使用
    let app_nav = app.clone();
    let app_load = app.clone();
    let app_new_window = app.clone();
    let label_nav = label.to_string();
    let label_load = label.to_string();
    let label_new_window = label.to_string();
    let label_meta = label.to_string();

    let builder = WebviewBuilder::new(label, tauri_url)
        // on_navigation: 每次导航开始时通知前端新 URL（允许所有导航）
        .on_navigation(move |nav_url| {
            let url_str = nav_url.to_string();
            let payload = serde_json::json!({ "label": &label_nav, "url": &url_str });
            let _ = app_nav.emit(EVENT_BROWSER_URL_CHANGED, payload);
            true // 允许跳转
        })
        // on_page_load: 页面加载开始/完成时通知前端
        .on_page_load(move |webview, payload| match payload.event() {
            PageLoadEvent::Started => {
                let payload = serde_json::json!({ "label": &label_load, "loading": true });
                let _ = app_load.emit(EVENT_BROWSER_LOADING, payload);
            }
            PageLoadEvent::Finished => {
                let url_str = payload.url().to_string();
                let payload = serde_json::json!({ "label": &label_load, "url": &url_str });
                let _ = app_load.emit(EVENT_BROWSER_PAGE_LOADED, payload);
                let payload = serde_json::json!({ "label": &label_load, "loading": false });
                let _ = app_load.emit(EVENT_BROWSER_LOADING, payload);

                // 提取页面标题与 favicon,经 neeko:// 协议 POST 回传(小数据)。
                let _ = webview.eval(build_meta_script(&label_meta));
                // 注入细滚动条样式(与应用 thin-scrollbar 6px 一致)
                let _ = webview.eval(scrollbar_script());
            }
        })
        // on_new_window: 拦截 target="_blank" 链接，在当前 webview 中导航
        .on_new_window(move |new_url, _features| {
            let url_str = new_url.to_string();
            let payload = serde_json::json!({ "label": &label_new_window, "url": &url_str });
            let _ = app_new_window.emit(EVENT_BROWSER_OPEN_URL, payload);
            tauri::webview::NewWindowResponse::Deny
        });

    let webview = window
        .add_child(
            builder,
            tauri::LogicalPosition::new(x, y),
            tauri::LogicalSize::new(width, height),
        )
        .map_err(|e| AppError::Unknown(format!("Failed to create browser webview: {}", e)))?;

    // Linux (WebKitGTK):强制 DevTools/Inspector 以独立窗口显示。
    // WebKitGTK 默认将 Inspector 附着在 webview 底部(占用页面区域),
    // 连接 attach 信号并返回 false 可使其显示为独立窗口。
    #[cfg(target_os = "linux")]
    {
        use webkit2gtk::{WebInspectorExt, WebViewExt};
        let _ = webview.with_webview(|platform| {
            let inner = platform.inner();
            if let Some(inspector) = inner.inspector() {
                let _ = inspector.connect_attach(|_| false);
            }
        });
    }

    // webview handle 在非 Linux 平台仅用于创建子视图(Linux 额外配置 Inspector)
    let _ = &webview;

    Ok(label.to_string())
}

/// 规范化浏览器 webview 的 bounds(唯一规范化层):抵消 wry 在 macOS child
/// webview 上的 i32 截断(向零取整)。前端 `getBoundingClientRect()` 常返回
/// 小数(如 dock 边框/分割线导致 y=32.5),直接传给 wry 会被截断为 32,
/// 导致 webview 顶部偏上、内容被覆盖。位置向上取整(顶部不被覆盖),
/// 尺寸向下取整(不超出容器)。幂等:整数输入保持不变。
/// 所有 command 入口(create_browser_webview / set_webview_bounds)均调用此函数,
/// 前端无需重复规范化。
#[must_use]
pub const fn normalize_bounds(x: f64, y: f64, width: f64, height: f64) -> (f64, f64, f64, f64) {
    (x.ceil(), y.ceil(), width.floor(), height.floor())
}

/// 一次性设置 webview bounds,避免 set_position/set_size 分步调用期间的中间状态。
pub fn set_webview_bounds(
    webview: &tauri::Webview,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), tauri::Error> {
    let (x, y, width, height) = normalize_bounds(x, y, width, height);
    log::debug!("set_webview_bounds: x={x}, y={y}, w={width}, h={height}");
    webview.set_bounds(tauri::Rect {
        position: tauri::Position::Logical(tauri::LogicalPosition::new(x, y)),
        size: tauri::Size::Logical(tauri::LogicalSize::new(width, height)),
    })?;
    if let Ok(actual) = webview.bounds() {
        let (ax, ay) = match actual.position {
            tauri::Position::Logical(p) => (p.x, p.y),
            tauri::Position::Physical(p) => (f64::from(p.x), f64::from(p.y)),
        };
        log::debug!("set_webview_bounds actual: x={ax}, y={ay}");
    }
    Ok(())
}

/// 同步 webview bounds。宽高非法(≤0)时跳过,避免把 webview 设成无效尺寸。
/// 与 [`set_webview_bounds`] 的区别:此函数忽略错误(容错场景,如 DevTools
/// 打开后的 bounds 恢复),适合不需要向上传播错误的调用点。
pub fn sync_bounds(webview: &tauri::Webview, x: f64, y: f64, width: f64, height: f64) {
    if width <= 0.0 || height <= 0.0 {
        return;
    }
    let _ = set_webview_bounds(webview, x, y, width, height);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_bounds_ceils_position_floors_size() {
        // 小数坐标:位置向上取整(顶部不被遮挡),尺寸向下取整(不超出容器)
        assert_eq!(
            normalize_bounds(10.2, 32.5, 300.7, 200.9),
            (11.0, 33.0, 300.0, 200.0)
        );
    }

    #[test]
    fn test_normalize_bounds_integer_input_unchanged() {
        // 整数输入保持不变(幂等,重复调用无副作用)
        assert_eq!(
            normalize_bounds(10.0, 32.0, 300.0, 200.0),
            (10.0, 32.0, 300.0, 200.0)
        );
    }

    #[test]
    fn test_normalize_bounds_negative_coords_round_toward_zero() {
        // 负坐标防御:ceil 向 0 取整,不会进一步上移
        assert_eq!(
            normalize_bounds(-1.5, -2.5, 100.5, 50.5),
            (-1.0, -2.0, 100.0, 50.0)
        );
    }
}
