use crate::AppError;
use tauri::webview::{PageLoadEvent, WebviewBuilder};
use tauri::{Emitter, Manager, WebviewUrl};
use url::Url;

use super::events::{
    EVENT_BROWSER_LOADING, EVENT_BROWSER_OPEN_URL, EVENT_BROWSER_PAGE_LOADED,
    EVENT_BROWSER_URL_CHANGED,
};

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
const NOTIFY_BASE: &str = "http://neeko.localhost/";
#[cfg(not(target_os = "windows"))]
const NOTIFY_BASE: &str = "neeko://localhost/";

/// 校验 URL scheme 是否安全（允许 http/https；file 仅限白名单根目录内）。
///
/// `allowed_file_root` 为 file:// 导航允许的根目录(项目根)。传入 `None` 时
/// 拒绝任何 file:// URL(防御:无项目上下文时不允许浏览本地文件)。
fn validate_url_scheme(
    url: &str,
    allowed_file_root: Option<&std::path::Path>,
) -> Result<(), AppError> {
    let trimmed = url.trim();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Ok(());
    }
    if trimmed.starts_with("file://") {
        return validate_file_url(trimmed, allowed_file_root);
    }
    Err(AppError::InvalidInput(format!(
        "URL scheme not allowed (only http/https/file): {}",
        trimmed
    )))
}

/// 校验 file:// URL 的本地路径位于白名单根目录内(经 canonicalize 防穿越)。
fn validate_file_url(
    url: &str,
    allowed_file_root: Option<&std::path::Path>,
) -> Result<(), AppError> {
    let root = match allowed_file_root {
        Some(r) => r,
        None => {
            return Err(AppError::InvalidInput(
                "file:// URL not allowed: no allowlisted project root".into(),
            ))
        }
    };

    // 剥离 file:// 前缀与查询/fragment(防御性)
    let path_str = url.trim_start_matches("file://");
    let path_str = path_str.split(['?', '#']).next().unwrap_or(path_str);
    let raw_path = std::path::PathBuf::from(path_str);

    let root_canon = root
        .canonicalize()
        .map_err(|e| AppError::InvalidInput(format!("Invalid project root: {e}")))?;
    let path_canon = raw_path
        .canonicalize()
        .map_err(|_| AppError::InvalidInput(format!("File not found or inaccessible: {}", url)))?;

    if path_canon.starts_with(&root_canon) {
        Ok(())
    } else {
        Err(AppError::InvalidInput(format!(
            "file:// URL outside project root: {}",
            url
        )))
    }
}

/// 从 webview label(`neeko-browser-{projectId}`)反推项目根作为 file:// 白名单基准。
/// 非浏览器 label 或无对应项目时返回 `None`(file:// 将被拒绝)。
fn resolve_allowed_file_root(
    state: &crate::app_state::AppStateWrapper,
    label: &str,
) -> Option<std::path::PathBuf> {
    let project_id = label.strip_prefix("neeko-browser-")?;
    let manager = state.project_manager.lock().ok()?;
    manager.get_project(project_id).map(|p| p.path.clone())
}

