//! 与来源无关的文本工具：预算、折叠、截断。
//!
//! 三个来源都经这里 —— 标题的长度语义只有一份实现。

/// 标题字符上界（按**字符**而不是字节：中文标题不该被切半个字）。
///
/// 它是 title 模块的**公开契约**（写入侧截断到这么长），由 [`budgeted`] 派生扫描预算、
/// 由判据直接消费 —— 只此一处。声明在本文件而不是 `mod.rs`：红线 9 要求模块根只放
/// `mod` + `pub use`，契约本身属于「文本长度」这一件事。
pub const MAX_TITLE_CHARS: usize = 80;

/// 判据与折叠只看这段前缀。
///
/// 标题是预览：一条 200KB 的粘贴 prompt 不该在事件泵线程上分配整份拷贝。8 倍余量用于
/// 吸收缩进/换行 —— 先按 [`MAX_TITLE_CHARS`] 硬切会把「80 个空格 + 正文」整条切掉。
pub(super) const TITLE_SCAN_BUDGET_CHARS: usize = MAX_TITLE_CHARS * 8;

/// 净化（`clean`）的输入窗口 —— 比判据预算宽 8 倍。
///
/// 为什么不能直接用 [`TITLE_SCAN_BUDGET_CHARS`]：净化要**跨过**隐藏块才能删掉它。一个
/// `<system-reminder>` 常达数千字符（Claude Code 实测），若在 640 字符处截断，块就没有
/// 终止符、`strip_hidden_blocks`（按设计）原样保留，标题会变成 `<system-reminder>…`。
/// 5120 字符是「覆盖真实注入块」与「不复制 200KB 粘贴」之间的分界：超出这段的块仍可能
/// 漏出，那是有意的分配上界（判据随后只取前 [`TITLE_SCAN_BUDGET_CHARS`]）。
pub(super) const TITLE_CLEAN_BUDGET_CHARS: usize = TITLE_SCAN_BUDGET_CHARS * 8;

/// 截断补齐用的省略号（占 1 个字符预算）。
pub(super) const ELLIPSIS: char = '…';

/// 零分配取前缀：超出 `max_chars` 时在**字符边界**切片，不 `collect`、不 `to_string`。
pub(super) fn budgeted(text: &str, max_chars: usize) -> &str {
    match text.char_indices().nth(max_chars) {
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
