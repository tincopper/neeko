//! 身份表：`token hash → TeamPrincipal`（团队 MCP 端点的**唯一**身份源）。
//!
//! # 为什么从**库**组装而不是从内存镜像
//!
//! 凭证是**落库**的事实（`team_member.token_hash`），而内存镜像只为状态迁移服务。
//! 端点重启、团队重开、成员轮换凭证之后，只有库里那一份是对的 —— 从镜像组装会把
//! 已经失效的凭证留在门上（或者让新凭证进不来）。
//!
//! # 为什么键是 hash
//!
//! 落库只存 `sha256`、明文只在 spawn 时下发一次（design §3.1）。所以门与身份表都只
//! 认 hash：门拿到请求头里的明文后先摘要再比较（`server::AuthGate::with_shared_hashed_tokens`），
//! handler 再拿同一个 hash 查这张表取主体。两侧**同一个 key**，不存在第二套编码。
//!
//! # 空 hash 必须被过滤
//!
//! `team_spawn` 落库时 `token_hash` 是**空串**（凭证由执行层签发，见 `TeamManager::issue_token`）。
//! 空串进表的后果不是"多一条无害记录"：它是**一把空钥匙** —— 任何能把 header 值写成空串的
//! 请求都会命中它。所以这里显式跳过，并在测试里钉住。

use std::collections::HashMap;

use crate::agent::team::manager::TeamManager;
use crate::agent::team::types::TeamPrincipal;
use crate::common::error::AppError;

/// 从已落库的团队 / 成员行组装身份表。
///
/// 键 = `member.token_hash`（明文摘要），值 = 该成员的主体。
///
/// 返回 `Err` 只在**读库失败**时出现：那意味着端点无法确定"谁能进来"，宁可启动失败
/// 也不要放一个空表进去（空表 = 谁都进不来，看起来像"所有人都没权限"）。
pub fn principals_from(manager: &TeamManager) -> Result<HashMap<String, TeamPrincipal>, AppError> {
    let mut principals = HashMap::new();
    for team in manager.store().list_teams()? {
        for member in manager.store().list_members(&team.id)? {
            // 空 hash = 凭证尚未签发 ⇒ 不可认证（见模块文档）。
            if member.token_hash.is_empty() {
                continue;
            }
            principals.insert(
                member.token_hash.clone(),
                TeamPrincipal {
                    team_id: member.team_id.clone(),
                    member_id: member.id.clone(),
                    role: member.role,
                    channel: member.channel,
                    tier: member.tier,
                },
            );
        }
    }
    Ok(principals)
}

