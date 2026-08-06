//! 浏览器模块事件名常量(单一事实源)。
//!
//! 与前端 `src/shared/events.ts` 中 `BROWSER_*` 常量保持同步。
//! 禁止在业务代码中硬编码事件字符串。

/// 导航 URL 变化事件:`browser://url-changed`
pub const EVENT_BROWSER_URL_CHANGED: &str = "browser://url-changed";
/// 页面加载状态事件:`browser://loading`
pub const EVENT_BROWSER_LOADING: &str = "browser://loading";
/// 页面加载完成事件:`browser://page-loaded`
pub const EVENT_BROWSER_PAGE_LOADED: &str = "browser://page-loaded";
/// target="_blank" 新窗口拦截事件:`browser://open-url`
pub const EVENT_BROWSER_OPEN_URL: &str = "browser://open-url";
/// picker 取消事件:`browser://picker-cancelled`
pub const EVENT_BROWSER_PICKER_CANCELLED: &str = "browser://picker-cancelled";
/// picker prompt 提交事件:`browser://prompt-submitted`
pub const EVENT_BROWSER_PROMPT_SUBMITTED: &str = "browser://prompt-submitted";
/// 页面元信息事件(标题/favicon):`browser://page-meta`
pub const EVENT_BROWSER_PAGE_META: &str = "browser://page-meta";
