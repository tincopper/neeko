//! 成员 token 的签发与解析（design §3.1）。
//!
//! # 两个关键裁决
//!
//! 1. **只落 hash**：`TeamMember.token_hash` 存 [`hash_token`] 的结果，明文只在下发的
//!    MCP 配置里出现一次。
//! 2. **解析靠查表，不靠比较**：见 [`resolve_principal`] 的长注释 —— 那里写着
//!    「为什么这里没有恒定时间比较」，以及为什么**将来也不许加回**。
//!    这不是风格选择：`server/gate.rs` 的不变量是「进程内恒定时间比较的**调用点唯一**」。
//!    （本文件的源码自检会拒绝那两个原生语的名字出现 —— 连文档里都不许写。）

// token 签发与解析（design §3.1）
// ═══════════════════════════════════════════════════════════════════

/// 签发一个新的成员 token（uuid v4 的 32 位十六进制，无连字符）。
///
/// 用 uuid 而不是随机数生成器：全仓已有 `uuid` 依赖且终端会话 id 也用它，
/// 新增一个 RNG 依赖只会多一处需要审计的熵源。
#[must_use]
pub fn new_token() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

/// token 的 sha256 十六进制摘要（小写，64 字符）。
///
/// 写法与 `library::skill::content_hash` 同源（`Sha256` + `hex::encode`）：
/// 全仓只有一种摘要风格，凭据与内容哈希才可能被同一套工具审计。
#[must_use]
pub fn hash_token(token: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

/// 按 **hash 查表** 解析调用主体。
///
/// `principals` 的 key 必须是 [`hash_token`] 的结果（`team_spawn` 写库时就是这样存的）；
/// `presented` 是请求带来的明文 token。
///
/// # 为什么这里**没有**恒定时间比较（将来也不许加）
///
/// `server/gate.rs` 的不变量是「进程内恒定时间比较的调用点 = 1」—— 那是**单 token** 时代的
/// 形状：候选字节与期望字节直接比，任何时间差异都会泄漏期望 token 的前缀。
///
/// 多 token → 主体的场景换了一个形状：**先把明文 sha256，再用 map key 查表**。
/// 于是「被比较的两侧」是 `hash(攻击者给的 token)` 与 `hash(正确 token)`：
///
/// - 攻击者**无法构造**打算参与比较的那个 key —— 他只能提交 token，摘要由我们算；
/// - 比较时序最多泄漏**摘要**的前缀，而从摘要前缀到 token 需要原像攻击（sha256 的
///   已知前提里不含这一条）。
///
/// 所以再加一层恒定时间比较是**纯粹的噪声**：它会让 `gate.rs` 的「调用点 = 1」
/// 不变量失效（两个地方都在「做安全的样子」），而安全性一点没增加。
/// 护栏：`token_tests::module_contains_no_constant_time_comparison` 会读本文件源码
/// 断言这里没有悄悄加回比较原语。
///
/// 空白串一律 `None`（`+ trim` 后为空）：空串不可能由 [`new_token`] 产出，
/// 放它进查表只会把「没带 token」伪装成「token 不对」。
#[must_use]
pub fn resolve_principal<'a>(
    principals: &'a std::collections::HashMap<String, crate::agent::team::types::TeamPrincipal>,
    presented: &str,
) -> Option<&'a crate::agent::team::types::TeamPrincipal> {
    // 空 / 空白 一律拒绝：空串不可能由 [`new_token`] 产出，放它进查表
    // 只会把「没带 token」伪装成「token 不对」。
    if presented.trim().is_empty() {
        return None;
    }
    // 先摘要，再**用哈希作 key 查表**（不是与任何明文比较）。
    principals.get(&hash_token(presented))
}

#[cfg(test)]
mod token_tests {
    use super::*;
    use crate::agent::team::types::{AdmissionTier, MemberRole, TeamPrincipal, WorkerChannel};
    use std::collections::HashMap;

    fn principal(team_id: &str, member_id: &str) -> TeamPrincipal {
        TeamPrincipal {
            team_id: team_id.into(),
            member_id: member_id.into(),
            role: MemberRole::Worker,
            channel: WorkerChannel::Mcp,
            tier: AdmissionTier::A,
        }
    }

    /// 模拟「签发后落库」的那张表：key = `hash_token(明文)`。
    fn table(entries: &[(&str, TeamPrincipal)]) -> HashMap<String, TeamPrincipal> {
        entries
            .iter()
            .map(|(token, principal)| (hash_token(token), principal.clone()))
            .collect()
    }

