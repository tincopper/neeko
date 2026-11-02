//! 标题判据的用例：覆盖序、四个来源的准入、预算与字符边界。
//!
//! **每个判据都要有「放行」与「判负」两侧**：只断言判负会让判据退化成"什么都拒"
//! 也能通过的假绿。

use super::text::{truncate, ELLIPSIS, TITLE_SCAN_BUDGET_CHARS};
use super::*;
use crate::live_sessions::entry::TitleSource::{Native, Placeholder, Prompt, User};

// ── 覆盖序 ──────────────────────────────────────────────────────────────

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

// ── 准入：Placeholder ───────────────────────────────────────────────────

/// 占位不是标题 —— 即使给了非空文本也不放行。
///
/// 这条不变量是 `title_source == Placeholder ⟺ title.is_empty()` 的来源，
/// 后端的 `has_real_title` 与前端的 `isNamedSession` 都靠它退化成「非空」。
#[test]
fn placeholder_never_admits_a_title() {
    assert_eq!(admit(Placeholder, "", None), None);
    assert_eq!(admit(Placeholder, "pi", None), None);
    assert_eq!(admit(Placeholder, "Terminal 1", None), None);
}

// ── 准入：User ─────────────────────────────────────────────────────────

/// 用户说了算：不剥装饰、不剥客套包装，只折叠空白与截断。
#[test]
fn user_titles_pass_through_without_cleaning() {
    assert_eq!(admit(User, "我的会话", None).as_deref(), Some("我的会话"));
    assert_eq!(
        admit(User, "  ✳ Claude ready  ", None).as_deref(),
        Some("✳ Claude ready"),
        "用户自己起的名字不剥装饰"
    );
    assert_eq!(admit(User, "   ", None), None);
}

// ── 准入：Prompt ───────────────────────────────────────────────────────

#[test]
fn slash_commands_are_not_titles() {
    for line in [
        "/model",
        "/mo", // 自动补全菜单里按回车时捕获到的半截命令
        "/model Hy3 · routing group",
        "  /init",
        "/compact-now",
    ] {
        assert_eq!(admit(Prompt, line, None), None, "{line} 不该成为标题");
    }
}

#[test]
fn paths_and_prose_that_start_with_slash_stay_content() {
    for line in [
        "hello",
        "/Users/tomgs/RustroverProjects/neeko", // 命令词里有内部 `/`，那是路径
        "/usr/bin/env python3",
        "//这不是命令",
        "修复 /api 的 500",
        "查看 /model 的实现",
    ] {
        assert!(admit(Prompt, line, None).is_some(), "{line} 值得当标题");
    }
}

#[test]
fn symbol_only_input_is_not_a_title() {
    for line in ["@", ">", "?", "  :  ", "/", "!", "。。。"] {
        assert_eq!(admit(Prompt, line, None), None, "{line:?} 没有可读内容");
    }
    assert!(admit(Prompt, "修复登录竞态", None).is_some());
    assert!(admit(Prompt, "502 错误", None).is_some());
}

#[test]
fn leading_politeness_is_stripped() {
    assert_eq!(
        admit(Prompt, "Can you please fix the parser", None).as_deref(),
        Some("fix the parser")
    );
    assert_eq!(
        admit(Prompt, "I want you to look into the login race", None).as_deref(),
        Some("look into the login race")
    );
    // 两轮：`Can you please` 之后还有 `help me`。
    assert_eq!(
        admit(Prompt, "Can you please help me debug this", None).as_deref(),
        Some("debug this")
    );
    // 剥完为空 ⇒ 判负（纯包装不是主题）。
    assert_eq!(admit(Prompt, "Please", None), None);
    // 不在词边界的近似串不动。
    assert_eq!(
        admit(Prompt, "Pleaseful things", None).as_deref(),
        Some("Pleaseful things")
    );
}

// ── 准入：Native ───────────────────────────────────────────────────────

