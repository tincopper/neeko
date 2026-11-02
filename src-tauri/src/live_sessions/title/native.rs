//! `Native` 来源：CLI 渲染到终端标题栏的字符串（OSC 0/2）或它显式声明的会话主题。
//!
//! 同一个通道承载**两类语义** —— 任务主题（`✳ Fix login bug`）与状态（`✳ Claude ready`）。
//! 判据把它拆开，只放行前一类。四条子判据按不确定性升序：
//!
//! 1. 剥装饰后非空、≥ 2 字符、含字母数字（结构形态，最确定）；
//! 2. 非纯状态词 / `Terminal N` / cwd 形态（已观测的失效形态）；
//! 3. 非身份回显（启发式，最不确定 —— 漏判只是降级成 `Claude Code` 这种固定短串）。
//!
//! # CLI 差异落在数据，不落在分支
//!
//! 「哪些字符是装饰、哪些词只说状态、agent id 有哪些呈写形态」是**每个 CLI 的事实**，
//! 全部以常量表承载（`BRAND_GLYPHS` / `STATUS_WORDS` / `ID_SUFFIXES` …）。新增一个 CLI
//! 是加一行数据，判据函数不改 —— 与 `crate::agent::cli_status::CHANNELS` 同一条原则
//! （红线 15 的通用形态）。

use super::text::truncate;
use super::MAX_TITLE_CHARS;

/// `Native` 素材的结构下限：一个字符不携带任何主题信息。
const MIN_TITLE_CHARS: usize = 2;

/// 品牌 / 状态装饰符：Claude 的 `✳`、Gemini 的 `✦ ⏲ ◇ ✋`、Qoder 的 `▲`。
///
/// 这些字符是**同一类**事实（CLI 前置在标题上的状态装饰），与具体 agent 无关 ——
/// 所以是一张共享表，不按 agent 分叉；新增品牌的字形在这里加一个字符。
const BRAND_GLYPHS: &[char] = &['✳', '✦', '⏲', '◇', '✋', '▲'];

/// spinner 字形段：braille（`⠋⠙…`，多数 TUI）与四分圆（`◐◑…`）。
const SPINNER_RANGES: &[(char, char)] = &[('\u{2800}', '\u{28ff}'), ('\u{25d0}', '\u{25d3}')];

/// Claude 的 `. ` / `* ` 工作 / 空闲前缀（tab 栏已有 provider 图标，标题里再来一个就是重复）。
const WORK_PREFIXES: &[&str] = &[". ", "* "];

/// 纯状态词：出现即「这条标题只说状态，没说主题」。
///
/// 词表是**共享**的（英文是 CLI 的通用语），要支持本地化 CLI 就在此加词，不改判据。
const STATUS_WORDS: &[&str] = &["ready", "idle", "done", "working", "thinking", "running"];

/// 状态**短语**（含空格，不能按单词比对）：审批等待的惯用文案。
const STATUS_PHRASES: &[&str] = &["action required"];

/// 默认标题的形态（`Terminal 3`）：会话还没被命名过。
const TERMINAL_DEFAULT_PREFIX: &str = "terminal ";

/// agent id 的呈写后缀：`claude-code` 的 idle 帧可能只写 `Claude`。
const ID_SUFFIXES: &[&str] = &[" code", " cli"];

pub(super) fn native_candidate(text: &str, agent_id: Option<&str>) -> Option<String> {
    let stripped = truncate(strip_decoration(text), MAX_TITLE_CHARS);
    // 单字符一律判负：`π`（pi 的品牌字形）是希腊字母，`char::is_alphanumeric` 挡不住它，
    // 而一个字符不携带任何会话主题信息。这是挡 `π` 的唯一板子。
    if stripped.chars().count() < MIN_TITLE_CHARS || !stripped.chars().any(char::is_alphanumeric) {
        return None;
    }
    let lower = stripped.to_lowercase();
    if is_status_word(&lower)
        || is_terminal_default(&lower)
        || is_cwd_like(&stripped)
        || is_identity_echo(&lower, agent_id)
    {
        return None;
    }
    Some(stripped)
}

