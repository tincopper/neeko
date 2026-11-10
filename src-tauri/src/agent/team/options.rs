//! 团队的**只读可选项面**：这个队允许谁能当成员、还能加几个、缺省值是什么。
//!
//! # 为什么要有它（用户的真实缺口）
//!
//! 团队组成过去无处配置：`team_spawn.agent_id` 是自由字符串，队长只能从**报错信息**里
//! 学到哪些 CLI 可用；`model` / `approval_policy` / `workspace` 缺省时没有来源。于是
//! 「哪些 CLI 能进这个队」这件事既不在面板里、也不在工具面里，只在一次失败的调用之后。
//!
//! 本模块把那件事变成一个**可读的载荷**（[`TeamOptions`]），而配置本身存在 `team` 行上
//! （见 [`crate::agent::team::types::TeamConfig`]）——**同一份事实三处消费**：
//!
//! | 消费者 | 用法 |
//! | --- | --- |
//! | 面板（`commands::team_options`） | 建队前展示可选项（`team_id = None`）、建队后展示该队的实际配置 |
//! | 队长（MCP 工具 `team_options`） | 派活前读「我能选谁 / 还能加几个 / 缺省是什么」 |
//! | `team_spawn` / 角色 preamble | **校验**池子与上限、**填**缺省、**只广告**池内的 CLI |
//!
//! # 一个纯函数，两个出口
//!
//! 核心是 [`options_for`]（无 I/O、无时钟、无 `AgentManager`）。两条读路径都调它 ——
//! 各自拼一份的话，「面板说有 3 个可选」与「队长读到 4 个」会同时自洽，而差别只在
//! 用户看不出因果的那一侧。
//!
//! # 与 `team_launchable_agents` 的分工（**不要合并**）
//!
//! | 面 | 回答的问题 | 与团队的关系 |
//! | --- | --- | --- |
//! | `team_launchable_agents` | **这台机器上**谁能当成员 | 无关（`AgentManager` 的全部已注册 CLI） |
//! | `team_options`（本文件） | **这个队**允许谁、还能加几个、缺省是什么 | 该 `team` 行 |
//!
//! 前者是准入事实（红线 15 的落点），后者是团队配置 **经** 准入事实解析后的结果。
//! 合并会把「配置」与「实测能力」压成一个字段，而它们的失败方式完全不同：一个是
//! 「改配置」，一个是「换 CLI 或升级 Neeko」。
//!
//! # 空池 = **不限制**
//!
//! `Team.allowed_agent_ids` 为空 ⇒ 每个可启动 CLI 都在池内。理由见
//! [`crate::agent::team::types::Team::allowed_agent_ids`]：入场不该强迫用户先勾选。
//! 读这一侧必须把它**解析**成实际清单再展示（[`resolved_pool`]）—— 把原始空数组
//! 交给队长，它会以为一个都不能 spawn。

use crate::agent::team::admission::{admitted_agent_ids, launchable_agents, LaunchableAgent};
use crate::agent::team::types::{ApprovalPolicy, MemberRole, Team, TeamConfig, Workspace};

/// 一个团队的可选项面（`team_options` 的载荷，MCP 与本地命令同形）。
///
/// 字段全部来自**数据**（团队行 + 准入表），没有任何一处是手抄的能力清单：
/// 档位、注入方式、旁路参数都在 `admission` 那一张表里，按 `agent_id` 查。
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamOptions {
    /// 实际可用的成员 CLI（**已按池子过滤、已剔除不能启动的**）。
    ///
    /// 行类型复用 [`LaunchableAgent`]（`{ agentId, refusal }`）：与面板的
    /// `team_launchable_agents` 同一个 `wire` 形状。这里的 `refusal` 恒为 `None` ——
    /// 能启动是这个列表的定义；保留那一列是为了让两个面在 TS 侧是**同一个类型**
    /// （镜像一次，而不是两份长得像的形状）。
    ///
    /// 档位（`tier`）**不在这里**：它是准入表推导出来的（`admission::tier_of`），
    /// 渲染 preamble 时现问一次。拷进这里就是同一件事实的第二份副本，而 CLI 升级后
    /// 旧副本会与新表漂移。
    pub members: Vec<LaunchableAgent>,
    /// 这个队的配置**解析后**的形态（空池已展开、默认值已就位）。
    pub defaults: TeamDefaults,
}

