//! 会话文本原语：ANSI 剥离、图片引用剥离、字符边界截断。
//!
//! 这一层是 `normalize`（标题/预览净化）与 `adapters`（原生格式解析）的**共同下游**，
//! 自身不依赖 `conversation` 内任何模块 —— 依赖方向因此保持单向（adapters → normalize → text），
//! 不会出现 `normalize ↔ adapters` 的循环。
//!
//! 正则一律用 [`LazyLock`] 编译一次：`strip_ansi` 在 `parse_messages` 里是逐条消息调用，
//! 每次 `Regex::new` 会把整文件解析的开销抬到同量级。

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::sync::LazyLock;

use regex::Regex;

/// ANSI 转义序列（颜色 / 光标控制）。
static ANSI_ESCAPE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\x1B\[[0-9;]*[a-zA-Z]").expect("infallible: static pattern"));

/// 图片引用：markdown 图片与 harness 占位式引用。
///
/// 覆盖两种真实形态（pi / claude 会话里都存在）：
/// - `[[Image #1]](file:///…/blobs/<sha>.png)`、`[Image #1](url)`、`[Image #1]`
/// - `![alt](url)`
static IMAGE_REFERENCE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)!?\[+Image\s*#\d+\]+(?:\([^)]*\))?|!\[[^\]]*\]\([^)]*\)")
        .expect("infallible: static pattern")
});

/// 剥离 ANSI 转义序列
pub(crate) fn strip_ansi(s: &str) -> String {
    ANSI_ESCAPE.replace_all(s, "").to_string()
}

/// 剥离图片引用。
///
/// 图片指向附件而非语义文本：留在标题里只会得到一长串 blob URI，留在预览里是纯噪声。
/// 正文不做此处理（正文里的图片链接对用户仍有价值）。
pub(crate) fn strip_image_references(s: &str) -> String {
    IMAGE_REFERENCE.replace_all(s, "").to_string()
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
    use super::{strip_ansi, strip_image_references, truncate};

    #[test]
    fn should_strip_blob_image_reference() {
        let s = "[[Image #1]](file:///Users/t/blobs/32b9.png)\n\n历史会话里显示的是 ID";
        assert_eq!(strip_image_references(s), "\n\n历史会话里显示的是 ID");
    }

    #[test]
    fn should_strip_bare_image_placeholder() {
        assert_eq!(
            strip_image_references("[Image #1] 看下这个报错"),
            " 看下这个报错"
        );
        assert_eq!(strip_image_references("[image #12]"), "");
    }

    #[test]
    fn should_strip_markdown_image() {
        assert_eq!(
            strip_image_references("![screenshot](a.png) fix this"),
            " fix this"
        );
    }

    #[test]
    fn should_keep_prose_mentioning_image() {
        let s = "图片渲染不出来，请在 markdown 里支持 image 标签";
        assert_eq!(strip_image_references(s), s);
    }

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
