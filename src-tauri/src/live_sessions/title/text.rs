//! 与来源无关的文本工具：预算、折叠、截断。
//!
//! 三个来源都经这里 —— 标题的长度语义只有一份实现。

use super::MAX_TITLE_CHARS;

/// 判据与折叠只看这段前缀。
///
/// 标题是预览：一条 200KB 的粘贴 prompt 不该在事件泵线程上分配整份拷贝。8 倍余量用于
/// 吸收缩进/换行 —— 先按 [`MAX_TITLE_CHARS`] 硬切会把「80 个空格 + 正文」整条切掉。
pub(super) const TITLE_SCAN_BUDGET_CHARS: usize = MAX_TITLE_CHARS * 8;

/// 截断补齐用的省略号（占 1 个字符预算）。
pub(super) const ELLIPSIS: char = '…';

/// 零分配取前缀：超出预算时在**字符边界**切片，不 `collect`、不 `to_string`。
pub(super) fn budgeted(text: &str) -> &str {
    match text.char_indices().nth(TITLE_SCAN_BUDGET_CHARS) {
        Some((byte_idx, _)) => &text[..byte_idx],
        None => text,
    }
}

/// 折叠空白 + 按字符截断。
///
/// - 连续空白（含换行 / 制表符）折叠为一个空格并去掉首尾 —— prompt 里常有缩进，
///   不折叠会让侧栏标题出现大段空白；
/// - 超出 `max_chars` 时保留 `max_chars - 1` 个字符 + 省略号，**总长恒 ≤ `max_chars`**；
/// - `chars()` 取字符边界，中文 / emoji 不会被切成半个。
///
/// 调用方必须传 [`budgeted`] 之后的切片，否则折叠会对全量输入分配。
pub(super) fn truncate(text: &str, max_chars: usize) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if max_chars == 0 {
        return String::new();
    }
    if collapsed.chars().count() <= max_chars {
        return collapsed;
    }
    let mut out: String = collapsed.chars().take(max_chars - 1).collect();
    out.push(ELLIPSIS);
    out
}

pub(super) fn non_empty(text: String) -> Option<String> {
    (!text.is_empty()).then_some(text)
}
