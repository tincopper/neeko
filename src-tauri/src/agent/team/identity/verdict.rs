//! 同 cwd 归因裁决（design §5.4）。
//!
//! # 为什么需要这一层
//!
//! 共享工作区下**多个成员的 cwd 完全相同**。既有归因链（`ingest::attribution`）的第 2/3 级
//! 是 cwd 前缀 / basename —— 在团队场景里这两级**必然**把 A 的 `turn_completed` 判给 B。
//! 那不是「偶尔不准」，而是**串台**：队长会拿到别人的结果并认为它完成了。
//!
//! # 为什么宁丢一条通知，也不误归因
//!
//! | 失败方式 | 用户能否看见 | 代价 |
//! |---|---|---|
//! | 丢一条通知（拒归因） | 能 | 小、可见、可重试 |
//! | 记错账（回退 cwd） | **不能** | 大、不可见、会让人做错决定 |
//!
//! 可见的小损失优于不可见的大损失 —— 这是本模块的唯一产品立场。

use crate::agent::hooks::ingest::attribution::EnvHints;

/// 归因裁决。**三档，缺一不可** —— 少任何一档都会让某个真实形态落进错的兜底。
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AttributionVerdict {
    /// 完整成员身份：两个 env 都在。
    Accept {
        /// 团队 id。
        team_id: String,
        /// 成员 id。
        member_id: String,
    },
    /// 有团队上下文但身份残缺 → **拒绝归因**，不得回退 cwd 前缀。
    RefuseIncomplete,
    /// 非团队上下文（两个 env 都没有）→ 交给既有通知链路，行为逐字不变。
    NotTeamContext,
}

/// 由上报的 env 提示裁决这条事件该怎么归。
///
/// 四级判定（`空白串视同缺失` —— 与 `ingest::attribution` 对 `cwd` 的口径一致，
/// 因为 `NEEKO_TEAM_ID=""` 与「没设」在 shell 里产生于同一类误操作，且空串**不可能**
/// 是合法身份）：
///
/// | `team_id` | `team_member_id` | 裁决 |
/// |---|---|---|
/// | 有 | 有 | [`AttributionVerdict::Accept`] |
/// | 有 | 无 | [`AttributionVerdict::RefuseIncomplete`] |
/// | 无 | 有 | [`AttributionVerdict::RefuseIncomplete`] |
/// | 无 | 无 | [`AttributionVerdict::NotTeamContext`] |
#[must_use]
pub fn attribution_verdict(hints: &EnvHints) -> AttributionVerdict {
    let team_id = non_empty(hints.team_id.as_deref());
    let member_id = non_empty(hints.team_member_id.as_deref());
    match (team_id, member_id) {
        (Some(team_id), Some(member_id)) => AttributionVerdict::Accept {
            team_id: team_id.to_owned(),
            member_id: member_id.to_owned(),
        },
        // 两个残缺方向都要拒绝：只有 member 没有 team 时，连「哪个团队」都不知道，
        // 既不能校验归属，也不能写审计 —— 回退 cwd 就是纯粹的猜。
        (Some(_), None) | (None, Some(_)) => AttributionVerdict::RefuseIncomplete,
        (None, None) => AttributionVerdict::NotTeamContext,
    }
}

/// `Option<&str>` → 去空白后非空才算「有」。
fn non_empty(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|v| !v.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hints(team_id: Option<&str>, member_id: Option<&str>) -> EnvHints {
        EnvHints {
            team_id: team_id.map(str::to_owned),
            team_member_id: member_id.map(str::to_owned),
            ..EnvHints::default()
        }
    }

    /// 完整身份 → 接受，且原样带出（不做归一化：成员 id 含 `@`，任何改写都会找不到成员）。
    #[test]
    fn complete_identity_is_accepted_verbatim() {
        let verdict = attribution_verdict(&hints(Some("tm_1"), Some("w1@tm_1")));
        assert_eq!(
            verdict,
            AttributionVerdict::Accept {
                team_id: "tm_1".into(),
                member_id: "w1@tm_1".into(),
            }
        );
    }

    /// 只有 team（成员 env 丢失，典型 = 旧模板 / 配置被覆盖）→ 拒绝。
    ///
    /// 保护的不变量：**不得**回退到 cwd 前缀（design §5.4 —— 同 cwd 会串台）。
    #[test]
    fn team_without_member_is_refused() {
        assert_eq!(
            attribution_verdict(&hints(Some("tm_1"), None)),
            AttributionVerdict::RefuseIncomplete
        );
    }

    /// 只有 member（team env 丢失）→ 同样拒绝：身份残缺的方向不影响裁决。
    #[test]
    fn member_without_team_is_refused() {
        assert_eq!(
            attribution_verdict(&hints(None, Some("w1@tm_1"))),
            AttributionVerdict::RefuseIncomplete
        );
    }

    /// 非团队上下文（普通用户终端里的 CLI）→ 现状行为，交给既有通知链路。
    #[test]
    fn no_team_env_is_not_team_context() {
        assert_eq!(
            attribution_verdict(&hints(None, None)),
            AttributionVerdict::NotTeamContext
        );
    }

    /// 空白串视同缺失（`export NEEKO_TEAM_ID=` 的形态）。
    ///
    /// 保护的不变量：空串不能被当成合法身份 —— 否则 `Accept{team_id: ""}` 会让
    /// 「团队归属校验」永远失败，错误信息还会指向一个不存在的团队。
    #[test]
    fn blank_values_are_treated_as_missing() {
        assert_eq!(
            attribution_verdict(&hints(Some("  "), Some("\t"))),
            AttributionVerdict::NotTeamContext
        );
        assert_eq!(
            attribution_verdict(&hints(Some("tm_1"), Some("   "))),
            AttributionVerdict::RefuseIncomplete
        );
    }
}
