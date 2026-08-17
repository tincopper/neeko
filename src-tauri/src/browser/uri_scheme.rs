//! Neeko 自定义 URI Scheme (`neeko://`) 协议处理器。
//!
//! 处理三类请求：
//! - `prompt-submitted` — 用户提交 prompt + 选中元素 HTML
//! - `picker-cancelled` — 用户取消元素选取
//! - `element-picked`   — 元素选中，复制 outerHTML 到剪贴板
//!
//! 传输机制：
//! - **POST body(主通道)**:页面 `fetch(base + type, { method: 'POST', body: JSON })`,
//!   大体积 HTML 随请求体传输,不受 URL 长度限制。
//! - **GET 查询字符串(兼容旧通道)**:保留 `img.src = base + path` 形态,
//!   仅用于无需大体积数据的通知。

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::Emitter;

use super::events::{
    EVENT_BROWSER_PAGE_META, EVENT_BROWSER_PICKER_CANCELLED, EVENT_BROWSER_PROMPT_SUBMITTED,
};

/// 去重窗口（毫秒）。WebView2 在 Windows 上可能对同一次 img.src 赋值
/// 触发两次协议回调，此窗口用于抑制重复事件。
const DEDUP_WINDOW_MS: u128 = 500;

/// 旧 GET 通道无 label，使用统一哨兵键（退化回全局窗口）。
const LEGACY_PROMPT_KEY: &str = "__legacy__";

/// 按 label 判断本次 prompt 提交是否应发射（去重窗口按 webview 隔离，
/// 避免多 tab 快速提交时第二个被全局窗口误抑制）。
fn should_emit_prompt(map: &Mutex<HashMap<String, Instant>>, key: &str) -> bool {
    let mut map = map
        .lock()
        .expect("infallible: prompt dedup lock should not be poisoned");
    let now = Instant::now();
    let emit = map
        .get(key)
        .map(|t| now.duration_since(*t).as_millis() >= DEDUP_WINDOW_MS)
        .unwrap_or(true);
    if emit {
        map.insert(key.to_string(), now);
    }
    emit
}

/// 页面经自定义协议回传的 picker 消息。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PickerMessage {
    /// 用户提交修改 prompt + 一组选中元素（单选长度 1，多选长度 N）。
    PromptSubmitted {
        /// 用户输入的修改要求。
        prompt: String,
        /// 选中的元素（含 outerHTML 与简写 selector）。
        elements: Vec<PickerElement>,
        /// 提交方 webview 的 label（区分多项目/多 tab）；旧版注入脚本无此字段。
        label: Option<String>,
    },
    /// 用户取消元素选取。
    PickerCancelled,
    /// 元素选中(写入剪贴板)。
    ElementPicked {
        /// 选中元素的 outerHTML。
        html: String,
    },
}

/// 单个被选中元素。`selector` 由注入脚本生成（如 `button#navCta`），
/// 多选时按选择顺序排列。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct PickerElement {
    /// 选中元素的 outerHTML。
    pub html: String,
    /// 简写 selector（tag + #id + 前两个 class）。
    pub selector: String,
}

/// 解析 `elements` JSON 数组。
///
/// 期望格式：`[{ "html": "...", "selector": "..." }, ...]`。
/// 数组缺失 / 为空 / 任一元素缺 `html` 均返回 `None`；`selector` 可缺省（空串）。
fn parse_elements(value: &serde_json::Value) -> Option<Vec<PickerElement>> {
    let arr = value.as_array()?;
    if arr.is_empty() {
        return None;
    }
    let mut out = Vec::with_capacity(arr.len());
    for item in arr {
        let html = item.get("html")?.as_str()?.to_string();
        let selector = item
            .get("selector")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        out.push(PickerElement { html, selector });
    }
    Some(out)
}

/// 解析 picker POST body(JSON)。
///
/// 期望格式：`{ "type": "prompt-submitted"|"picker-cancelled"|"element-picked", ... }`。
/// 任一必需字段缺失或类型不符则返回 `None`。
#[must_use]
pub fn parse_picker_payload(body: &[u8]) -> Option<PickerMessage> {
    let value: serde_json::Value = serde_json::from_slice(body).ok()?;
    let kind = value.get("type")?.as_str()?;
    match kind {
        "prompt-submitted" => Some(PickerMessage::PromptSubmitted {
            prompt: value.get("prompt")?.as_str()?.to_string(),
            elements: parse_elements(value.get("elements")?)?,
            label: value
                .get("label")
                .and_then(|v| v.as_str())
                .map(str::to_string),
        }),
        "picker-cancelled" => Some(PickerMessage::PickerCancelled),
        "element-picked" => Some(PickerMessage::ElementPicked {
            html: value.get("html")?.as_str()?.to_string(),
        }),
        _ => None,
    }
}