/// 创建内嵌浏览器 webview（Rust 侧真实创建，支持事件通知）
/// 返回 webview label
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn create_browser_webview(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::app_state::AppStateWrapper>,
    label: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<String, AppError> {
    let allowed_root = resolve_allowed_file_root(&state, &label);
    validate_url_scheme(&url, allowed_root.as_deref())?;

    let parsed_url: Url = url
        .trim()
        .parse()
        .map_err(|e: url::ParseError| AppError::InvalidInput(format!("Invalid URL: {}", e)))?;

    // 如果已经存在同 label 的 webview，先关闭
    if let Some(existing) = app.get_webview(&label) {
        let _ = existing.close();
        // 短暂等待关闭完成
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }

    let window = app
        .get_window("main")
        .ok_or_else(|| AppError::NotFound("Main window not found".into()))?;

    let tauri_url = WebviewUrl::External(parsed_url);

    // 克隆 app handle 和 label 给 handler 内使用
    let app_nav = app.clone();
    let app_load = app.clone();
    let label_nav = label.clone();
    let label_load = label.clone();
    let label_new_window = label.clone();

    let builder = WebviewBuilder::new(&label, tauri_url)
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
                // label 嵌入脚本以区分多项目 webview。
                let meta_label = label_load.clone();
                let notify_base = NOTIFY_BASE;
                let meta_script = format!(
                    "fetch('{base}page-meta',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{label:{label},title:document.title||'',favicon:(document.querySelector('link[rel~=\"icon\"]')||{{}}).href||''}})}})",
                    base = notify_base,
                    label = serde_json::to_string(&meta_label)
                        .unwrap_or_else(|_| "\"\"".to_string()),
                );
                let _ = webview.eval(&meta_script);
            }
        })
        // on_new_window: 拦截 target="_blank" 链接，在当前 webview 中导航
        .on_new_window(move |new_url, _features| {
            let url_str = new_url.to_string();
            let payload = serde_json::json!({ "label": &label_new_window, "url": &url_str });
            // 通过 emit 告知前端在当前 webview 中导航
            // 前端监听此事件后调用 browser_navigate
            let _ = app.emit(EVENT_BROWSER_OPEN_URL, payload);
            tauri::webview::NewWindowResponse::Deny
        });

    window
        .add_child(
            builder,
            tauri::LogicalPosition::new(x, y),
            tauri::LogicalSize::new(width, height),
        )
        .map_err(|e| AppError::Unknown(format!("Failed to create browser webview: {}", e)))?;

    Ok(label)
}

/// 导航到新 URL
#[tauri::command]
pub async fn browser_navigate(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::app_state::AppStateWrapper>,
    label: String,
    url: String,
) -> Result<(), AppError> {
    let allowed_root = resolve_allowed_file_root(&state, &label);
    validate_url_scheme(&url, allowed_root.as_deref())?;

    let webview = app
        .get_webview(&label)
        .ok_or_else(|| AppError::NotFound(format!("Browser webview not found: {}", label)))?;

    let parsed_url: Url = url
        .trim()
        .parse()
        .map_err(|e: url::ParseError| AppError::InvalidInput(format!("Invalid URL: {}", e)))?;

    webview
        .navigate(parsed_url)
        .map_err(|e| AppError::Unknown(format!("Failed to navigate: {}", e)))?;

    Ok(())
}

/// 更新浏览器 webview 的位置和大小
#[tauri::command]
pub async fn browser_set_bounds(
    app: tauri::AppHandle,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), AppError> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| AppError::NotFound(format!("Browser webview not found: {}", label)))?;

    webview
        .set_position(tauri::LogicalPosition::new(x, y))
        .map_err(|e| AppError::Unknown(format!("Failed to set position: {}", e)))?;

    webview
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|e| AppError::Unknown(format!("Failed to set size: {}", e)))?;

    Ok(())
}

/// 打开 DevTools
///
/// 打开后立即将页面缩放重置为 100%——部分平台(如 WebKitGTK 附着式
/// Inspector、WebView2 窗口切换)打开 DevTools 会改变 webview 缩放,
/// 这里兜底恢复,避免"打开后页面放大且无法恢复"。
#[tauri::command]
pub async fn browser_open_devtools(app: tauri::AppHandle, label: String) -> Result<(), AppError> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| AppError::NotFound(format!("Browser webview not found: {}", label)))?;

    #[cfg(debug_assertions)]
    webview.open_devtools();

    // 兜底:重置缩放为 100%(set_zoom 失败不影响 DevTools 打开)
    let _ = webview.set_zoom(1.0);

    Ok(())
}

/// 重置浏览器 webview 页面缩放为 100%(恢复被 DevTools/误操作放大的页面)
#[tauri::command]
pub async fn browser_reset_zoom(app: tauri::AppHandle, label: String) -> Result<(), AppError> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| AppError::NotFound(format!("Browser webview not found: {}", label)))?;

    webview
        .set_zoom(1.0)
        .map_err(|e| AppError::Unknown(format!("Failed to reset zoom: {}", e)))?;

    Ok(())
}

