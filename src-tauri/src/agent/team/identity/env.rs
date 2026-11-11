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

/// 成员**凭证** env：那一族的 CLI（`bearer_token_env_var`）从环境变量读 token。
///
/// # 为什么它必须是一个常量（而写两个字面量就会出错）
///
/// 同一个名字要在**三处**重合：① 启动参数模板里的 `{{token_env}}`（渲染出来是这个名字）；
/// ② 子进程 env 的 key（`SpawnPlan::credentials_env`）；③ 端点读的 header 值
/// （由 CLI 自己加进 header）。任一处靠手写字面量，错误形态都是"成员起来了但 401"，
/// 而 401 在花名册上与"成员偷懒"无法区分。
///
/// 与 [`TEAM_ID_ENV`] / [`TEAM_MEMBER_ID_ENV`] 分开写，是因为**含义不同**：那两条是身份
/// （可以进 `/proc/<pid>/environ` 也无害），这一条是凭证明文（进 env 是一次有意的例外，
/// 见 `SpawnPlan::credentials_env` 的文档）。
pub const TEAM_TOKEN_ENV: &str = "NEEKO_TEAM_TOKEN";

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

    /// 凭证 env 的名字是**协议**：渲染进 `--bearer-token-*` 的那个名字、子进程 env 的 key、
    /// 端点读到的 header 值三者同源。改名要同时改三处，所以在这里钉住字面量。
    #[test]
    fn the_token_env_name_is_pinned_and_distinct_from_the_identity_env() {
        assert_eq!(TEAM_TOKEN_ENV, "NEEKO_TEAM_TOKEN");
        assert_ne!(TEAM_TOKEN_ENV, TEAM_ID_ENV);
        assert_ne!(TEAM_TOKEN_ENV, TEAM_MEMBER_ID_ENV);
        // 身份 env **不含**凭证（`member_env` 的两个键里不许出现它）。
        let env = member_env("tm_1", "w1@tm_1");
        assert!(
            env.iter().all(|(key, _)| key != TEAM_TOKEN_ENV),
            "凭证必须走 `credentials_env`，不能混进身份 env：{env:?}"
        );
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
