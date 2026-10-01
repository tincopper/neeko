//! Windows 宿主：宿主形态路径 → 身份字母表（规则体见 [`super::rules::render_windows_shaped`]）。

use super::rules;

/// 把 Windows 宿主的规范化路径渲染为平台无关身份串。
///
/// 输入必须是 UTF-8 文本（调用方先拒绝非 UTF-8）—— 渲染层不做 `to_string_lossy`：
/// 把非 UTF-8 悄悄换成 U+FFFD 会造出「第二种身份表示」。
#[must_use]
pub fn portable_render(raw: &str) -> String {
    rules::render_windows_shaped(raw)
}