/// 门要装载的**期望值集合** = 身份表的键（已排序：门的遍历顺序不该随 HashMap 抖动）。
///
/// 与 [`principals_from`] 同源是刻意的：门放行谁、handler 认成谁，必须来自同一份表，
/// 否则会出现"门放行了但查不到主体"（表现为 200 + 空主体）或反之。
#[must_use]
pub fn token_hashes(principals: &HashMap<String, TeamPrincipal>) -> Vec<String> {
    let mut hashes: Vec<String> = principals.keys().cloned().collect();
    hashes.sort_unstable();
    hashes
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use axum::http::HeaderMap;

    use super::*;
    use crate::agent::team::fixtures::{fixture_member, fixture_team, TEAM, W1};
    use crate::agent::team::identity;
    use crate::agent::team::mcp::TOKEN_HEADER;
    use crate::agent::team::store::TeamStore;
    use crate::agent::team::types::{MemberRole, TeamMember};
    use crate::server::{AuthGate, HeaderToken, SharedTokenSet};

    const W2: &str = "w2@tm_1";

    /// 一个团队 + 三名成员：lead（已签发）、worker（已签发）、worker（**未**签发）。
    fn seeded() -> TeamManager {
        let manager = TeamManager::new(TeamStore::open_in_memory().expect("in-memory store"));
        manager
            .create_team(fixture_team(TEAM))
            .expect("create_team");
        manager
            .add_member(TeamMember {
                role: MemberRole::Lead,
                token_hash: identity::hash_token("lead-token"),
                ..fixture_member("lead@tm_1", TEAM)
            })
            .expect("lead");
        manager
            .add_member(TeamMember {
                token_hash: identity::hash_token("w1-token"),
                ..fixture_member(W1, TEAM)
            })
            .expect("w1");
        manager
            .add_member(TeamMember {
                token_hash: String::new(),
                ..fixture_member(W2, TEAM)
            })
            .expect("w2");
        manager
    }

    /// 已签发的成员进表，**空 hash 的不进**（否则那是一把空钥匙）。
    #[test]
    fn only_members_with_a_credential_are_admitted() {
        let principals = principals_from(&seeded()).expect("principals");
        assert_eq!(principals.len(), 2, "空 hash 的成员不得进表");

        let w1 = principals
            .get(&identity::hash_token("w1-token"))
            .expect("w1 必须在表里");
        assert_eq!(w1.member_id, W1);
        assert_eq!(w1.team_id, TEAM);
        assert_eq!(w1.role, MemberRole::Worker);
        assert_ne!(w1.channel, crate::agent::team::types::WorkerChannel::None);

        assert!(
            !principals.contains_key(""),
            "空串是一把空钥匙：任何空 header 都会命中它"
        );
        assert_eq!(principals.get(&identity::hash_token("w2-token")), None);
    }

    /// 门与身份表**同源**：注册的是 hash，能过的是明文 —— 端到端的 C7-A 形态。
    ///
    /// 反例（本用例挡的正是它）：把握在手里的 hash 当 token 送进来，必须失败。
    #[test]
    fn a_gate_built_from_the_principal_table_accepts_the_issued_token() {
        let manager = seeded();
        let principals = principals_from(&manager).expect("principals");
        let gate = AuthGate::with_shared_hashed_tokens(
            SharedTokenSet::new(token_hashes(&principals)),
            vec![Arc::new(HeaderToken { name: TOKEN_HEADER })],
        );

        let authorised = |value: &str| {
            let mut headers = HeaderMap::new();
            headers.insert(TOKEN_HEADER, value.parse().expect("header value"));
            gate.authorize(&headers)
        };

        assert!(authorised("w1-token"), "明文必须能过");
        assert!(!authorised("stale-token"), "错 token 必须拒");
        assert!(
            !authorised(&identity::hash_token("w1-token")),
            "把 hash 当 token 送进来必须失败 —— 否则落库的 hash 就是可用凭证"
        );
        assert!(!gate.authorize(&HeaderMap::new()), "缺 header 必须拒");
    }

    /// 一个用给定 manager 组装的「门 + 判定闭包」（与 handler 侧同一份表）。
    fn gate_for(manager: &TeamManager) -> impl Fn(&str) -> bool {
        let principals = principals_from(manager).expect("principals");
        let gate = AuthGate::with_shared_hashed_tokens(
            SharedTokenSet::new(token_hashes(&principals)),
            vec![Arc::new(HeaderToken { name: TOKEN_HEADER })],
        );
        move |value: &str| {
            let mut headers = HeaderMap::new();
            headers.insert(TOKEN_HEADER, value.parse().expect("header value"));
            gate.authorize(&headers)
        }
    }

    /// **关掉的成员立即失效**：归档清空 `token_hash` ⇒ 表里没有它 ⇒ 旧明文过不了门。
    ///
    /// 这是「成员进 `Dead` 之后旧 token 还能不能用」的判据。答案曾经是「能」——
    /// `principals_from` 只看 hash 是否为空，与成员状态无关，所以一个被杀掉的成员仍然
    /// 能继续调工具（包括 `team_close`）。清 hash 因此**必须**发生在归档的那一步。
    #[test]
    fn closing_a_member_revokes_its_credential_before_the_gate_is_rebuilt() {
        let manager = seeded();
        assert!(gate_for(&manager)("w1-token"), "关闭前必须能用");

        manager.finish_member_close(W1, 1_000).expect("close");

        assert!(
            !gate_for(&manager)("w1-token"),
            "关闭后旧明文必须过不了门（否则归档只是改了个状态字段）"
        );
        assert!(
            principals_from(&manager)
                .expect("principals")
                .values()
                .all(|principal| principal.member_id != W1),
            "身份表里不得再有这个成员"
        );
        // 别人不受影响：一把钥匙的作废不得顺手作废全队。
        assert!(gate_for(&manager)("lead-token"));
    }

    /// 反例（本条证明上一条的**必要性**）：只落 `Dead` 不改 hash 的成员仍然**能用**旧凭证。
    ///
    /// 这不是「期望行为」，而是当前身份表的真实语义 —— 把它写成用例，是为了让
    /// 「为什么必须在归档时清 hash」无法被当成冗余动作删掉。
    #[test]
    fn a_member_that_died_without_being_archived_still_holds_a_usable_credential() {
        let manager = seeded();
        manager
            .observe_signal(W1, crate::agent::team::types::MemberSignal::Exited, 1_000)
            .expect("signal");

        assert_eq!(
            manager.member(W1).expect("member").state,
            crate::agent::team::types::MemberState::Offline
        );
        assert!(
            gate_for(&manager)("w1-token"),
            "L4 进程死亡不撤凭证：作废只发生在 `finish_member_close`（单成员 / 整队关闭）"
        );
    }

    /// 轮换立即生效：签发新凭证后旧明文不再能过门（表从库重建）。
    #[test]
    fn rotating_a_credential_invalidates_the_previous_plaintext() {
        let manager = seeded();
        let rotated = manager.issue_token(W1, 1_000).expect("rotate");

        let principals = principals_from(&manager).expect("principals");
        let gate = AuthGate::with_shared_hashed_tokens(
            SharedTokenSet::new(token_hashes(&principals)),
            vec![Arc::new(HeaderToken { name: TOKEN_HEADER })],
        );
        let authorised = |value: &str| {
            let mut headers = HeaderMap::new();
            headers.insert(TOKEN_HEADER, value.parse().expect("header value"));
            gate.authorize(&headers)
        };

        assert!(authorised(&rotated), "新明文必须能过");
        assert!(!authorised("w1-token"), "旧明文必须失效");
    }
}