/// 关闭/销毁浏览器 webview
#[tauri::command]
pub async fn browser_close(app: tauri::AppHandle, label: String) -> Result<(), AppError> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| AppError::NotFound(format!("Browser webview not found: {}", label)))?;

    webview
        .close()
        .map_err(|e| AppError::Unknown(format!("Failed to close webview: {}", e)))?;

    Ok(())
}

/// 显示/隐藏浏览器 webview
#[tauri::command]
pub async fn browser_set_visible(
    app: tauri::AppHandle,
    label: String,
    visible: bool,
) -> Result<(), AppError> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| AppError::NotFound(format!("Browser webview not found: {}", label)))?;

    if visible {
        webview
            .show()
            .map_err(|e| AppError::Unknown(format!("Failed to show webview: {}", e)))?;
    } else {
        webview
            .hide()
            .map_err(|e| AppError::Unknown(format!("Failed to hide webview: {}", e)))?;
    }

    Ok(())
}

/// 后退
#[tauri::command]
pub async fn browser_go_back(app: tauri::AppHandle, label: String) -> Result<(), AppError> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| AppError::NotFound(format!("Browser webview not found: {}", label)))?;

    webview
        .eval("window.history.back()")
        .map_err(|e| AppError::Unknown(format!("Failed to go back: {}", e)))?;

    Ok(())
}

/// 前进
#[tauri::command]
pub async fn browser_go_forward(app: tauri::AppHandle, label: String) -> Result<(), AppError> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| AppError::NotFound(format!("Browser webview not found: {}", label)))?;

    webview
        .eval("window.history.forward()")
        .map_err(|e| AppError::Unknown(format!("Failed to go forward: {}", e)))?;

    Ok(())
}

/// 用系统默认浏览器打开 URL
///
/// 使用 `open` crate(`shellexecute-on-windows` feature):Windows 走
/// ShellExecuteExW(不经 `cmd` 解释,消除 shell 注入面),macOS 调 `open`,
/// Linux 调 `xdg-open`;`that_detached` 不阻塞调用方。
#[tauri::command]
pub fn open_in_default_browser(url: String) -> Result<(), AppError> {
    validate_url_scheme(&url, None)?;
    open::that_detached(url).map_err(|e| AppError::Io(format!("Failed to open URL: {e}")))?;
    Ok(())
}

/// Element picker injection script.
/// Phase 1: highlight + tooltip on hover, click to select.
/// Phase 2: inline prompt textarea appears next to selected element.
///          Enter submits, Shift/Ctrl/Alt+Enter inserts newline, ESC / ✕ / click-outside cancels.
/// Theme colours are read from `window.__NEEKO_THEME__` (set before injection) with dark fallbacks.
/// 脚本本体见同目录 `picker_script.js`(include_str! 引入)。
const PICKER_SCRIPT: &str = include_str!("picker_script.js");

/// 启动元素选择器：注入高亮 + tooltip + 点击捕获脚本
/// `theme_colors` is an optional map of CSS variable values injected as
/// `window.__NEEKO_THEME__` so the picker UI follows the application theme.
#[tauri::command]
pub async fn browser_start_picker(
    app: tauri::AppHandle,
    label: String,
    theme_colors: Option<std::collections::HashMap<String, String>>,
) -> Result<(), AppError> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| AppError::NotFound(format!("Browser webview not found: {}", label)))?;

    let theme_json = serde_json::to_string(&theme_colors.unwrap_or_default())
        .unwrap_or_else(|_| "{}".to_string());
    let notify_base_json = serde_json::to_string(NOTIFY_BASE)
        .map_err(|e| AppError::Unknown(format!("Failed to serialize NOTIFY_BASE: {}", e)))?;
    let script = format!(
        "window.__NEEKO_THEME__ = {};\nwindow.__NEEKO_NOTIFY_BASE__ = {};\n{}",
        theme_json, notify_base_json, PICKER_SCRIPT
    );

    webview
        .eval(&script)
        .map_err(|e| AppError::Unknown(format!("Failed to inject picker script: {}", e)))?;

    Ok(())
}