/// 解析页面元信息 POST body(标题/favicon)。
///
/// 期望格式：`{ "label": "...", "title": "...", "favicon": "..." }`。
/// label 缺失则返回 `None`(title/favicon 可空)。
#[must_use]
pub fn parse_page_meta(body: &[u8]) -> Option<(String, String, String)> {
    let value: serde_json::Value = serde_json::from_slice(body).ok()?;
    let label = value.get("label")?.as_str()?.to_string();
    let title = value
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let favicon = value
        .get("favicon")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    Some((label, title, favicon))
}

/// 创建 `neeko://` 协议处理闭包，供 `register_uri_scheme_protocol` 使用。
///
/// 返回的闭包满足 `Fn(UriSchemeContext, Request) -> Response + Send + Sync + 'static`。
pub fn create_handler() -> impl Fn(
    tauri::UriSchemeContext<'_, tauri::Wry>,
    tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>>
       + Send
       + Sync
       + 'static {
    let last_prompt_emit: Arc<Mutex<HashMap<String, Instant>>> =
        Arc::new(Mutex::new(HashMap::new()));

    move |ctx, request| {
        let method = request.method().to_string();
        let uri = request.uri().to_string();

        // CORS preflight(fetch POST + JSON 需预检)
        if method == "OPTIONS" {
            return tauri::http::Response::builder()
                .status(204)
                .header("Access-Control-Allow-Origin", "*")
                .header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                .header("Access-Control-Allow-Headers", "content-type")
                .body(Vec::<u8>::new())
                .expect("infallible: static preflight response builder should not fail");
        }

        // POST body 主通道:大 HTML 随请求体传输,无 URL 长度限制
        if method == "POST" {
            let body = request.body().clone();
            if let Some(message) = parse_picker_payload(&body) {
                handle_picker_message(&ctx, message, &last_prompt_emit);
            } else if let Some((label, title, favicon)) = parse_page_meta(&body) {
                let payload =
                    serde_json::json!({ "label": label, "title": title, "favicon": favicon });
                let _ = ctx.app_handle().emit(EVENT_BROWSER_PAGE_META, payload);
            } else {
                log::warn!("[neeko://] picker POST body parse failed");
            }
            return tauri::http::Response::builder()
                .status(200)
                .header("Access-Control-Allow-Origin", "*")
                .body(Vec::<u8>::new())
                .expect("infallible: static response builder should not fail");
        }

        // 兼容旧 GET(img.src)通道:查询字符串传输
        let query = uri.split('?').nth(1).unwrap_or("");
        if uri.contains("prompt-submitted") {
            handle_prompt_submitted(&ctx, query, &last_prompt_emit);
        } else if uri.contains("picker-cancelled") {
            let _ = ctx.app_handle().emit(EVENT_BROWSER_PICKER_CANCELLED, ());
        } else if uri.contains("element-picked") {
            if let Some(html) = parse_element_picked_query(query) {
                handle_element_picked(&html);
            }
        }

        tauri::http::Response::builder()
            .status(200)
            .header("Access-Control-Allow-Origin", "*")
            .body(Vec::<u8>::new())
            .expect("infallible: static response builder should not fail")
    }
}

/// 分发 POST body 解析出的 picker 消息。
fn handle_picker_message(
    ctx: &tauri::UriSchemeContext<'_, tauri::Wry>,
    message: PickerMessage,
    last_prompt_emit: &Arc<Mutex<HashMap<String, Instant>>>,
) {
    match message {
        PickerMessage::PromptSubmitted {
            prompt,
            elements,
            label,
        } => {
            let key = label.as_deref().unwrap_or(LEGACY_PROMPT_KEY);
            if should_emit_prompt(last_prompt_emit, key) {
                // label 可选：旧版注入脚本无 label 字段 → 前端回退到当前项目路由
                let mut payload = serde_json::json!({ "prompt": prompt, "elements": elements });
                if let Some(label) = label {
                    payload["label"] = serde_json::Value::String(label);
                }
                let _ = ctx
                    .app_handle()
                    .emit(EVENT_BROWSER_PROMPT_SUBMITTED, payload);
            }
        }
        PickerMessage::PickerCancelled => {
            let _ = ctx.app_handle().emit(EVENT_BROWSER_PICKER_CANCELLED, ());
        }
        PickerMessage::ElementPicked { html } => handle_element_picked(&html),
    }
}

/// 处理 element-picked 请求：解析 HTML 并复制到剪贴板。
fn handle_element_picked(html: &str) {
    if html.is_empty() {
        return;
    }
    if let Ok(mut cb) = arboard::Clipboard::new() {
        if let Err(e) = cb.set_text(html) {
            log::warn!("[Picker] clipboard write failed: {e}");
        }
    }
}

