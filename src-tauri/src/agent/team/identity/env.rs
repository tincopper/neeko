//! 注入给成员 PTY 的身份 env。
//!
//! # 单一源
//!
//! env 名的常量**只在这里定义**；注入侧（`team_spawn`）必须调 [`member_env`]，
//! 上报侧的字段名由 `hooks::ingest::attribution::EnvHints` 承载 —— 两侧因此不可能漂移。
//!
//! # 为什么返回 `Vec` 而不是 `HashMap`
//!
//! 调用方（`create_session` 的 env 列表）需要**稳定顺序**，且同名重复项要能被发现，
//! 而不是被静默覆盖。

/// 成员身份 env：团队 id。**常量只在这里定义**（注入与测试断言同源）。
pub const TEAM_ID_ENV: &str = "NEEKO_TEAM_ID";

/// 成员身份 env：成员 id（`{name}@{team}`，见 `TeamMember.id`）。
pub const TEAM_MEMBER_ID_ENV: &str = "NEEKO_TEAM_MEMBER_ID";

/// 注入到成员 PTY 的 env（与既有 `NEEKO_SESSION_ID` / `NEEKO_PROJECT_ID` 并列）。
///
/// 返回 `Vec<(String, String)>` 而不是 `HashMap`：调用方（`create_session` 的 env 列表）
/// 需要**稳定顺序**，且同名重复项要能被发现，而不是被静默覆盖。
#[must_use]
pub fn member_env(team_id: &str, member_id: &str) -> Vec<(String, String)> {
    vec![
        (TEAM_ID_ENV.to_owned(), team_id.to_owned()),
        (TEAM_MEMBER_ID_ENV.to_owned(), member_id.to_owned()),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// env 名与常量同源（注入侧与断言侧不可能漂移）。
    #[test]
    fn member_env_keys_come_from_the_constants() {
        let env = member_env("tm_1", "w1@tm_1");
        assert_eq!(env.len(), 2);
        assert_eq!(env[0].0, TEAM_ID_ENV);
        assert_eq!(env[0].1, "tm_1");
        assert_eq!(env[1].0, TEAM_MEMBER_ID_ENV);
        assert_eq!(env[1].1, "w1@tm_1");
        // 断言常量字面量本身（改名即改协议 —— 上报模板与 PTY 注入是同一契约的两端）。
        assert_eq!(TEAM_ID_ENV, "NEEKO_TEAM_ID");
        assert_eq!(TEAM_MEMBER_ID_ENV, "NEEKO_TEAM_MEMBER_ID");
    }

    /// 顺序稳定：调用方按列表注入 env，覆盖顺序会让同名项被静默吞掉。
    #[test]
    fn member_env_order_is_stable() {
        let a = member_env("t", "m");
        let b = member_env("t", "m");
        assert_eq!(a, b);
        assert_eq!(a[0].0, TEAM_ID_ENV, "team 在前，member 在后");
    }
}