/// 真主题放行：provider 自己做的语义浓缩，是本来源存在的全部理由。
#[test]
fn native_admits_a_real_task_title() {
    for title in [
        "✳ Fix login bug",
        "⠋ 修复登录竞态",
        "Review the diff for #42",
        "✳ 重构 live_sessions 的标题判据",
    ] {
        assert!(
            admit(Native, title, Some("claude-code")).is_some(),
            "{title} 应当成为标题"
        );
    }
    assert_eq!(
        admit(Native, "✳ Fix login bug", Some("claude-code")).as_deref(),
        Some("Fix login bug"),
        "装饰被剥掉，主题留下"
    );
}

/// 状态栏形态判负 —— 这正是当初把 OSC 来源整个删掉的 `π` 事故形态。
///
/// 逐条给出 agent：身份回显是相对 agent 的，同一个 `pi` 对 `claude-code` 会话就是
/// 合法主题（用户可能在讨论 pi）。
#[test]
fn native_rejects_status_bar_frames() {
    let cases: &[(&str, Option<&str>)] = &[
        ("π", Some("pi")),                       // pi 的品牌字形（希腊字母）
        ("✳", Some("claude-code")),              // 只有装饰
        ("✳ Claude ready", Some("claude-code")), // 身份 + 状态
        ("Claude Code", Some("claude-code")),    // 纯身份回显
        ("claude-code", Some("claude-code")),    // 身份回显的 slug 形态
        ("pi", Some("pi")),                      // 身份回显
        ("⠋ codex", Some("codex")),              // 身份回显（带 spinner）
        ("ready", None),                         // 纯状态词
        ("idle (2m)", None),                     // 状态词 + 上下文
        ("Cursor - action required", Some("cursor")),
        ("Terminal 3", None),        // 默认标题
        ("/Users/tomgs/repo", None), // cwd 形态
        ("~/.config", None),
        ("C:\\Users\\tomgs", None),
        ("orca/workspaces", None), // 单个 path-ish token
        ("  ", None),              // 空白
    ];
    for (title, agent) in cases {
        assert_eq!(admit(Native, title, *agent), None, "{title:?} 不该成为标题");
    }
}

/// 没有 agent 时身份判据不生效（纯 shell 终端），其余判据照旧。
#[test]
fn native_identity_rule_needs_an_agent() {
    assert_eq!(
        admit(Native, "claude code", None).as_deref(),
        Some("claude code")
    );
    assert_eq!(
        admit(Native, "ready", None),
        None,
        "状态词不需要 agent 知识"
    );
}

/// `claude-code` 的短形态 `claude` 同样算身份回显（idle 帧可能只写名字）。
#[test]
fn native_identity_accepts_the_short_alias() {
    for title in [
        "Claude",
        "claude ready",
        "✳ Claude Code",
        "Claude - action required",
    ] {
        assert_eq!(
            admit(Native, title, Some("claude-code")),
            None,
            "{title:?} 是身份回显"
        );
    }
    // 主题里出现 agent 名不算回显。
    assert!(admit(Native, "Claude 的 hook 为什么没生效", Some("claude-code")).is_some());
}

// ── 归一化与预算 ───────────────────────────────────────────────────────

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

/// 判据只看前缀：预算之外的正文不参与，也不会被扫描。
#[test]
fn admit_only_scans_the_budget_prefix() {
    let long = format!("{}{}", "a".repeat(TITLE_SCAN_BUDGET_CHARS), "尾部标记");
    let title = admit(Prompt, &long, None).expect("前缀里的 a 是有效素材");
    assert_eq!(title.chars().count(), MAX_TITLE_CHARS);
    assert!(!title.contains("尾部标记"), "预算之外的正文不该被扫到");
}

/// 预算必须落在字符边界：多字节字符不会 panic，也不会被切成半个。
#[test]
fn budget_never_splits_a_multibyte_character() {
    let long = "标".repeat(TITLE_SCAN_BUDGET_CHARS + 100);
    let title = admit(Native, &long, None).expect("中文标题有效");
    assert_eq!(title.chars().count(), MAX_TITLE_CHARS);
}
