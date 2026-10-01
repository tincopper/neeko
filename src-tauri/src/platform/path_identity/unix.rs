//! POSIX 宿主（macOS / Linux）：宿主形态路径 → 身份字母表。
//!
//! 与 Windows 的差别只有一条：`\` 是合法文件名字符，不得改写 —— 规则体与远端路径共用。

use super::rules;

/// 把 POSIX 宿主的规范化路径渲染为平台无关身份串。
///
/// 输入必须是 UTF-8 文本（调用方先拒绝非 UTF-8）。
#[must_use]
pub fn portable_render(raw: &str) -> String {
    rules::render_posix_shaped(raw)
}