/// 停止元素选择器
#[tauri::command]
pub async fn browser_stop_picker(app: tauri::AppHandle, label: String) -> Result<(), AppError> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| AppError::NotFound(format!("Browser webview not found: {}", label)))?;

    webview
        .eval("window.__NEEKO_PICKER__ && window.__NEEKO_PICKER__.stop()")
        .map_err(|e| AppError::Unknown(format!("Failed to stop picker: {}", e)))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_validate_url_scheme_http() {
        assert!(validate_url_scheme("http://localhost:3000", None).is_ok());
    }

    #[test]
    fn test_validate_url_scheme_https() {
        assert!(validate_url_scheme("https://github.com", None).is_ok());
    }

    #[test]
    fn test_validate_url_scheme_ftp_rejected() {
        let result = validate_url_scheme("ftp://example.com", None);
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::InvalidInput(_) => {} // expected
            other => panic!("Expected InvalidInput error, got: {:?}", other),
        }
    }

    #[test]
    fn test_validate_url_scheme_file_without_root_rejected() {
        // 无白名单根时 file:// 一律拒绝(防御)
        let result = validate_url_scheme("file:///tmp/a.html", None);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_url_scheme_file_allowed_inside_root() {
        let root = tempfile::tempdir().unwrap();
        let inner = root.path().join("sub");
        std::fs::create_dir_all(&inner).unwrap();
        let file_path = inner.join("test.html");
        std::fs::write(&file_path, "<html></html>").unwrap();

        let file_url = format!("file://{}", file_path.display());
        let result = validate_url_scheme(&file_url, Some(root.path()));
        assert!(
            result.is_ok(),
            "in-allowlist file:// should pass: {:?}",
            result
        );
    }

    #[test]
    fn test_validate_url_scheme_file_outside_root_rejected() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let file_path = outside.path().join("secret.txt");
        std::fs::write(&file_path, "secret").unwrap();

        let file_url = format!("file://{}", file_path.display());
        let result = validate_url_scheme(&file_url, Some(root.path()));
        assert!(result.is_err(), "out-of-allowlist file:// must be rejected");
    }

    #[test]
    fn test_validate_url_scheme_file_traversal_rejected() {
        let root = tempfile::tempdir().unwrap();
        // 构造一个白名单内不存在的穿越路径:root/../secret.txt
        let traversal = root.path().join("..").join("..").join("etc").join("passwd");
        let file_url = format!("file://{}", traversal.display());
        // canonicalize 对不存在路径失败 → 拒绝
        let result = validate_url_scheme(&file_url, Some(root.path()));
        assert!(result.is_err(), "traversal file:// must be rejected");
    }

    #[test]
    fn test_validate_url_scheme_javascript_rejected() {
        let result = validate_url_scheme("javascript:alert(1)", None);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_url_scheme_empty() {
        let result = validate_url_scheme("", None);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_url_scheme_with_whitespace() {
        assert!(validate_url_scheme("  https://example.com  ", None).is_ok());
    }

    #[test]
    fn test_validate_file_url_normalizes_query_fragment() {
        // 带查询串/锚点的 file URL 仍解析为路径并校验
        let root = tempfile::tempdir().unwrap();
        let file_path = root.path().join("page.html");
        std::fs::write(&file_path, "<html></html>").unwrap();
        let file_url = format!("file://{}?x=1#top", file_path.display());
        let result = validate_url_scheme(&file_url, Some(root.path()));
        assert!(result.is_ok());
    }

    #[test]
    fn test_resolve_allowed_file_root_from_label() {
        // 非浏览器 label 或未知项目 → None(不 panic)
        assert!(resolve_allowed_file_root(
            &crate::app_state::AppStateWrapper::default(),
            "neeko-browser-unknown"
        )
        .is_none());
        assert!(resolve_allowed_file_root(
            &crate::app_state::AppStateWrapper::default(),
            "other-label"
        )
        .is_none());
    }

    #[test]
    fn test_file_path_helpers() {
        // fileUrlToFilePath 对应逻辑在 TS 侧;此处验证 Rust 侧路径拼接假设
        assert!(Path::new("/tmp").is_absolute());
    }

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
}