/// 团队配置的解析结果（`TeamOptions` 的另一半）。
///
/// 与 [`TeamConfig`] 的区别只有一个但很重要：这里的 `allowed_agent_ids` **永远是解析后的
/// 实际池子**（空池已展开成本机全部可启动 CLI），而 `TeamConfig` 里的空 vec 是「不限制」
/// 这个**配置意图**。把两者混用，读侧就会把「没限制」读成「一个都不许」。
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamDefaults {
    /// 解析后的实际池子（按 id 排序、去重；空池已展开）。
    pub allowed_agent_ids: Vec<String>,
    /// 成员未传 `model` 时的缺省；`None` = 该 CLI 自己的默认。
    pub default_model: Option<String>,
    /// 成员未传 `workspace` 时的缺省。
    pub default_workspace: Workspace,
    /// 成员未传 `approval_policy` 时的缺省。
    pub default_approval_policy: ApprovalPolicy,
    /// 成员未传 `persona` 时的缺省角色名（`None` = 无人设；存在性在 spawn 时判 ——
    /// 角色库是可编辑的，这里只表达团队行的**意图**）。
    pub default_persona: Option<String>,
    /// 成员上限（不含队长）。
    pub max_members: u32,
    /// 当前已有成员数（**不含队长**）：队长据此算「还能加几个」。
    pub member_count: u32,
}

impl TeamDefaults {
    /// 还能再加几个成员（已满 = 0）。
    ///
    /// 唯一的减法落点：`team_spawn` 的拒绝、面板的按钮置灰、队长自己的判断都问这里，
    /// 而不是各自写一遍 `member_count >= max_members`（三份比较必然会有一次写反）。
    #[must_use]
    pub const fn remaining(&self) -> u32 {
        self.max_members.saturating_sub(self.member_count)
    }
}

impl TeamConfig {
    /// 从已落库的团队行取出配置意图（空池仍然是空池 —— 解析在 [`resolved_pool`]）。
    #[must_use]
    pub fn of(team: &Team) -> Self {
        Self {
            allowed_agent_ids: team.allowed_agent_ids.clone(),
            default_model: team.default_model.clone(),
            default_workspace: team.default_workspace.clone(),
            default_approval_policy: team.default_approval_policy,
            default_persona: team.default_persona.clone(),
            role_hints: team.role_hints.clone(),
            max_members: team.max_members,
        }
    }
}

/// **唯一的**可选项推导（纯函数，无 I/O）。
///
/// - `team`：已落库的团队行（池 / 上限 / 默认值都在它上面）。
/// - `member_count`：当前成员数（**不含队长**），由调用方从 `TeamManager` 的花名册取。
///   放在参数位而不是在这里读库，是因为本模块要能被没有库、没有 `AppHandle` 的测试直驱。
#[must_use]
pub fn options_for(team: &Team, member_count: u32) -> TeamOptions {
    resolve(&TeamConfig::of(team), member_count)
}

/// **无团队上下文**的目录（面板建队前的可选项）：池子 = 全部可启动、默认值 = 全局默认。
///
/// 与 [`options_for`] 走同一个 `resolve`：「建队前的可选清单」与「建队后的实际清单」
/// 若各自拼一份，面板在用户勾完选项的那一刻会看到两份不同的答案。
#[must_use]
pub fn default_options(member_count: u32) -> TeamOptions {
    resolve(&TeamConfig::default(), member_count)
}

/// 配置 → 可选项面。池子解析与准入过滤都在这里，两个公开入口共用。
///
/// `defaults.allowed_agent_ids` 与 `members` 的 id 集合**恒等**（后者是前者的行形态）。
/// 两个字段都存在是因为它们回答两个问题：「允许谁」（一个字符串清单，`team_spawn` 的
/// 池子判据用它，错误信息也用它）与「谁能起、为什么」（行形态，面板渲染它）。派生关系
/// 是单向的 —— 从 `members` 取 id 就是唯一的写法，所以两者不会漂移（判据：
/// `the_pool_and_the_member_rows_are_the_same_ids`）。
fn resolve(config: &TeamConfig, member_count: u32) -> TeamOptions {
    // 准入过滤：`launchable_agents` 是面板那条命令的**同一个**函数（红线 15 的单一判据），
    // 所以「这里说能起、那里说不能」在结构上不可能发生。
    let members: Vec<LaunchableAgent> =
        launchable_agents(&candidate_ids(config), MemberRole::Worker)
            .into_iter()
            .filter(|row| row.refusal.is_none())
            .collect();
    TeamOptions {
        defaults: TeamDefaults {
            allowed_agent_ids: members.iter().map(|row| row.agent_id.clone()).collect(),
            default_model: config.default_model.clone(),
            default_workspace: config.default_workspace.clone(),
            default_approval_policy: config.default_approval_policy,
            default_persona: config.default_persona.clone(),
            max_members: config.max_members,
            member_count,
        },
        members,
    }
}

