//! 会话文本原语：ANSI 剥离、字符边界截断。
//!
//! 这一层是 `normalize`（预览净化）与 `adapters`（原生格式解析）的**共同下游**，
//! 自身不依赖 `conversation` 内任何模块 —— 依赖方向因此保持单向（adapters → normalize → text），
//! 不会出现 `normalize ↔ adapters` 的循环。
//!
//! 与展示目标无关的**噪声剥离**（隐藏块 / 注释 / 图片引用 / harness 套话）不在这里：
//! 它在 [`crate::common::agent::transcript_noise`]，因为标题域也要用同一份（两域共用一件事
//! 只能有一个实现）。
//!
//! 正则一律用 [`LazyLock`] 编译一次：`strip_ansi` 在 `parse_messages` 里是逐条消息调用，
//! 每次 `Regex::new` 会把整文件解析的开销抬到同量级。

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::sync::LazyLock;

use regex::Regex;

/// ANSI 转义序列（颜色 / 光标控制）。
static ANSI_ESCAPE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\x1B\[[0-9;]*[a-zA-Z]").expect("infallible: static pattern"));

/// 剥离 ANSI 转义序列
pub(crate) fn strip_ansi(s: &str) -> String {
    ANSI_ESCAPE.replace_all(s, "").to_string()
}

/// 对字符串截断到指定长度（在字符边界），附加省略号
pub(crate) fn truncate(s: &str, max_chars: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        format!("{}...", s.chars().take(max_chars).collect::<String>())
    }
}

#[cfg(test)]
mod tests {
    use super::{strip_ansi, truncate};

    #[test]
    fn should_strip_ansi_sequences() {
        assert_eq!(strip_ansi("\x1B[31mred\x1B[0m"), "red");
    }

    #[test]
    fn should_truncate_on_char_boundary() {
        assert_eq!(truncate("  你好世界  ", 10), "你好世界");
        assert_eq!(truncate("你好世界", 2), "你好...");
    }
}
