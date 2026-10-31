//! 「**以队长身份开会话**」的纯计划层：团队行 + 队长成员行。
//!
//! # 为什么需要它（`implement.md` C1）
//!
//! 原设计假设「把已经在跑的会话提升为队长」。**实测不成立**：CLI 的 MCP 配置是**启动期**
//! 读取的（`--mcp-config` / `grok mcp add` 都只在启动时生效），一个正在跑的进程无法被
//! 塞进新的 MCP server —— 而队长的全部能力都在那个工具面上。
//!
//! ⇒ 「提升」被替换成**新开一个会话**：本模块造出「团队 + 队长」两行，之后走与成员
//! **完全相同**的执行路径（`execution::apply_reply` → `admit` + `spawn`）。promote 的
//! 代码量因此是 0 —— 不是省事，而是**只有一条执行路径**。
//!
//! # 为什么是纯函数
//!
//! 准入拒绝（该 CLI 能不能当队长）、id 形状、字段装配全部可直测，且不碰时钟 / 库 /
//! 文件系统：`now` 与 `team_id` 由调用方给。真正有副作用的只有三步，都在组合根：
//! 规范化项目路径（`spawn_blocking`）→ `create_team_with_lead`（一次写入）→ `apply_reply`。
//!
//! # 与 `mcp::dispatch::spawn` 的关系
//!
//! 那边**只**建 worker 且拒绝 `role = Lead`（否则授权矩阵里会多一个能 `close` 的主体）。
//! 两者的字段装配规则必须一致（`channel` / `result_channel` / `tier` / `mcp_injection`
//! 全来自准入表），所以这里也走同一批准入函数，不另算一遍。

use std::path::Path;

use crate::agent::team::admission::{admission_for, refusal, tier_of};
use crate::agent::team::types::{
    MemberRole, MemberState, Team, TeamMember, TeamState, WorkerChannel, Workspace,
};
use crate::common::error::AppError;

/// 队长在队内的名字（成员 id = `{name}@{team}`，与 worker 同一形状）。
///
/// 固定为 `lead` 而不是让用户填：一个团队只有一个队长，「队长叫什么」不是信息，
/// 而多一个可填字段就多一种与 worker 重名的机会。
pub const LEAD_NAME: &str = "lead";

/// 建队需要的两行（还没落库）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TeamBootstrap {
    /// 团队行（`lead_session_id` 为空，等 PTY 起来后回填）。
    pub team: Team,
    /// 队长成员行（与 worker 同形，只有 `role` 不同）。
    pub lead: TeamMember,
}

/// 团队 id：`tm_{毫秒时间戳的十六进制}`（design §2 的形状）。
///
/// 用毫秒而不是随机数：同一毫秒内建两个队会撞 id，而 `create_team` 会报 `Conflict`
/// （可见的重试），不是静默覆盖。随机数则要引入一个与 `now` 无关的熵源 —— 不值。
#[must_use]
pub fn new_team_id(now: i64) -> String {
    format!("tm_{:x}", now.max(0).cast_unsigned())
}