/// 配置意图 → 候选 id 清单（空池 = 本机全部已准入的 CLI）。
///
/// 排序去重：面板按这个顺序渲染，同一份配置两次读到两个顺序会让 diff 变成噪音。
fn candidate_ids(config: &TeamConfig) -> Vec<String> {
    let mut ids = if config.allowed_agent_ids.is_empty() {
        admitted_agent_ids()
    } else {
        config.allowed_agent_ids.clone()
    };
    ids.sort_unstable();
    ids.dedup();
    ids
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::team::admission::admission_for;
    use crate::agent::team::fixtures::{fixture_team, fixture_team_configured, TEAM};
    use crate::agent::team::types::DEFAULT_MAX_MEMBERS;

    /// 本机真能当成员的 CLI（准入表推导，不手抄；排序与 `candidate_ids` 一致）。
    fn launchable_ids() -> Vec<String> {
        let mut ids: Vec<String> = admitted_agent_ids()
            .into_iter()
            .filter(|id| admission_for(id).is_some_and(|row| row.launch_refusal().is_none()))
            .collect();
        ids.sort_unstable();
        ids
    }

    /// 空池 = **不限制**，且展示的必须是**解析后**的实际池子（不是原始空数组）。
    ///
    /// 保护的不变量：队长看到 `allowedAgentIds: []` 会以为一个都不能 spawn，于是它
    /// 要么放弃派活、要么去猜别的工具 —— 而实际上它什么都能 spawn。
    #[test]
    fn an_empty_pool_resolves_to_every_launchable_cli() {
        let options = options_for(&fixture_team(TEAM), 0);

        let expected = launchable_ids();
        assert_eq!(
            options.defaults.allowed_agent_ids, expected,
            "空池必须展开成本机全部可启动 CLI"
        );
        assert_eq!(
            options.members.len(),
            expected.len(),
            "成员行与池子是同一批 id"
        );
        assert!(
            options.members.iter().all(|row| row.refusal.is_none()),
            "不能启动的 CLI 不得出现在 members 里"
        );
        assert!(
            options
                .defaults
                .allowed_agent_ids
                .contains(&"claude-code".to_string()),
            "夹具环境下 claude-code 是可启动的：{:?}",
            options.defaults.allowed_agent_ids
        );
    }

    /// 非空池 = 只有列出的那些（其余一概不出现，包括在 `members` 里）。
    #[test]
    fn a_restricted_pool_hides_every_other_cli() {
        let team = fixture_team_configured(
            TEAM,
            &TeamConfig {
                allowed_agent_ids: vec!["pi".into()],
                ..TeamConfig::default()
            },
        );
        let options = options_for(&team, 0);

        assert_eq!(options.defaults.allowed_agent_ids, vec!["pi".to_string()]);
        assert_eq!(options.members.len(), 1);
        assert_eq!(options.members[0].agent_id, "pi");
        assert!(
            !options
                .members
                .iter()
                .any(|row| row.agent_id == "claude-code"),
            "池外的 CLI 不得出现在 members 里"
        );
    }

    /// 池子与成员行是**同一批 id**（派生关系单向：id 从行里取）。
    ///
    /// 两条字段回答两个问题（允许谁 / 谁能起），但它们必须是同一批人 —— 两边各算一次的话，
    /// 「`allowedAgentIds` 里有 X，但 `members` 里没有 X」会变成一条**看起来只是少一行**的
    /// 面板缺陷，而 `team_spawn` 会按另一份清单裁决。
    #[test]
    fn the_pool_and_the_member_rows_are_the_same_ids() {
        for config in [
            TeamConfig::default(),
            TeamConfig {
                allowed_agent_ids: vec!["pi".into(), "claude-code".into(), "pi".into()],
                ..TeamConfig::default()
            },
        ] {
            let options = options_for(&fixture_team_configured(TEAM, &config), 0);
            let mut ids: Vec<String> = options
                .members
                .iter()
                .map(|row| row.agent_id.clone())
                .collect();
            ids.sort_unstable();
            assert_eq!(options.defaults.allowed_agent_ids, ids);
            assert_eq!(
                ids, options.defaults.allowed_agent_ids,
                "去重必须两侧一致（重复配置项不得让池子变长）"
            );
        }
    }

    /// `team_options` **不是** `team_launchable_agents` 的副本：它按池子过滤。
    ///
    /// 保护的不变量（也是「不要合并两个面」的机器判据）：机器上能起的 CLI 比这个队允许的
    /// 多 —— 池子以外的那些必须**不出现**。若有人把这里改成「直接返回
    /// `launchable_agents(admitted_agent_ids())`」（即复制一份判据、忽略池子），这条会红。
    #[test]
    fn the_options_are_narrower_than_the_machine_catalogue() {
        let restricted = options_for(
            &fixture_team_configured(
                TEAM,
                &TeamConfig {
                    allowed_agent_ids: vec!["pi".into()],
                    ..TeamConfig::default()
                },
            ),
            0,
        );
        let machine = launchable_agents(&admitted_agent_ids(), MemberRole::Worker);

        assert!(
            machine.len() > restricted.members.len(),
            "夹具前提：机器上能当成员的 CLI 多于一个"
        );
        let machine_ids: Vec<&str> = machine.iter().map(|row| row.agent_id.as_str()).collect();
        assert!(
            machine_ids.contains(&"claude-code"),
            "机器清单里有 claude-code：{machine_ids:?}"
        );
        assert!(
            !restricted
                .members
                .iter()
                .any(|row| row.agent_id == "claude-code"),
            "池子外的 CLI 不得出现在 team_options 里"
        );
    }

    /// 配置的五个字段原样进入 `defaults`（没有一处被硬编码覆盖）。
    ///
    /// 用**全部偏离缺省**的值：池（非空）、model（Some）、workspace（ReadOnly）、
    /// approval（Bypass）、max（2）。任何一处改成常量，这条就会红。
    #[test]
    fn the_team_configuration_is_reported_verbatim() {
        let config = TeamConfig {
            allowed_agent_ids: vec!["pi".into()],
            default_model: Some("pi-default".into()),
            default_workspace: Workspace::ReadOnly,
            default_approval_policy: ApprovalPolicy::Bypass,
            default_persona: Some("研究员".into()),
            role_hints: Vec::new(),
            max_members: 2,
        };
        let options = options_for(&fixture_team_configured(TEAM, &config), 1);

        assert_eq!(
            options.defaults.default_model.as_deref(),
            Some("pi-default")
        );
        assert_eq!(options.defaults.default_workspace, Workspace::ReadOnly);
        assert_eq!(
            options.defaults.default_approval_policy,
            ApprovalPolicy::Bypass
        );
        assert_eq!(options.defaults.default_persona.as_deref(), Some("研究员"));
        assert_eq!(options.defaults.max_members, 2);
        assert_eq!(options.defaults.member_count, 1);
        assert_eq!(options.defaults.remaining(), 1, "还能加一个");
    }

    /// 无团队上下文的目录：池子 = 全部可启able、默认值 = 全局默认、成员数 = 0。
    ///
    /// 「建队前」与「建队后」必须是同一条推导：面板在用户勾选之后会拿到团队上下文，
    /// 两份各拼一次的清单会在那一刻跳变。
    #[test]
    fn the_pre_team_catalogue_is_the_default_configuration() {
        let catalogue = default_options(0);
        assert_eq!(catalogue.defaults, default_options(0).defaults);
        assert_eq!(catalogue.defaults.allowed_agent_ids, launchable_ids());
        assert_eq!(catalogue.defaults.max_members, DEFAULT_MAX_MEMBERS);
        assert_eq!(catalogue.defaults.member_count, 0);
        assert_eq!(catalogue.defaults.default_workspace, Workspace::default());
        assert_eq!(
            catalogue.defaults.default_approval_policy,
            ApprovalPolicy::default()
        );
        assert_eq!(catalogue.defaults.default_model, None);
    }

    /// 上限的减法只有一个落点：已满 = 0（不是负数、不是 `None`）。
    #[test]
    fn remaining_members_saturates_at_zero() {
        let defaults = TeamDefaults {
            allowed_agent_ids: Vec::new(),
            default_model: None,
            default_workspace: Workspace::Shared,
            default_approval_policy: ApprovalPolicy::Queue,
            default_persona: None,
            max_members: 2,
            member_count: 2,
        };
        assert_eq!(defaults.remaining(), 0);
        let over = TeamDefaults {
            member_count: 5,
            ..defaults
        };
        assert_eq!(over.remaining(), 0, "超出时不回绕成一个大数");
    }

    /// 线上键名（camelCase）：面板读的是 `allowedAgentIds` / `maxMembers` / `memberCount`。
    #[test]
    fn options_serialise_with_camel_case_keys() {
        let json = serde_json::to_value(options_for(&fixture_team(TEAM), 2)).expect("serialize");
        let mut keys: Vec<&str> = json
            .as_object()
            .expect("object")
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(keys, vec!["defaults", "members"]);

        let mut default_keys: Vec<&str> = json["defaults"]
            .as_object()
            .expect("defaults object")
            .keys()
            .map(String::as_str)
            .collect();
        default_keys.sort_unstable();
        assert_eq!(
            default_keys,
            vec![
                "allowedAgentIds",
                "defaultApprovalPolicy",
                "defaultModel",
                "defaultPersona",
                "defaultWorkspace",
                "maxMembers",
                "memberCount",
            ]
        );

        let mut member_keys: Vec<&str> = json["members"][0]
            .as_object()
            .expect("member object")
            .keys()
            .map(String::as_str)
            .collect();
        member_keys.sort_unstable();
        assert_eq!(member_keys, vec!["agentId", "refusal"]);
    }
}
