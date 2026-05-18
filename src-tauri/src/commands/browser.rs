use crate::utils::command::local;
use crate::AppError;
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

    // 克隆 app handle 给 handler 内使用
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
        local::exec("cmd")
            .args(["/c", "start", "", &url])
            .spawn()
            .map_err(|e| AppError::Io(format!("Failed to open URL: {}", e)))?;
    }

    #[cfg(target_os = "macos")]
    {
        local::exec("open")
            .arg(&url)
            .spawn()
            .map_err(|e| AppError::Io(format!("Failed to open URL: {}", e)))?;
    }

    #[cfg(target_os = "linux")]
    {
        local::exec("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| AppError::Io(format!("Failed to open URL: {}", e)))?;
    }

    Ok(())
}

/// Element picker injection script.
/// Phase 1: highlight + tooltip on hover, click to select.
/// Phase 2: inline prompt textarea appears next to selected element.
///          Enter submits, Shift/Ctrl/Alt+Enter inserts newline, ESC / ✕ / click-outside cancels.
/// Theme colours are read from `window.__NEEKO_THEME__` (set before injection) with dark fallbacks.
const PICKER_SCRIPT: &str = r#"
(function() {
  if (window.__NEEKO_PICKER__) return;

  /* ---- theme ---- */
  var T = window.__NEEKO_THEME__ || {};
  var C = {
    bg:      T.bgSecondary  || 'rgba(24,24,27,.92)',
    bgHover: T.bgTertiary   || '#2d2e32',
    text:    T.textPrimary  || '#fff',
    muted:   T.textMuted    || '#666',
    border:  T.borderColor  || 'rgba(255,255,255,.15)',
    accent:  T.accentBlue   || '#61afef'
  };

  var oldTarget = null;
  var oldOutline = '';
  var oldCursor = '';
  var tooltip = null;
  var codeStyle = null;
  var promptBar = null;
  var outsideListener = null;
  var skipNextClick = false;

  function notify(path) {
    try { var i = new Image(); i.src = 'http://neeko.localhost/' + path; } catch(ex) {}
  }

  function createTooltip() {
    var el = document.createElement('div');
    el.style.cssText = 'position:fixed;z-index:2147483647;background:' + C.bg + ';color:' + C.text + ';padding:2px 8px;border-radius:3px;font:12px/1.6 system-ui,-apple-system,sans-serif;pointer-events:none;white-space:nowrap;max-width:50vw;overflow:hidden;text-overflow:ellipsis;border:1px solid ' + C.border;
    document.documentElement.appendChild(el);
    return el;
  }

  function getCodeStyle() {
    var s = document.createElement('span');
    s.style.cssText = 'color:' + C.muted + ';margin-left:4px';
    return s;
  }

  function getSelector(el) {
    var s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    if (el.className && typeof el.className === 'string') s += '.' + el.className.trim().split(/\s+/).join('.');
    return s;
  }

  function getSize(el) {
    var r = el.getBoundingClientRect();
    return Math.round(r.width) + '\u00d7' + Math.round(r.height);
  }

  function onMove(e) {
    var t = e.target;
    if (!t || t === document.documentElement || t === document.body) return;
    if (t === tooltip || (tooltip && tooltip.contains(t))) return;
    if (oldTarget) { oldTarget.style.outline = oldOutline; }
    oldTarget = t;
    oldOutline = t.style.outline;
    t.style.outline = '2px solid ' + C.accent;
    tooltip.textContent = getSelector(t);
    if (!codeStyle) codeStyle = getCodeStyle();
    codeStyle.textContent = getSize(t);
    if (!tooltip.contains(codeStyle)) tooltip.appendChild(codeStyle);
    var r = tooltip.getBoundingClientRect();
    var x = e.clientX + 12;
    var y = e.clientY + 16;
    if (x + r.width > window.innerWidth) x = window.innerWidth - r.width - 4;
    if (y + r.height > window.innerHeight) y = e.clientY - r.height - 8;
    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
  }

  function cleanupPicker() {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onPickerKey, true);
    if (oldTarget) { oldTarget.style.outline = oldOutline; }
    if (tooltip) tooltip.remove();
    document.body.style.cursor = oldCursor;
  }

  function removeOutsideListener() {
    if (outsideListener) {
      document.removeEventListener('mousedown', outsideListener, true);
      outsideListener = null;
    }
  }

  function cleanupPrompt() {
    removeOutsideListener();
    if (promptBar) { promptBar.remove(); promptBar = null; }
  }

  function cleanupAll() {
    cleanupPicker();
    cleanupPrompt();
    window.__NEEKO_PICKER__ = null;
  }

  function cancelAndNotify() {
    cleanupAll();
    notify('picker-cancelled');
  }

  /** Re-enter Phase 1 (crosshair + hover highlight + click to select).
   *  skipNextClick prevents the click that dismissed the prompt (via
   *  mousedown-outside) from immediately selecting a new element. */
  function startPicker() {
    if (oldTarget) { oldTarget.style.outline = oldOutline; oldTarget = null; }
    oldCursor = document.body.style.cursor;
    document.body.style.cursor = 'crosshair';
    tooltip = createTooltip();
    codeStyle = null;
    skipNextClick = true;
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onPickerKey, true);
  }

  /* ---- Phase 2: inline prompt textarea ---- */

  function showPromptInput(html, cx, cy) {
    var W = 450;
    var LINE_H = 20;
    var MAX_LINES = 5;

    var bar = document.createElement('div');
    bar.style.cssText = 'all:initial;position:fixed;z-index:2147483647;display:flex;align-items:flex-start;gap:6px;padding:6px 10px;border-radius:8px;border:1px solid ' + C.border + ';background:' + C.bg + ';backdrop-filter:blur(8px);box-shadow:0 4px 24px rgba(0,0,0,.4);font:13px/1.4 system-ui,-apple-system,sans-serif;color:' + C.text + ';width:' + W + 'px;box-sizing:border-box';

    var x = cx + 8;
    var y = cy + 20;
    if (x + W > window.innerWidth) x = window.innerWidth - W - 8;
    if (x < 8) x = 8;
    if (y + 40 > window.innerHeight) y = cy - 52;
    if (y < 8) y = 8;
    bar.style.left = x + 'px';
    bar.style.top = y + 'px';

    var label = document.createElement('span');
    label.textContent = 'AI';
    label.style.cssText = 'all:initial;color:' + C.accent + ';font:600 12px/20px system-ui,-apple-system,sans-serif;flex-shrink:0;user-select:none';

    var ta = document.createElement('textarea');
    ta.placeholder = 'describe how to modify this element...';
    ta.rows = 1;
    ta.style.cssText = 'all:initial;flex:1;background:transparent;border:none;outline:none;color:' + C.text + ';font:13px/1.4 system-ui,-apple-system,sans-serif;min-width:0;resize:none;overflow:hidden;height:' + LINE_H + 'px;max-height:' + (LINE_H * MAX_LINES) + 'px;display:block';

    function autoGrow() {
      ta.style.height = 'auto';
      var h = Math.min(ta.scrollHeight, LINE_H * MAX_LINES);
      ta.style.height = h + 'px';
      if (ta.scrollHeight > LINE_H * MAX_LINES) {
        ta.style.overflowY = 'auto';
      } else {
        ta.style.overflowY = 'hidden';
      }
    }
    ta.addEventListener('input', autoGrow);

    var closeBtn = document.createElement('span');
    closeBtn.textContent = '\u2715';
    closeBtn.style.cssText = 'all:initial;color:' + C.muted + ';cursor:pointer;font:14px/20px system-ui;flex-shrink:0;padding:0 2px;user-select:none';
    closeBtn.onmouseover = function() { closeBtn.style.color = C.text; };
    closeBtn.onmouseout  = function() { closeBtn.style.color = C.muted; };
    closeBtn.onclick = function(e) { e.preventDefault(); e.stopPropagation(); cancelAndNotify(); };

    bar.appendChild(label);
    bar.appendChild(ta);
    bar.appendChild(closeBtn);
    document.documentElement.appendChild(bar);
    promptBar = bar;

    setTimeout(function() { ta.focus(); }, 0);

    ta.addEventListener('keydown', function(e) {
      e.stopPropagation();
      if (e.key === 'Enter') {
        if (e.shiftKey || e.ctrlKey || e.altKey) {
          /* allow newline — browser default inserts \n in textarea */
          setTimeout(autoGrow, 0);
          return;
        }
        e.preventDefault();
        var prompt = ta.value.trim();
        if (!prompt) return;
        notify('prompt-submitted?prompt=' + encodeURIComponent(prompt) + '&html=' + encodeURIComponent(html));
        cleanupPrompt();
        startPicker();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelAndNotify();
      }
    }, true);

    /* Prevent clicks inside bar from propagating (bubbling phase so child
       elements like closeBtn still receive their own click events first) */
    bar.addEventListener('click', function(e) { e.stopPropagation(); });
    bar.addEventListener('mousedown', function(e) { e.stopPropagation(); });

    /* Click outside: close prompt input and return to element selection */
    setTimeout(function() {
      outsideListener = function(e) {
        if (promptBar && !promptBar.contains(e.target)) {
          cleanupPrompt();
          startPicker();
        }
      };
      document.addEventListener('mousedown', outsideListener, true);
    }, 50);
  }

  /* ---- Phase 1: hover + click ---- */

  function onClick(e) {
    if (skipNextClick) { skipNextClick = false; return; }
    e.preventDefault();
    e.stopPropagation();
    var el = e.target;
    var html = el.outerHTML;
    cleanupPicker();
    notify('element-picked?html=' + encodeURIComponent(html));
    showPromptInput(html, e.clientX, e.clientY);
    return false;
  }

  function onPickerKey(e) { if (e.key === 'Escape') cancelAndNotify(); }

  oldCursor = document.body.style.cursor;
  document.body.style.cursor = 'crosshair';
  tooltip = createTooltip();
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onPickerKey, true);
  window.__NEEKO_PICKER__ = { stop: cleanupAll };
})();
"#;

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
    let script = format!(
        "window.__NEEKO_THEME__ = {};\n{}",
        theme_json, PICKER_SCRIPT
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