/// 算出一个「团队 + 队长」。
///
/// # 拒绝的三种情形
///
/// | 情形 | 为什么 |
/// | --- | --- |
/// | 该 CLI 不在准入表（`dsh` / 未实测） | 没有任何 hook / MCP 事实可依据，`refusal` 给出可用清单 |
/// | 起得来但用不了（无 MCP 面 / 注入档未实现） | 与 `team_spawn` 同一判据（`launch_refusal`）：不允许「有会话、连不上工具面」的队长 |
/// | 项目路径不是绝对路径 | 它是团队的**信任根**，`plan_member_spawn` 会拿它做 `starts_with` 判据（红线 8） |
///
/// # 参数
///
/// - `name`：团队显示名；`None` / 空白 → 取项目目录名（再退到 `team_id`）。
/// - `team_id`：由 [`new_team_id`] 提供（纯函数，便于测试固定 id）。
pub fn plan_team(
    agent_id: &str,
    project_path: &Path,
    name: Option<&str>,
    team_id: &str,
    now: i64,
) -> Result<TeamBootstrap, AppError> {
    if !project_path.is_absolute() {
        return Err(AppError::InvalidInput(format!(
            "team project path {} must be absolute: it is the trust root every member's \
             workspace is checked against",
            project_path.display()
        )));
    }

    let admission = admission_for(agent_id).ok_or_else(|| AppError::NotFound(refusal(agent_id)))?;
    if let Some(why) = admission.launch_refusal() {
        return Err(AppError::Unsupported(why));
    }

    let display_name = resolve_name(name, project_path, team_id);
    let team = Team {
        id: team_id.to_owned(),
        name: display_name,
        // 队长会话的句柄在 PTY 起来后回填（`set_member_terminal` 会同时写这里）——
        // 本层不假装已经有一个会话。
        lead_session_id: String::new(),
        lead_agent_id: agent_id.to_owned(),
        project_path: project_path.to_path_buf(),
        created_at: now,
        closed_at: None,
        state: TeamState::Active,
    };

    let lead = TeamMember {
        id: format!("{LEAD_NAME}@{team_id}"),
        team_id: team_id.to_owned(),
        name: LEAD_NAME.to_owned(),
        role: MemberRole::Lead,
        agent_id: agent_id.to_owned(),
        model: None,
        // Chat 成员的位置（design §7.4，本期恒 `None`）；`terminal_id` 由执行层回填。
        session_id: None,
        terminal_id: None,
        // 队长的工作区就是团队根：它派活 / 复核，不另开 worktree。
        workspace: Workspace::Shared,
        // CLI 成员的唯一通道（`WorkerChannel::CLI_MEMBER` 的文档）。
        channel: WorkerChannel::CLI_MEMBER,
        result_channel: admission.result_channel(),
        tier: tier_of(admission),
        // R0b.3：默认进待批队列。`Bypass` 是**显式**选择，不从队长继承给工人。
        approval_policy: crate::agent::team::types::ApprovalPolicy::Queue,
        mcp_injection: admission.mcp_injection,
        last_seq: 0,
        state: MemberState::Spawned,
        // 空 hash ⇒ 不可认证；凭证由执行层 `issue_token` 取一次（模型上下文里永远没有明文）。
        token_hash: String::new(),
        joined_at: now,
    };

    Ok(TeamBootstrap { team, lead })
}

