//! 通用文本原语：ANSI 转义序列剥离。
//!
//! # 为什么在 `common` 而不是某个业务域
//!
//! 「删掉转义序列」是**零域语义**的纯字节变换 —— 它不认识会话、不认识任务、也不认识
//! commit message。判断一个函数该住哪里的判据是「谁会因为什么理由改它」：
//! 这个函数只会因为**终端转义规范**变化而改，与会话解析、团队编排、git 全都无关。
//!
//! 历史：它原本住在 `conversation::text`，`git` 为了同一件事**又手写了一份**（且两者行为
//! 不同：手写版会剥 `ESC[?25l` 这类私有模式序列，正则版不会）。两份实现一旦漂移，
//! 「同一条输出在不同消费者眼里不一样」就是必然的。现在统一到这里，只留一个实现。
//!
//! # 覆盖面（分三类，顺序即优先级）
//!
//! 1. **CSI**（含私有模式）：`\x1B[` + 参数字节 `0-?` + 中间字节 ` -/` + 终止字节 `@-~`
//!    —— 覆盖颜色 `[31m`、组合 `[1;31m`、私有模式 `[?25l`（TUI 隐藏光标，**真实 agent 输出里
//!    很常见**，也是这一版相对旧正则修复的关键）
//! 2. **OSC**：`\x1B]` + 正文 + `BEL` 或 `ST`（`\x1B\`）—— 窗口标题、超链接
//! 3. **其余双字符转义**：`\x1B` + `@-Z` / `\` / `]` / `^` / `_`
//!
//! 正则用 [`LazyLock`] 只编译一次：它在会话解析里是**逐条消息**调用的，每次
//! `Regex::new` 会把整文件解析开销抬到同量级。

// 静态正则字面量不可能编译失败；把 expect 的 4 行样板铺满每个 `LazyLock` 只会淹没正文。
// 与 `conversation/text.rs` 同源（那份也开了同一个 allow）—— 两处都是常量模式。
#![allow(clippy::expect_used)]

use std::sync::LazyLock;

use regex::Regex;

/// ANSI 转义序列（颜色 / 光标控制 / 窗口标题）。
///
/// 交替**顺序即优先级**：Rust `regex` 对同一位置的多个可选分支取最左分支，
/// 所以 CSI / OSC 必须排在通用双字符分支之前，否则 `ESC[` 会被后者抢先吃掉。
static ANSI_ESCAPE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(concat!(
        r"\x1B(?:",
        r"\[[0-?]*[ -/]*[@-~]",            // CSI（含 ?25l 这类私有模式）
        r"|\][^\x07\x1B]*(?:\x07|\x1B\\)", // OSC（BEL 或 ST 终止）
        r"|[@-_]",                         // 其余双字符转义
        r")"
    ))
    .expect("infallible: static pattern")
});

/// 剥离 ANSI 转义序列。
///
/// 对**任意**输入返回 `String`；不含转义的输入原样返回（正则不命中时 `replace_all`
/// 只做一次扫描，不额外分配中间串）。
#[must_use]
pub fn strip_ansi(s: &str) -> String {
    if !s.contains('\x1b') {
        // 快路径：绝大多数正文行没有 ESC，连正则都不用跑。
        return s.to_owned();
    }
    ANSI_ESCAPE.replace_all(s, "").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// SGR 颜色：最基础的一类。
    #[test]
    fn strips_sgr_colors() {
        assert_eq!(strip_ansi("\x1b[31mred\x1b[0m"), "red");
        assert_eq!(strip_ansi("\x1b[1;31mbold red\x1b[0m"), "bold red");
    }

    /// **私有模式序列**（`ESC[?25l` 隐藏光标）。
    ///
    /// 这条是本模块存在的直接理由：旧实现 `\x1B\[[0-9;]*[a-zA-Z]` 的参数字节里没有 `?`，
    /// 于是 `?25` 留在原地 —— 而 TUI agent 的每一帧都可能带这两条。
    #[test]
    fn strips_private_mode_sequences() {
        assert_eq!(strip_ansi("\x1b[?25lhi\x1b[?25h"), "hi");
    }

    /// OSC：窗口标题 / 超链接（BEL 与 ST 两种终止符都要认）。
    #[test]
    fn strips_osc_terminated_by_bel_or_st() {
        assert_eq!(strip_ansi("\x1b]0;title\x07after"), "after");
        assert_eq!(
            strip_ansi("\x1b]8;;http://x\x1b\\link\x1b]8;;\x1b\\"),
            "link"
        );
    }

    /// 转义**插在载荷中间**：这是 sentinel 会遇到的形态，剥完必须仍是合法 JSON。
    ///
    /// 注意序列的选择：CSI 的**终止字节本身是一个字母**，所以「插在某个单词中间」会连它
    /// 后面那个字母一起吃掉。这里用 `ESC[0m`（终止字节 `m` 不承载语义）——换成
    /// `ESC[?25l` 就会把 `completed` 的 `l` 吃掉，变成 `competed`。
    /// 这条约束也解释了为什么 sentinel 必须**剥完再解析**：字节级匹配会在这种情况下误判。
    #[test]
    fn escape_inside_a_payload_does_not_corrupt_it() {
        let raw = "{\"status\":\"comp\x1b[0mleted\"}";
        assert_eq!(strip_ansi(raw), "{\"status\":\"completed\"}");
    }

    /// 无 ESC 的输入原样返回（含多字节字符，不能被按字节处理打碎）。
    #[test]
    fn passthrough_without_escapes_keeps_multibyte_text() {
        let plain = "构建完成 ✅ 中文";
        assert_eq!(strip_ansi(plain), plain);
    }

    /// 空串与只有转义的串。
    #[test]
    fn empty_and_escape_only_inputs() {
        assert_eq!(strip_ansi(""), "");
        assert_eq!(strip_ansi("\x1b[0m\x1b[?25h"), "");
    }
}
