//! 标题派生（纯函数）：`pick` / `truncate` / `should_upgrade`。
//!
//! 标题只有一条**单调升级**的规则：来源质量越高越能覆盖
//! （`Placeholder < Prompt < Native < User`），同级允许覆盖 —— 同一来源后到的那份可能
//! 更完整（例如 conversation 扫描给出的原生标题比恢复请求里的 `topic` 更长）。
//! 反向永不发生：`User` 一旦设置，任何自动来源都不得改写它。

use crate::live_sessions::entry::TitleSource;

/// 标题字符上界（按**字符**而不是字节：中文标题不该被切半个字）。
pub const MAX_TITLE_CHARS: usize = 80;

/// 截断补齐用的省略号（占 1 个字符预算）。
const ELLIPSIS: char = '…';

/// 新来源是否允许覆盖当前来源（同级允许，弱级拒绝）。
#[must_use]
pub fn should_upgrade(current: TitleSource, incoming: TitleSource) -> bool {
    incoming >= current
}

/// 折叠空白 + 按字符截断。
///
/// - 连续空白（含换行 / 制表符）折叠为一个空格并去掉首尾 —— prompt 里常有缩进，
///   不折叠会让侧栏标题出现大段空白；
/// - 超出 `max_chars` 时保留 `max_chars - 1` 个字符 + 省略号，**总长恒 ≤ `max_chars`**；
/// - `chars()` 取字符边界，中文 / emoji 不会被切成半个。
#[must_use]
pub fn truncate(text: &str, max_chars: usize) -> String {
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

/// 从候选取最强来源的标题（忽略空白候选；同级取**先出现**的那个）。
///
/// 候选按调用点的语义排列（`Native` 在前、`Placeholder` 兜底），返回值是
/// 「来源 + 文本」的成对结果 —— 后续 `set_title` 用它参与单调升级判定。
#[must_use]
pub fn pick(candidates: &[(TitleSource, &str)]) -> Option<(TitleSource, String)> {
    let mut best: Option<(TitleSource, String)> = None;
    for (source, raw) in candidates {
        let text = truncate(raw, MAX_TITLE_CHARS);
        if text.is_empty() {
            continue;
        }
        match &best {
            // 同级保留先出现者：同级文本没有质量差异，稳定性比"后者胜"更有价值。
            Some((best_source, _)) if source <= best_source => {}
            _ => best = Some((*source, text)),
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::live_sessions::entry::TitleSource::{Native, Placeholder, Prompt, User};

    #[test]
    fn should_upgrade_rejects_weaker_sources_only() {
        assert!(should_upgrade(Placeholder, Prompt));
        assert!(should_upgrade(Prompt, Native));
        assert!(should_upgrade(Native, User));
        // 同级允许覆盖（同一来源可能有更完整的值）。
        assert!(should_upgrade(Native, Native));
        assert!(should_upgrade(User, User));
        // 弱级永不覆盖强级。
        assert!(!should_upgrade(Native, Prompt));
        assert!(!should_upgrade(Prompt, Placeholder));
    }

    /// `User` 一旦设置，任何自动来源都不得改写它（AC2）。
    #[test]
    fn user_title_is_never_overridden_by_automatic_sources() {
        for incoming in [Placeholder, Prompt, Native] {
            assert!(
                !should_upgrade(User, incoming),
                "{incoming:?} 不得覆盖 User 标题"
            );
        }
    }

    #[test]
    fn truncate_collapses_whitespace_and_trims() {
        assert_eq!(truncate("  a\n\tb   c  ", MAX_TITLE_CHARS), "a b c");
        assert_eq!(truncate(" \n\t ", MAX_TITLE_CHARS), "");
    }

    #[test]
    fn truncate_keeps_short_titles_verbatim() {
        assert_eq!(truncate("hello", MAX_TITLE_CHARS), "hello");
        assert_eq!(truncate("12345", 5), "12345");
    }

    /// 按字符截断：中文不会被切成半个字，且总长不超过预算。
    #[test]
    fn truncate_never_splits_a_character() {
        let text = "中文标题测试用例";
        let out = truncate(text, 3);
        assert_eq!(out.chars().count(), 3);
        assert!(out.ends_with(ELLIPSIS), "截断必须可辨认：{out}");
        let kept: String = out.chars().filter(|c| *c != ELLIPSIS).collect();
        assert!(text.starts_with(&kept), "保留部分必须是原文前缀");
    }

    #[test]
    fn truncate_with_zero_budget_is_empty() {
        assert_eq!(truncate("anything", 0), "");
    }

    #[test]
    fn pick_prefers_the_strongest_source_regardless_of_order() {
        let forward = [
            (Placeholder, "agent"),
            (Prompt, "fix the parser"),
            (Native, "Parser bug"),
        ];
        assert_eq!(
            pick(&forward),
            Some((Native, "Parser bug".to_string())),
            "最强来源胜出"
        );

        let reversed: Vec<(TitleSource, &str)> = forward.iter().rev().copied().collect();
        assert_eq!(pick(&reversed), Some((Native, "Parser bug".to_string())));
    }

    #[test]
    fn pick_ignores_blank_candidates() {
        let candidates = [(Native, "   "), (Prompt, "hello"), (Placeholder, "\n")];
        assert_eq!(pick(&candidates), Some((Prompt, "hello".to_string())));
        assert_eq!(pick(&[(Native, "  "), (Prompt, "")]), None);
    }

    #[test]
    fn pick_keeps_the_first_candidate_within_a_tier() {
        let candidates = [(Native, "first"), (Native, "second")];
        assert_eq!(pick(&candidates), Some((Native, "first".to_string())));
    }

    #[test]
    fn pick_truncates_candidates() {
        let long = "标".repeat(MAX_TITLE_CHARS + 20);
        let picked = pick(&[(Prompt, long.as_str())]).expect("non-empty candidate");
        assert_eq!(picked.1.chars().count(), MAX_TITLE_CHARS);
    }
}
