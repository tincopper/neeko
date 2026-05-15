use crate::AppError;
use std::process::Command;
use tauri::webview::{PageLoadEvent, WebviewBuilder};
use tauri::{Emitter, Manager, WebviewUrl};
use url::Url;

/// 固定的浏览器 webview label（单实例）
const BROWSER_LABEL: &str = "neeko-browser-panel";

/// 校验 URL scheme 是否安全（允许 http/https/file）
fn validate_url_scheme(url: &str) -> Result<(), AppError> {
    let trimmed = url.trim();
    if trimmed.starts_with("http://")
        || trimmed.starts_with("https://")
        || trimmed.starts_with("file://")
    {
        Ok(())
    } else {
        Err(AppError::InvalidInput(format!(
            "URL scheme not allowed (only http/https/file): {}",
            trimmed
        )))
    }
}

/// 创建内嵌浏览器 webview（Rust 侧真实创建，支持事件通知）
/// 返回 webview label
#[tauri::command]
pub async fn create_browser_webview(
    app: tauri::AppHandle,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<String, AppError> {
    validate_url_scheme(&url)?;

    let parsed_url: Url = url
        .trim()
        .parse()
        .map_err(|e: url::ParseError| AppError::InvalidInput(format!("Invalid URL: {}", e)))?;

    // 如果已经存在同 label 的 webview，先关闭
    if let Some(existing) = app.get_webview(BROWSER_LABEL) {
        let _ = existing.close();
        // 短暂等待关闭完成
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }

    let window = app
        .get_window("main")
        .ok_or_else(|| AppError::NotFound("Main window not found".into()))?;

    let tauri_url = WebviewUrl::External(parsed_url);

    // 克隆 app handle 供 handler 内使用
    let app_nav = app.clone();
    let app_load = app.clone();

    let builder = WebviewBuilder::new(BROWSER_LABEL, tauri_url)
        // on_navigation: 每次导航开始时通知前端新 URL（允许所有导航）
        .on_navigation(move |nav_url| {
            let url_str = nav_url.to_string();
            let _ = app_nav.emit("browser://url-changed", url_str);
            true // 允许跳转
        })
        // on_page_load: 页面加载开始/完成时通知前端
        .on_page_load(move |_webview, payload| match payload.event() {
            PageLoadEvent::Started => {
                let _ = app_load.emit("browser://loading", true);
            }
            PageLoadEvent::Finished => {
                let url_str = payload.url().to_string();
                let _ = app_load.emit("browser://page-loaded", url_str);
                let _ = app_load.emit("browser://loading", false);
            }
        })
        // on_new_window: 拦截 target="_blank" 链接，在当前 webview 中导航
        .on_new_window(move |new_url, _features| {
            let url_str = new_url.to_string();
            // 通过 emit 告知前端在当前 webview 中导航
            // 前端监听此事件后调用 browser_navigate
            let _ = app.emit("browser://open-url", url_str);
            tauri::webview::NewWindowResponse::Deny
        });

    window
        .add_child(
            builder,
            tauri::LogicalPosition::new(x, y),
            tauri::LogicalSize::new(width, height),
        )
        .map_err(|e| AppError::Unknown(format!("Failed to create browser webview: {}", e)))?;

    Ok(BROWSER_LABEL.to_string())
}

/// 导航到新 URL
#[tauri::command]
pub async fn browser_navigate(
    app: tauri::AppHandle,
    label: String,
    url: String,
) -> Result<(), AppError> {
    validate_url_scheme(&url)?;

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
#[tauri::command]
pub async fn browser_open_devtools(app: tauri::AppHandle, label: String) -> Result<(), AppError> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| AppError::NotFound(format!("Browser webview not found: {}", label)))?;

    #[cfg(debug_assertions)]
    webview.open_devtools();

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
#[tauri::command]
pub fn open_in_default_browser(url: String) -> Result<(), AppError> {
    validate_url_scheme(&url)?;

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/c", "start", "", &url])
            .spawn()
            .map_err(|e| AppError::Io(format!("Failed to open URL: {}", e)))?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| AppError::Io(format!("Failed to open URL: {}", e)))?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| AppError::Io(format!("Failed to open URL: {}", e)))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_url_scheme_http() {
        assert!(validate_url_scheme("http://localhost:3000").is_ok());
    }

    #[test]
    fn test_validate_url_scheme_https() {
        assert!(validate_url_scheme("https://github.com").is_ok());
    }

    #[test]
    fn test_validate_url_scheme_ftp_rejected() {
        let result = validate_url_scheme("ftp://example.com");
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::InvalidInput(_) => {} // expected
            other => panic!("Expected InvalidInput error, got: {:?}", other),
        }
    }

    #[test]
    fn test_validate_url_scheme_file_allowed() {
        let result = validate_url_scheme("file:///C:/test.html");
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_url_scheme_javascript_rejected() {
        let result = validate_url_scheme("javascript:alert(1)");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_url_scheme_empty() {
        let result = validate_url_scheme("");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_url_scheme_with_whitespace() {
        assert!(validate_url_scheme("  https://example.com  ").is_ok());
    }

    #[test]
    fn test_browser_label_is_fixed() {
        assert_eq!(BROWSER_LABEL, "neeko-browser-panel");
    }
}