// ---------------------------------------------------------------------------
// 兼容旧通道的查询字符串解析(GET img.src)
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

/// 处理 prompt-submitted 请求：解析参数并去重发射事件。
fn handle_prompt_submitted(
    ctx: &tauri::UriSchemeContext<'_, tauri::Wry>,
    query: &str,
    last_prompt_emit: &Arc<Mutex<HashMap<String, Instant>>>,
) {
    if let Some((prompt, html)) = parse_prompt_submitted_query(query) {
        // 旧 GET 通道无 label → 使用哨兵键（退化回全局去重窗口）。
        if should_emit_prompt(last_prompt_emit, LEGACY_PROMPT_KEY) {
            // 旧 GET 通道仅携带单个 html，包装为单元素数组以兼容新前端 payload。
            let element = PickerElement {
                html,
                selector: String::new(),
            };
            let payload = serde_json::json!({ "prompt": prompt, "elements": [element] });
            let _ = ctx
                .app_handle()
                .emit(EVENT_BROWSER_PROMPT_SUBMITTED, payload);
        }
    } else {
        log::warn!("[neeko://] prompt-submitted parse failed");
    }
}

// ---------------------------------------------------------------------------
// 单元测试
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // --- parse_picker_payload(POST body) ---

    #[test]
    fn test_parse_picker_payload_prompt_submitted_single() {
        let body = br#"{"type":"prompt-submitted","prompt":"make it red","elements":[{"html":"<div></div>","selector":"div"}]}"#;
        assert_eq!(
            parse_picker_payload(body),
            Some(PickerMessage::PromptSubmitted {
                prompt: "make it red".into(),
                elements: vec![PickerElement {
                    html: "<div></div>".into(),
                    selector: "div".into(),
                }],
                label: None,
            })
        );
    }

    #[test]
    fn test_parse_picker_payload_prompt_submitted_multi() {
        let body = br#"{"type":"prompt-submitted","prompt":"make it bigger","elements":[
            {"html":"<button id=\"navCta\">Go</button>","selector":"button#navCta"},
            {"html":"<div class=\"card\">x</div>","selector":"div.card"}
        ]}"#;
        assert_eq!(
            parse_picker_payload(body),
            Some(PickerMessage::PromptSubmitted {
                prompt: "make it bigger".into(),
                elements: vec![
                    PickerElement {
                        html: "<button id=\"navCta\">Go</button>".into(),
                        selector: "button#navCta".into(),
                    },
                    PickerElement {
                        html: "<div class=\"card\">x</div>".into(),
                        selector: "div.card".into(),
                    },
                ],
                label: None,
            })
        );
    }

    #[test]
    fn test_parse_picker_payload_element_missing_selector_defaults_empty() {
        // selector 可缺省，默认空串
        let body =
            br#"{"type":"prompt-submitted","prompt":"x","elements":[{"html":"<span>a</span>"}]}"#;
        assert_eq!(
            parse_picker_payload(body),
            Some(PickerMessage::PromptSubmitted {
                prompt: "x".into(),
                elements: vec![PickerElement {
                    html: "<span>a</span>".into(),
                    selector: String::new(),
                }],
                label: None,
            })
        );
    }

    #[test]
    fn test_parse_picker_payload_prompt_submitted_with_label() {
        // 新版注入脚本携带 label（webview 标识），用于前端按 tab/项目路由
        let payload = serde_json::json!({
            "type": "prompt-submitted",
            "label": "neeko-browser-tab-t1",
            "prompt": "改红",
            "elements": [{ "html": "<div></div>", "selector": "div" }],
        });
        let body = serde_json::to_vec(&payload).unwrap();
        assert_eq!(
            parse_picker_payload(&body),
            Some(PickerMessage::PromptSubmitted {
                prompt: "改红".into(),
                elements: vec![PickerElement {
                    html: "<div></div>".into(),
                    selector: "div".into(),
                }],
                label: Some("neeko-browser-tab-t1".into()),
            })
        );
    }

    #[test]
    fn test_parse_picker_payload_missing_elements() {
        // prompt 存在但无 elements → None
        let body = br#"{"type":"prompt-submitted","prompt":"x"}"#;
        assert!(parse_picker_payload(body).is_none());
    }

    #[test]
    fn test_parse_picker_payload_empty_elements() {
        // elements 为空数组 → None
        let body = br#"{"type":"prompt-submitted","prompt":"x","elements":[]}"#;
        assert!(parse_picker_payload(body).is_none());
    }

    #[test]
    fn test_parse_picker_payload_element_missing_html() {
        // 任一元素缺 html → None
        let body = br#"{"type":"prompt-submitted","prompt":"x","elements":[{"selector":"div"}]}"#;
        assert!(parse_picker_payload(body).is_none());
    }

    #[test]
    fn test_parse_picker_payload_element_html_not_string() {
        let body = br#"{"type":"prompt-submitted","prompt":"x","elements":[{"html":42}]}"#;
        assert!(parse_picker_payload(body).is_none());
    }

    #[test]
    fn test_parse_picker_payload_picker_cancelled() {
        let body = br#"{"type":"picker-cancelled"}"#;
        assert_eq!(
            parse_picker_payload(body),
            Some(PickerMessage::PickerCancelled)
        );
    }

    #[test]
    fn test_parse_picker_payload_element_picked() {
        let body = br#"{"type":"element-picked","html":"<button>Hi</button>"}"#;
        assert_eq!(
            parse_picker_payload(body),
            Some(PickerMessage::ElementPicked {
                html: "<button>Hi</button>".into(),
            })
        );
    }

    #[test]
    fn test_parse_picker_payload_invalid_json() {
        assert!(parse_picker_payload(b"not json").is_none());
    }

    #[test]
    fn test_parse_picker_payload_missing_type() {
        assert!(parse_picker_payload(br#"{"prompt":"x"}"#).is_none());
    }

    #[test]
    fn test_parse_picker_payload_unknown_type() {
        let body = br#"{"type":"mystery"}"#;
        assert!(parse_picker_payload(body).is_none());
    }

    /// >100KB HTML 经 POST body 完整往返(不截断)
    #[test]
    fn test_parse_picker_payload_large_html_round_trip() {
        let large_html = format!("<div>{}</div>", "x".repeat(110_000));
        let payload = serde_json::json!({
            "type": "prompt-submitted",
            "prompt": "改大一点",
            "elements": [{ "html": large_html, "selector": "div" }],
        });
        let body = serde_json::to_vec(&payload).unwrap();

        let parsed = parse_picker_payload(&body);
        match parsed {
            Some(PickerMessage::PromptSubmitted {
                prompt,
                elements,
                label,
            }) => {
                assert_eq!(prompt, "改大一点");
                assert_eq!(elements.len(), 1);
                assert_eq!(elements[0].html.len(), large_html.len());
                assert_eq!(elements[0].html, large_html);
                assert_eq!(elements[0].selector, "div");
                assert_eq!(label, None);
            }
            other => panic!("expected PromptSubmitted, got {:?}", other.is_some()),
        }
    }

    // --- parse_page_meta ---

    #[test]
    fn test_parse_page_meta_full() {
        let body = br#"{"label":"neeko-browser-p1","title":"GitHub","favicon":"https://github.com/favicon.ico"}"#;
        assert_eq!(
            parse_page_meta(body),
            Some((
                "neeko-browser-p1".into(),
                "GitHub".into(),
                "https://github.com/favicon.ico".into(),
            ))
        );
    }

    #[test]
    fn test_parse_page_meta_empty_title_favicon() {
        let body = br#"{"label":"neeko-browser-p1","title":"","favicon":""}"#;
        assert_eq!(
            parse_page_meta(body),
            Some(("neeko-browser-p1".into(), String::new(), String::new()))
        );
    }

    #[test]
    fn test_parse_page_meta_missing_label() {
        let body = br#"{"title":"x"}"#;
        assert!(parse_page_meta(body).is_none());
    }

    #[test]
    fn test_parse_page_meta_invalid_json() {
        assert!(parse_page_meta(b"nope").is_none());
    }

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

    // --- should_emit_prompt（按 label 隔离的去重窗口） ---

    #[test]
    fn test_prompt_dedup_is_per_label() {
        let map: Mutex<HashMap<String, Instant>> = Mutex::new(HashMap::new());

        // 两个不同 webview 在窗口内各自提交：均允许发射（互不抑制）。
        assert!(should_emit_prompt(&map, "neeko-browser-tab-a"));
        assert!(should_emit_prompt(&map, "neeko-browser-tab-b"));

        // 同一 webview 窗口内重复提交：被抑制。
        assert!(!should_emit_prompt(&map, "neeko-browser-tab-a"));
        // 另一 webview 不受影响。
        assert!(should_emit_prompt(&map, "neeko-browser-p1"));
    }

    #[test]
    fn test_prompt_dedup_legacy_shared_key() {
        let map: Mutex<HashMap<String, Instant>> = Mutex::new(HashMap::new());

        assert!(should_emit_prompt(&map, LEGACY_PROMPT_KEY));
        // 窗口内重复（旧 GET 通道）被抑制；哨兵键互相抑制。
        assert!(!should_emit_prompt(&map, LEGACY_PROMPT_KEY));
    }
}