    /// `hash_token` 稳定、定长、彼此不同（sha256 hex 口径）。
    ///
    /// 保护的不变量：hash 是**落库的唯一凭据形态**（明文只下发一次）。同一 token
    /// 两次摘要不同 → 重启后所有成员 token 失效；长度不是 64 → 落库列被静默截断。
    #[test]
    fn hash_token_is_stable_hex_and_distinct() {
        let a = new_token();
        let b = new_token();
        assert_ne!(a, b, "两次签发必须不同");

        let ha = hash_token(&a);
        assert_eq!(ha, hash_token(&a), "同一 token 必须摘要稳定");
        assert_eq!(ha.len(), 64, "sha256 hex 必须是 64 字符");
        assert!(
            ha.chars()
                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()),
            "{ha} 不是小写十六进制"
        );
        assert_ne!(ha, hash_token(&b), "不同 token 必须摘要不同");
        // 与 `library::skill::content_hash` 同风格：hex 小写、无前缀。
        assert!(!ha.starts_with("sha256:"));
    }

    /// 签发的 token 是 32 位十六进制（uuid v4 simple 形态），可直接塞进 env / header。
    #[test]
    fn issued_tokens_are_compact_hex() {
        let token = new_token();
        assert_eq!(token.len(), 32, "{token} 不是 uuid simple 形态");
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()), "{token}");
        assert!(!token.contains('-'), "{token} 不应带连字符");
    }

    /// 签发 → hash 入表 → 解析命中，且带出的是**权威行**的角色与团队。
    ///
    /// 保护的不变量：design §3.1 的「多 token → 主体」。角色必须来自落库行而不是
    /// 请求（否则成员可以自证自己是队长）。
    #[test]
    fn issued_token_resolves_through_the_hash_table() {
        let token = new_token();
        let expected = principal("tm_1", "w1@tm_1");
        let principals = table(&[(&token, expected.clone())]);

        let resolved = resolve_principal(&principals, &token).expect("合法 token 必须命中");
        assert_eq!(resolved, &expected);

        let lead_token = new_token();
        let mut lead = principal("tm_1", "lead@tm_1");
        lead.role = MemberRole::Lead;
        let principals = table(&[(&lead_token, lead.clone())]);
        assert_eq!(resolve_principal(&principals, &lead_token), Some(&lead));
    }

    /// 错 token / 空串 / 空白串 → `None`（不是「回退成某个默认主体」）。
    ///
    /// 保护的不变量：**不存在**匿名主体。空串尤其危险：`+ trim` 后为空一律拒绝，
    /// 否则「没带 header」会被当成「token 是空串并且恰好命中」。
    #[test]
    fn wrong_or_empty_token_resolves_to_none() {
        let token = new_token();
        let principals = table(&[(&token, principal("tm_1", "w1@tm_1"))]);

        assert!(resolve_principal(&principals, "not-the-token").is_none());
        assert!(resolve_principal(&principals, "").is_none());
        assert!(resolve_principal(&principals, "   ").is_none());
        assert!(resolve_principal(&principals, "\t").is_none());
        // 旧 token（重新签发后）必须失效。
        let rotated = new_token();
        assert!(resolve_principal(&principals, &rotated).is_none());
        // 空表 → 任何 token 都解析不出。
        assert!(resolve_principal(&HashMap::new(), &token).is_none());
    }

    /// 两个团队的同名成员不互相命中（token 是唯一键，不是 (team, name)）。
    ///
    /// 保护的不变量：`member_id` 里的 `@tm_x` 后缀**不参与**解析 —— 否则「tm_1 的 w1」
    /// 拿到「tm_2 的 w1」的 token 也能通过（跨队越权）。
    #[test]
    fn same_member_name_in_two_teams_does_not_collide() {
        let token_a = new_token();
        let token_b = new_token();
        let principals = table(&[
            (&token_a, principal("tm_1", "w1@tm_1")),
            (&token_b, principal("tm_2", "w1@tm_2")),
        ]);

        let a = resolve_principal(&principals, &token_a).unwrap();
        let b = resolve_principal(&principals, &token_b).unwrap();
        assert_eq!(a.team_id, "tm_1");
        assert_eq!(b.team_id, "tm_2");
        assert_ne!(a.member_id, b.member_id);
    }

    /// 源码级护栏：本文件**不得**引入恒定时间比较原语。
    ///
    /// `server/gate.rs` 的不变量是「进程内比较调用点 = 1」。多 token 解析走
    /// 「sha256 后查表」的形状（见 [`resolve_principal`] 的注释），加回比较既不增加
    /// 安全性，又会把那条不变量变成假的。
    ///
    /// 用 `concat!` 拼接被禁字面量，是为了让**本测试自身的源码**不包含被禁字符串
    /// （否则断言会命中自己）。别把它「简化」成一个完整字面量。
    #[test]
    fn module_contains_no_constant_time_comparison() {
        let source = include_str!("token.rs");
        for needle in [concat!("c", "t_eq"), concat!("sub", "tle")] {
            assert!(
                !source.contains(needle),
                "identity.rs 里出现了恒定时间比较原语 `{needle}` —— \
                 该比较属于 gate.rs（调用点必须保持为 1）"
            );
        }
    }
}