/// 团队显示名：显式名 > 项目目录名 > 团队 id。
///
/// 三段都非空才往下走 —— 名字会进 UI 标题，空串在那里就是一块空白。
fn resolve_name(name: Option<&str>, project_path: &Path, team_id: &str) -> String {
    if let Some(name) = name.map(str::trim).filter(|name| !name.is_empty()) {
        return name.to_owned();
    }
    if let Some(dir) = project_path
        .file_name()
        .and_then(|dir| dir.to_str())
        .map(str::trim)
        .filter(|dir| !dir.is_empty())
    {
        return dir.to_owned();
    }
    team_id.to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::team::types::{AdmissionTier, McpInjection, ResultChannel, WorkerChannel};

    const NOW: i64 = 1_700_000_000_000;
    const TEAM: &str = "tm_18bcfe53700";
    /// 绝对路径，且平台无关（红线 13：不许手写 `/tmp/x`）。
    const ROOT: &str = env!("CARGO_MANIFEST_DIR");

    fn plan(agent_id: &str) -> TeamBootstrap {
        plan_team(agent_id, Path::new(ROOT), None, TEAM, NOW).expect("claude-code 可以当队长")
    }

    /// 队长行的每一项都来自准入表，不是这里另算的。
    #[test]
    fn a_lead_carries_the_admission_facts() {
        let TeamBootstrap { team, lead } = plan("claude-code");

        assert_eq!(team.id, TEAM);
        assert_eq!(team.lead_agent_id, "claude-code");
        assert_eq!(team.state, TeamState::Active);
        assert_eq!(team.created_at, NOW);
        assert_eq!(
            team.lead_session_id, "",
            "会话句柄在 PTY 起来后才回填，本层不许假装有"
        );

        assert_eq!(lead.id, format!("lead@{TEAM}"));
        assert_eq!(lead.role, MemberRole::Lead);
        assert_eq!(lead.workspace, Workspace::Shared);
        assert_eq!(lead.tier, AdmissionTier::A);
        assert_eq!(
            lead.channel,
            WorkerChannel::CLI_MEMBER,
            "有 MCP 面不等于能收推送：入站通道是 PTY"
        );
        assert_eq!(lead.result_channel, ResultChannel::Mcp);
        assert_eq!(lead.mcp_injection, McpInjection::Argv);
        assert_eq!(lead.state, MemberState::Spawned);
        assert_eq!(lead.terminal_id, None, "还没起进程");
        assert_eq!(lead.token_hash, "", "凭证由执行层签发，计划里没有明文");
        assert_eq!(lead.joined_at, NOW);
    }

    /// 队长的档位 / 通道是**表的事实**，与 worker 的推导同源。
    ///
    /// 遍历的是「今天真能当队长」的全部行（注入档已实现的三个）—— 写死一条
    /// `claude-code` 的断言无法证明推导没有硬编码；而遍历会让「新增一个 Argv 行却忘了
    /// 让队长走同一批函数」立刻变红。
    #[test]
    fn a_leads_channels_follow_the_admission_row() {
        for agent_id in ["claude-code", "codebuddy", "qoder"] {
            let admission = admission_for(agent_id).expect("在准入表里");
            let TeamBootstrap { lead, .. } = plan(agent_id);
            assert_eq!(lead.tier, tier_of(admission), "{agent_id}: 档位");
            assert_eq!(
                lead.channel,
                WorkerChannel::CLI_MEMBER,
                "{agent_id}: 入站通道一律 PTY"
            );
            assert_eq!(
                lead.result_channel,
                admission.result_channel(),
                "{agent_id}: 报结果通道"
            );
            assert_eq!(
                lead.mcp_injection, admission.mcp_injection,
                "{agent_id}: 注入档"
            );
        }
    }

    #[test]
    fn an_agent_outside_the_admission_table_is_refused_with_the_available_ids() {
        let err =
            plan_team("dsh", Path::new(ROOT), None, TEAM, NOW).expect_err("dsh 无 AgentConfig");
        assert!(matches!(err, AppError::NotFound(_)), "{err:?}");
        assert!(err.to_string().contains("dsh"), "{err}");
    }

    /// C5 的同一判据：起得来但用不了的 CLI 不能在**建队**这一步被放过。
    #[test]
    fn an_agent_that_could_not_reach_the_tool_surface_is_refused() {
        let err = plan_team("omp", Path::new(ROOT), None, TEAM, NOW).expect_err("omp 无 MCP 面");
        assert!(matches!(err, AppError::Unsupported(_)), "{err:?}");
        assert!(err.to_string().contains("no MCP surface"), "{err}");

        let err =
            plan_team("grok", Path::new(ROOT), None, TEAM, NOW).expect_err("grok 是子命令注入");
        assert!(err.to_string().contains("Subcommand"), "{err}");
    }

    #[test]
    fn a_relative_project_path_is_refused() {
        let err = plan_team("claude-code", Path::new("relative/dir"), None, TEAM, NOW)
            .expect_err("相对路径必须拒绝");
        assert!(matches!(err, AppError::InvalidInput(_)), "{err:?}");
    }

    /// 名字三段回退：显式名 → 目录名 → id；空串与空白都不许落到 UI 上。
    #[test]
    fn the_display_name_falls_back_from_explicit_to_directory_to_id() {
        let explicit =
            plan_team("claude-code", Path::new(ROOT), Some("  小队  "), TEAM, NOW).expect("显式名");
        assert_eq!(explicit.team.name, "小队", "两端空白被裁掉");

        let derived =
            plan_team("claude-code", Path::new(ROOT), Some("   "), TEAM, NOW).expect("空白 = 没给");
        let dir = Path::new(ROOT).file_name().unwrap().to_string_lossy();
        assert_eq!(derived.team.name, dir, "退到项目目录名");

        // 根目录没有 file_name ⇒ 退到 team id（不会出现空标题）。
        // 根由 **manifest 路径的祖先**推导：`Path::new("/")` 在 Windows 上
        // `is_absolute()` 为假（无盘符），用它当夹具会让这条测试只在 Unix 成立（红线 13）。
        let root = Path::new(ROOT).ancestors().last().expect("路径必有根");
        assert!(root.is_absolute(), "根必须绝对：{root:?}");
        assert_eq!(root.file_name(), None, "根没有文件名：{root:?}");
        let fallback = plan_team("claude-code", root, None, TEAM, NOW).expect("根目录");
        assert_eq!(fallback.team.name, TEAM);
    }

    #[test]
    fn team_ids_are_hex_milliseconds_and_differ_over_time() {
        assert_eq!(new_team_id(0), "tm_0");
        assert_ne!(new_team_id(NOW), new_team_id(NOW + 1));
        assert!(new_team_id(NOW).starts_with("tm_"));
    }
}
