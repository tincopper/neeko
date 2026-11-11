//! 标题**候选**：原始素材 + 来源标签，**尚未判决**。
//!
//! # 为什么需要它（把观测与判决分开）
//!
//! 每个 CLI 都有自己的「可能算标题」的字段（Claude 的 `aiTitle`、Codex 的 `thread_name`、
//! 首条用户消息、hook 里的 `prompt`…）。这些是**观测**：易腐、per-CLI、必然 N 份。
//! 而「这串字配不配当标题」是**判决**：只有一套判据（[`super::admit`]）。
//!
//! 没有这层值时，两个消费者会各自发明判决：
//!
//! ```text
//! 实时侧栏：admit(Native, raw)        —— 认身份回显 / Terminal N / cwd 形态，一律判负
//! 历史列表：normalize_session_text    —— 只做文本净化，上面三种全放行
//! ```
//!
//! 实测后果：同一台机器上侧栏拒绝 `claude` 当标题，历史列表却把两条会话显示成 `claude`。
//! 所以适配器/缓存只允许按「来源 + 原文」上报候选，判决一律过 [`admit_candidates`]。

use super::{admit, TitleSource};

/// 一条候选标题（**原始素材**，未经任何净化或判决）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TitleCandidate<'a> {
    /// 用户改名（自动来源永不覆盖）。
    User(&'a str),
    /// CLI 自己写下的会话名 / AI 标题 / hook 上报的会话主题。
    CliNative(&'a str),
    /// 首条用户意图行（chat prompt、纯 shell 首条命令、hook 的 `prompt` 字段）。
    Prompt(&'a str),
}

impl TitleCandidate<'_> {
    /// 该候选的来源（判据与覆盖序都按它分派）。
    #[must_use]
    pub const fn source(&self) -> TitleSource {
        match self {
            Self::User(_) => TitleSource::User,
            Self::CliNative(_) => TitleSource::Native,
            Self::Prompt(_) => TitleSource::Prompt,
        }
    }

    /// 原始文本（判据内部再净化，调用方不得预先裁剪）。
    #[must_use]
    pub const fn raw(&self) -> &str {
        match self {
            Self::User(text) | Self::CliNative(text) | Self::Prompt(text) => text,
        }
    }
}

/// 按**给定顺序**取第一条通过 [`admit`] 的候选（调用方负责把候选按质量序排好）。
///
/// 返回 `None` 表示「这些候选都不携带会话主题」—— 调用方据此落到兜底标签，**不要**
/// 自己再挑一条：那等于绕过判据。
#[must_use]
pub fn admit_candidates<'a>(
    candidates: impl IntoIterator<Item = TitleCandidate<'a>>,
    agent_id: Option<&str>,
) -> Option<String> {
    candidates
        .into_iter()
        .find_map(|candidate| admit(candidate.source(), candidate.raw(), agent_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 来源映射与 `Ord` 质量序一致（顺序错了会让 `should_upgrade` 静默反向）。
    #[test]
    fn candidate_sources_follow_the_quality_order() {
        assert_eq!(TitleCandidate::Prompt("x").source(), TitleSource::Prompt);
        assert_eq!(TitleCandidate::CliNative("x").source(), TitleSource::Native);
        assert_eq!(TitleCandidate::User("x").source(), TitleSource::User);
        assert!(TitleCandidate::User("x").source() > TitleCandidate::CliNative("x").source());
    }

    /// 第一条不合格就顺延到下一条（历史列表的 P2 → P3 阶梯就是这条）。
    #[test]
    fn falls_through_rejected_candidates_in_order() {
        let empty = TitleCandidate::CliNative("   ");
        let identity = TitleCandidate::CliNative("claude");
        let real = TitleCandidate::Prompt("帮我修一下登录跳转的竞态");
        assert_eq!(
            admit_candidates([empty, identity, real], Some("claude-code")).as_deref(),
            Some("帮我修一下登录跳转的竞态"),
            "身份回显与空白都必须判负后顺延"
        );
    }

    /// 全部被判负 ⇒ `None`（调用方落兜底标签，不得自己挑一条）。
    #[test]
    fn rejects_every_candidate_that_carries_no_topic() {
        assert!(admit_candidates(
            [
                TitleCandidate::CliNative("Terminal 3"),
                TitleCandidate::CliNative("/Users/x/neeko"),
                TitleCandidate::Prompt("/clear"),
            ],
            None,
        )
        .is_none());
    }
}
