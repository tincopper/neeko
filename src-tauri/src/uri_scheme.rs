//! Neeko 自定义 URI Scheme (`neeko://`) 协议处理器。
//!
//! 处理三类请求：
//! - `prompt-submitted` — 用户提交 prompt + 选中元素 HTML
//! - `picker-cancelled` — 用户取消元素选取
//! - `element-picked`   — 元素选中，复制 outerHTML 到剪贴板

use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::Emitter;

/// 去重窗口（毫秒）。WebView2 在 Windows 上可能对同一次 img.src 赋值
/// 触发两次协议回调，此窗口用于抑制重复事件。
const DEDUP_WINDOW_MS: u128 = 500;

/// 创建 `neeko://` 协议处理闭包，供 `register_uri_scheme_protocol` 使用。
///
/// 返回的闭包满足 `Fn(UriSchemeContext, Request) -> Response + Send + Sync + 'static`。
pub fn create_handler() -> impl Fn(
    tauri::UriSchemeContext<'_, tauri::Wry>,
    tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>>
       + Send
       + Sync
       + 'static
{
    let last_prompt_emit: Arc<Mutex<Option<Instant>>> = Arc::new(Mutex::new(None));

    move |ctx, request| {
        let uri = request.uri().to_string();
        let query = uri.split('?').nth(1).unwrap_or("");

        if uri.contains("prompt-submitted") {
            handle_prompt_submitted(&ctx, query, &last_prompt_emit);
        } else if uri.contains("picker-cancelled") {
            let _ = ctx.app_handle().emit("browser://picker-cancelled", ());
        } else if uri.contains("element-picked") {
            handle_element_picked(query);
        }

        tauri::http::Response::builder()
            .status(200)
            .header("Access-Control-Allow-Origin", "*")
            .body(Vec::<u8>::new())
            .unwrap()
    }
}

/// 处理 prompt-submitted 请求：解析参数并去重发射事件。
fn handle_prompt_submitted(
    ctx: &tauri::UriSchemeContext<'_, tauri::Wry>,
    query: &str,
    last_prompt_emit: &Arc<Mutex<Option<Instant>>>,
) {
    if let Some((prompt, html)) = parse_prompt_submitted_query(query) {
        let should_emit = {
            let mut last = last_prompt_emit.lock().unwrap();
            let now = Instant::now();
            let emit = last
                .map(|t| now.duration_since(t).as_millis() >= DEDUP_WINDOW_MS)
                .unwrap_or(true);
            if emit {
                *last = Some(now);
            }
            emit
        };

        if should_emit {
            let payload = serde_json::json!({ "prompt": prompt, "html": html });
            let _ = ctx
                .app_handle()
                .emit("browser://prompt-submitted", payload);
        }
    } else {
        log::warn!("[neeko://] prompt-submitted parse failed");
    }
}

/// 处理 element-picked 请求：解析 HTML 并复制到剪贴板。
fn handle_element_picked(query: &str) {
    if let Some(html) = parse_element_picked_query(query) {
        if let Ok(mut cb) = arboard::Clipboard::new() {
            if let Err(e) = cb.set_text(&html) {
                log::warn!("[Picker] clipboard write failed: {e}");
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 查询字符串解析
// ---------------------------------------------------------------------------

/// 解析 element-picked 查询字符串，提取 HTML 内容。
///
/// 期望格式：`html=<url-encoded-html>`
/// 若 `html` 参数缺失或为空则返回 `None`。
fn parse_element_picked_query(query: &str) -> Option<String> {
    for pair in query.split('&') {
        if let Some(val) = pair.strip_prefix("html=") {
            let decoded = urlencoding::decode(val).unwrap_or_default().to_string();
            if !decoded.is_empty() {
                return Some(decoded);
            }
        }
    }
    None
}

/// 解析 prompt-submitted 查询字符串，提取 (prompt, html)。
///
/// 期望格式：`prompt=<url-encoded>&html=<url-encoded>`
/// 任一参数缺失或为空则返回 `None`。
fn parse_prompt_submitted_query(query: &str) -> Option<(String, String)> {
    let mut prompt = String::new();
    let mut html = String::new();
    for pair in query.split('&') {
        if let Some(val) = pair.strip_prefix("prompt=") {
            prompt = urlencoding::decode(val).unwrap_or_default().to_string();
        } else if let Some(val) = pair.strip_prefix("html=") {
            html = urlencoding::decode(val).unwrap_or_default().to_string();
        }
    }
    if prompt.is_empty() || html.is_empty() {
        None
    } else {
        Some((prompt, html))
    }
}

// ---------------------------------------------------------------------------
// 单元测试
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // --- parse_element_picked_query ---

    #[test]
    fn test_parse_element_picked_query_basic() {
        let q = "html=%3Cdiv%3Ehello%3C%2Fdiv%3E";
        assert_eq!(parse_element_picked_query(q).unwrap(), "<div>hello</div>");
    }

    #[test]
    fn test_parse_element_picked_query_missing_html() {
        assert!(parse_element_picked_query("foo=bar").is_none());
    }

    #[test]
    fn test_parse_element_picked_query_empty_html() {
        assert!(parse_element_picked_query("html=").is_none());
    }

    #[test]
    fn test_parse_element_picked_query_html_with_attributes() {
        let q = "html=%3Cbutton%20class%3D%22btn-primary%22%3ESubmit%3C%2Fbutton%3E";
        assert_eq!(
            parse_element_picked_query(q).unwrap(),
            r#"<button class="btn-primary">Submit</button>"#
        );
    }

    // --- parse_prompt_submitted_query ---

    #[test]
    fn test_parse_prompt_submitted_basic() {
        let q = "prompt=make%20it%20red&html=%3Cdiv%3E%3C%2Fdiv%3E";
        let (prompt, html) = parse_prompt_submitted_query(q).unwrap();
        assert_eq!(prompt, "make it red");
        assert_eq!(html, "<div></div>");
    }

    #[test]
    fn test_parse_prompt_submitted_missing_prompt() {
        let q = "html=%3Cdiv%3E%3C%2Fdiv%3E";
        assert!(parse_prompt_submitted_query(q).is_none());
    }

    #[test]
    fn test_parse_prompt_submitted_missing_html() {
        let q = "prompt=hello";
        assert!(parse_prompt_submitted_query(q).is_none());
    }

    #[test]
    fn test_parse_prompt_submitted_empty_prompt() {
        let q = "prompt=&html=%3Cdiv%3E%3C%2Fdiv%3E";
        assert!(parse_prompt_submitted_query(q).is_none());
    }

    #[test]
    fn test_parse_prompt_submitted_special_chars() {
        let q = "prompt=%E6%8A%8A%E6%8C%89%E9%92%AE%E6%94%B9%E6%88%90%E7%BA%A2%E8%89%B2&html=%3Cbutton%3EHi%3C%2Fbutton%3E";
        let (prompt, html) = parse_prompt_submitted_query(q).unwrap();
        assert_eq!(prompt, "把按钮改成红色");
        assert_eq!(html, "<button>Hi</button>");
    }
}
