//! `Prompt` 来源：用户原样敲的字。
//!
//! 不是所有敲的字都是「主题」：斜杠命令是对工具的**操作**，纯符号连词都没有，祈使包装
//! （`Can you please…`）占掉标题最贵的前几个字符。被拒的素材仍算「用户提交」（活动态照变），
//! 只是不命名 —— 之后第一条真正的消息才命名。
//!
//! 两条策略都由**数据表**承载（`LEADING_FILLERS`）：新增一种包装是加一行，判据函数不改。

use super::text::{non_empty, truncate};
use super::MAX_TITLE_CHARS;

pub(super) fn prompt_candidate(text: &str) -> Option<String> {
    let stripped = strip_leading_fillers(text).trim();
    if stripped.is_empty()
        || !stripped.chars().any(char::is_alphanumeric)
        || is_command_line(stripped)
    {
        return None;
    }
    non_empty(truncate(stripped, MAX_TITLE_CHARS))
}

/// 祈使包装前缀。**顺序即优先级**：长的先试，`can you please` 不能先被 `can you` 吃掉。
///
/// 刻意不含 `let's` / `let us`：`Let's Encrypt 证书续期` 会被剥成 `Encrypt 证书续期` ——
/// 那是在改变语义，而剥前缀的全部价值只是省几个字符。
const LEADING_FILLERS: &[&str] = &[
    "can you please ",
    "could you please ",
    "would you please ",
    "can you ",
    "could you ",
    "would you ",
    "i want you to ",
    "i need you to ",
    "we need to ",
    "i want to ",
    "i need to ",
    "help me to ",
    "help me ",
    "need to ",
    "please ",
];

/// 循环剥前缀，最多 3 轮（`Can you please help me …` 需要两轮）。
///
/// 剥完为空 ⇒ 交给调用方判负（`Let's` 这类纯包装不该变成空标题）。
fn strip_leading_fillers(mut text: &str) -> &str {
    for _ in 0..3 {
        let trimmed = text.trim_start();
        match strip_one_filler(trimmed) {
            Some(rest) => text = rest,
            None => return trimmed,
        }
    }
    text.trim_start()
}

fn strip_one_filler(text: &str) -> Option<&str> {
    for prefix in LEADING_FILLERS {
        // `get` 而不是索引：前缀长度可能落在多字节字符中间。
        if let Some(head) = text.get(..prefix.len()) {
            if head.eq_ignore_ascii_case(prefix) {
                return Some(&text[prefix.len()..]);
            }
        }
        // 整串就是包装词本身（`Please`）—— 也算剥掉，剥完为空。
        // 必须卡词边界，否则 `Pleaseful things` 会被误删成空串。
        let bare = prefix.trim_end();
        if let Some(head) = text.get(..bare.len()) {
            let rest = &text[bare.len()..];
            if head.eq_ignore_ascii_case(bare)
                && !rest.chars().next().is_some_and(char::is_alphanumeric)
            {
                return Some(rest);
            }
        }
    }
    None
}

/// 这一行是否是**给 CLI 的指令**，而不是这次会话的主题。
///
/// # 为什么需要
///
/// 首条输入经常是 `/model`、`/init`、`/clear` 这类斜杠命令 —— 它们是「对工具的**操作**」，
/// 不是「这次会话**要谈的事**」。当成标题会得到两种坏结果：侧栏写着 `/model`（用户想找的是
/// 「那次聊 X 的会话」，这个字符串帮不上忙），或者更糟 —— 自动补全菜单里按回车的那一下被
/// 捕获成**半截命令** `/mo`（实测），既不是用户的完整输入，也无从辨认。
///
/// # 判据（取最保守的一条）
///
/// 行首 `/` + 单个命令词（字母开头，正文不含内部 `/`），后面允许跟参数：
///
/// - 认定为命令：`/model`、`/mo`（补全半截）、`/model Hy3 · routing group`、`  /init`；
/// - 仍按内容处理：`/Users/tomgs/repo`（命令词里有内部 `/`，那是路径）、`//注释`、`/` 本身、
///   `修复 /api 的 500`（不在行首）。
///
/// 只认 `/`：`!`（bash 模式）与 `@`（文件提及）既可能是内容也可能是指令，无法单靠形状区分，
/// 宁可不猜。
fn is_command_line(text: &str) -> bool {
    let Some(rest) = text.trim_start().strip_prefix('/') else {
        return false;
    };
    let token = rest.split_whitespace().next().unwrap_or("");
    let mut chars = token.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}