/// 剥掉 agent 前置在标题上的状态装饰（品牌字形 / spinner / 工作前缀）。
fn strip_decoration(text: &str) -> &str {
    let mut rest = text.trim_start();
    loop {
        let Some(ch) = rest.chars().next() else {
            return rest;
        };
        if is_decoration(ch) {
            rest = rest[ch.len_utf8()..].trim_start();
            continue;
        }
        let Some(tail) = WORK_PREFIXES
            .iter()
            .find_map(|prefix| rest.strip_prefix(prefix))
        else {
            return rest;
        };
        rest = tail.trim_start();
    }
}

fn is_decoration(ch: char) -> bool {
    BRAND_GLYPHS.contains(&ch)
        || SPINNER_RANGES
            .iter()
            .any(|&(lo, hi)| (lo..=hi).contains(&ch))
}

/// 纯状态词，允许带括号上下文（`idle (2m)`）。
fn is_status_word(text: &str) -> bool {
    let trimmed = text.trim();
    if STATUS_PHRASES.contains(&trimmed) {
        return true;
    }
    let head = trimmed.split(['(', '-', '·']).next().unwrap_or("").trim();
    STATUS_WORDS.contains(&head)
}

/// `Terminal 3` 这类默认标题：会话还没被命名过。
fn is_terminal_default(lower: &str) -> bool {
    let Some(rest) = lower.strip_prefix(TERMINAL_DEFAULT_PREFIX) else {
        return false;
    };
    !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit())
}

/// cwd 形态的标题（无 hook 的 agent 走 SSH 时常把 spinner + cwd 写进标题）。
fn is_cwd_like(text: &str) -> bool {
    if text.starts_with('/') || text.starts_with('~') || text.starts_with("\\\\") {
        return true;
    }
    let bytes = text.as_bytes();
    if bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
    {
        return true;
    }
    // 单个 path-ish token（`orca/workspaces`）仍是 cwd，不是名字。
    !text.contains(char::is_whitespace) && text.contains(['/', '\\'])
}

/// 身份回显：标题就是 agent 自己的名字，可带一个状态后缀。
///
/// 这类帧出现在 idle 时（`Claude Code`、`pi`），不携带任何会话主题信息；而 agent 名
/// 正是本任务从占位标题里删掉的那个字符串，不能从 OSC 通道绕回来。
///
/// 比较用归一形态（小写、非字母数字→空格、折叠），于是 `claude-code` ≡ `Claude Code`。
fn is_identity_echo(title_lower: &str, agent_id: Option<&str>) -> bool {
    let Some(agent_id) = agent_id else {
        return false;
    };
    let title = normalize_token(title_lower);
    if title.is_empty() {
        return false;
    }
    identity_aliases(agent_id).iter().any(|alias| {
        if &title == alias {
            return true;
        }
        let Some(rest) = title.strip_prefix(alias.as_str()) else {
            return false;
        };
        let rest = rest.trim_start_matches(['-', '·', ':', ' ']);
        !rest.is_empty() && is_status_word(rest)
    })
}

/// agent slug 的归一形态，以及去掉 ` code` / ` cli` 后缀的短形态。
///
/// `claude-code` 的 OSC 标题是 `Claude Code`，而它的 idle 帧可能是 `Claude` —— 两个都要认。
fn identity_aliases(agent_id: &str) -> Vec<String> {
    let base = normalize_token(agent_id);
    if base.is_empty() {
        return Vec::new();
    }
    let mut aliases = vec![base.clone()];
    for suffix in ID_SUFFIXES {
        if let Some(short) = base.strip_suffix(suffix) {
            if !short.is_empty() {
                aliases.push(short.to_string());
            }
        }
    }
    aliases
}

/// 小写 + 非字母数字→空格 + 折叠空白。
fn normalize_token(text: &str) -> String {
    text.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
