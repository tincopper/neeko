//! `git rev-list --left-right --count` 输出的唯一解析点（ahead/behind 语义）。
//!
//! 语义一度在 worker 与 `operations::get_ahead_behind` 各写一份 —— 同一份
//! 「left=behind / right=ahead」的映射，两处实现即两处可漂移的口径。本模块是
//! 唯一实现，两个调用方都委托到这里（与 `parsers/status` / `parsers/numstat` 同构）。

/// 解析 `git rev-list --left-right --count @{upstream}...HEAD` 的输出。
///
/// 输出形态为 `left\tright`：
/// - `left` = 上游独有 = **behind**；
/// - `right` = 本地独有 = **ahead**。
///
/// 字段缺失 / 非法一律按 `0` 计 —— **失败语义留给调用方**：worker 把命令失败软化为
/// `(0, 0)`（合法状态而非错误），命令层则决定是上抛还是兜底。本函数只负责把
/// 「已有输出」翻译成数字，不解释失败。
#[must_use]
pub fn parse_ahead_behind(output: &str) -> (u32, u32) {
    let mut parts = output.trim().split('\t');
    let behind = parts
        .next()
        .and_then(|s| s.trim().parse::<u32>().ok())
        .unwrap_or(0);
    let ahead = parts
        .next()
        .and_then(|s| s.trim().parse::<u32>().ok())
        .unwrap_or(0);
    (ahead, behind)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_left_right_into_ahead_behind() {
        // left\tright = behind\tahead
        assert_eq!(parse_ahead_behind("3\t7\n"), (7, 3));
        assert_eq!(parse_ahead_behind("0\t0"), (0, 0));
    }

    #[test]
    fn missing_right_field_is_zero_ahead() {
        assert_eq!(parse_ahead_behind("5\t\n"), (0, 5));
        assert_eq!(parse_ahead_behind("5"), (0, 5));
    }

    #[test]
    fn empty_and_illegal_fields_are_zero() {
        assert_eq!(parse_ahead_behind(""), (0, 0));
        assert_eq!(parse_ahead_behind("not\tnumbers\n"), (0, 0));
        assert_eq!(parse_ahead_behind("1\t2\t3"), (2, 1));
    }

    #[test]
    fn tolerates_surrounding_whitespace() {
        assert_eq!(parse_ahead_behind("  4\t2  \n"), (2, 4));
    }
}
