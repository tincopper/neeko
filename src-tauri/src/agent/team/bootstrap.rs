//! 「**以队长身份开会话**」的纯计划层：团队行 + 队长成员行。
//!
//! # 为什么需要它（`implement.md` C1）
//!
//! 原设计假设「把已经在跑的会话提升为队长」。**实测不成立**：CLI 的 MCP 配置是**启动期**
//! 读取的（`--mcp-config` / `grok mcp add` 都只在启动时生效），一个正在跑的进程无法被
//! 塞进新的 MCP server —— 而队长的全部能力都在那个工具面上。
//!
//! ⇒ 「提升」被替换成**新开一个会话**：本模块造出「团队 + 队长」两行，之后走与成员
//! **完全相同**的执行路径（`execution::start_member` → `admit` + `spawn`）。promote 的
//! 代码量因此是 0 —— 不是省事，而是**只有一条执行路径**。
//!
//! # 为什么是纯函数
//!
//! 准入拒绝（该 CLI 能不能当队长）、id 形状、字段装配全部可直测，且不碰时钟 / 库 /
//! 文件系统：`now` 与 `team_id` 由调用方给。真正有副作用的只有三步，都在组合根：
//! 规范化项目路径（`spawn_blocking`）→ `create_team_with_lead`（一次写入）→ `start_member`。
//!
//! **一个刻意的例外**：[`validate_config`] 会 `canonicalize` 团队 `default_workspace`
//! 给的 worktree 路径（红线 8 的唯一判据在 `execution::workspace_cwd`，不复制一份）。
//! 它因此必须在阻塞池里调，且**在写库之前**调 —— 「配置不合法的团队落在库里」会让
//! 面板与队长对同一个团队读到两种答案。
//!
//! # 与 `mcp::dispatch::spawn` 的关系
//!
//! 那边**只**建 worker 且拒绝 `role = Lead`（否则授权矩阵里会多一个能 `close` 的主体）。
//! 两者的字段装配规则必须一致（`channel` / `result_channel` / `tier` / `mcp_injection`
//! 全来自准入表），所以这里也走同一批准入函数，不另算一遍。

use std::path::Path;

use crate::agent::team::admission::{admission_for, launch_refusal_for, refusal, tier_of};
use crate::agent::team::types::{
    ApprovalPolicy, MemberRole, MemberState, Team, TeamConfig, TeamMember, TeamState,
    WorkerChannel, Workspace, MAX_MEMBERS_LIMIT,
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
/// # 拒绝的四种情形
///
/// | 情形 | 为什么 |
/// | --- | --- |
/// | 该 CLI 不在准入表（`dsh` / 未实测） | 没有任何 hook / MCP 事实可依据，`refusal` 给出可用清单 |
/// | 起得来但用不了（无 MCP 面 / 注入档未实现） | 与 `team_spawn` 同一判据（`launch_refusal`）：不允许「有会话、连不上工具面」的队长 |
/// | 能当成员但不能当队长（无 `prompt_argv`） | `lead_refusal` 多问的那一条：队长的第一个动作没有人能替它触发，拿不到角色 preamble 的队长就是一个不动的会话 |
/// | 项目路径不是绝对路径 | 它是团队的**信任根**，`plan_member_spawn` 会拿它做 `starts_with` 判据（红线 8） |
/// | `project_id` 为空 | 环境归属必须是一个事实；空 id 只可能来自 v16 之前的旧行 |
///
/// # 参数
///
/// - `project_id`：拥有这个团队**执行环境**的项目 id（前端传 `activeProjectId`，**不是**从
///   路径猜）。它与 `project_path` 不是一个事实：路径是工作区根（可以是工作树，落在项目
///   目录之外），id 才是环境的归属 —— 执行层按 id 精确查表
///   （[`super::execution::environment_source`]）。空 id 在这里就拒绝：晚到执行层的后果是
///   「团队行已写入、进程起不来」的孤儿队。
/// - `name`：团队显示名；`None` / 空白 → 取项目目录名（再退到 `team_id`）。
/// - `team_id`：由 [`new_team_id`] 提供（纯函数，便于测试固定 id）。
/// - `config`：团队组成配置（池 / 上限 / 默认值）。**调用方必须已过 [`validate_config`]** ——
///   本函数不重复校验（一次构造、一次裁决；两处各判一遍会让「哪个先拒」变成运气）。
pub fn plan_team(
    agent_id: &str,
    project_id: &str,
    project_path: &Path,
    name: Option<&str>,
    team_id: &str,
    now: i64,
    config: &TeamConfig,
) -> Result<TeamBootstrap, AppError> {
    if project_id.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "a team must belong to a project: `project_id` is empty. The team's execution \
             environment is the environment of its project, and it is resolved by that id — a \
             team without a project cannot be launched"
                .to_string(),
        ));
    }
    if !project_path.is_absolute() {
        return Err(AppError::InvalidInput(format!(
            "team project path {} must be absolute: it is the trust root every member's \
             workspace is checked against",
            project_path.display()
        )));
    }

    let admission = admission_for(agent_id).ok_or_else(|| AppError::NotFound(refusal(agent_id)))?;
    // 队长判据（**不是**成员判据）：`lead_refusal` 在 `launch_refusal` 之上多一条「能不能
    // 收到角色 preamble」。用错的那一侧会很安静地放行一个不动的队长。
    if let Some(why) = admission.lead_refusal() {
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
        project_id: project_id.to_owned(),
        created_at: now,
        closed_at: None,
        state: TeamState::Active,
        // 团队组成（design 之外的 C 方案裁定）：池 / 上限 / 默认值三处消费同一份数据。
        // 空池原样落库（= 不限制）—— 解析成「全部可启动」是读侧的事
        // （`options::options_for`），写侧把它展开就等于把「没限制」变成一个时间点快照，
        // 明天新准入一个 CLI 时这个团队就神秘地不包含它。
        allowed_agent_ids: config.allowed_agent_ids.clone(),
        default_model: config.default_model.clone(),
        default_workspace: config.default_workspace.clone(),
        default_approval_policy: config.default_approval_policy,
        max_members: config.max_members,
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
        // 注意：队长的审批策略**不**取团队的 `default_approval_policy` —— 那是**成员**的缺省。
        // 队长没有派活前的“他自己的审批”这回事：它的每个动作都是工具调用（走授权矩阵）。
        approval_policy: ApprovalPolicy::default(),
        mcp_injection: admission.mcp_injection,
        last_seq: 0,
        state: MemberState::Spawned,
        // 空 hash ⇒ 不可认证；凭证由执行层 `issue_token` 取一次（模型上下文里永远没有明文）。
        token_hash: String::new(),
        joined_at: now,
    };

    Ok(TeamBootstrap { team, lead })
}

/// 团队配置的**构造期**校验（`start_team_session` 在**写库之前**调它）。
///
/// # 拒绝，不静默过滤
///
/// 用户在面板上勾的每一项都必须**原样生效**或**被告知为什么不行**。静默丢一项是最难
/// 发现的失败：面板显示「claude-code 可选」，队长 spawn 它却被拒 —— 两个界面都在说实话，
/// 只是说的不是同一件事。
///
/// # 拒绝的五类
///
/// | 输入 | 类别 | 为什么 |
/// | --- | --- | --- |
/// | `allowed_agent_ids` 里有一个不能当成员的 id | `InvalidInput`（带 id + 理由） | 池子是「允许被选中」的承诺；装一个必然被拒的 id 就是空承诺 |
/// | `allowed_agent_ids` 里有一个空白 id | `InvalidInput` | 空串匹配不到任何 CLI，却会出现在池子的清单里 |
/// | `max_members` 不在 `1..=MAX_MEMBERS_LIMIT` | `InvalidInput` | `0` 让团队一个成员都加不了；上限之外每个成员是一个真进程 + 一份隔离配置目录 |
/// | `default_model` 空白 / 含控制字符 | `InvalidInput` | 它会进 argv（`--model <value>`），NUL 会让 `Command::arg` panic |
/// | `default_workspace = Worktree{path}` 越界 | `InvalidInput` | 红线 8：成员 cwd 只能落在团队根内（复用执行层那条判据，不复制） |
///
/// # 调用契约（红线 3）
///
/// worktree 那一支会 `canonicalize`（`std::fs`）⇒ **必须在阻塞池里调**。本函数不自己
/// `spawn`（同 `plan_member_spawn` 的取舍：谁在 async 上下文里，谁负责把同步 I/O 挪出去）。
pub fn validate_config(config: &TeamConfig, team_root: &Path) -> Result<(), AppError> {
    if config.max_members == 0 || config.max_members > MAX_MEMBERS_LIMIT {
        return Err(AppError::InvalidInput(format!(
            "max_members must be between 1 and {MAX_MEMBERS_LIMIT}; got {} (a team with no members \
             cannot be staffed, and every member above the limit is one more process and one more \
             isolated config directory)",
            config.max_members
        )));
    }

    for agent_id in &config.allowed_agent_ids {
        let trimmed = agent_id.trim();
        if trimmed.is_empty() {
            return Err(AppError::InvalidInput(
                "allowed_agent_ids must not contain an empty id: an empty string matches no CLI, \
                 but it would still be listed as an allowed member"
                    .to_string(),
            ));
        }
        if let Some(why) = launch_refusal_for(trimmed) {
            return Err(AppError::InvalidInput(format!(
                "`{trimmed}` cannot be a team member, so it must not be in allowed_agent_ids: {why}"
            )));
        }
    }

    if let Some(model) = &config.default_model {
        let model = model.trim();
        if model.is_empty() {
            return Err(AppError::InvalidInput(
                "default_model must not be empty; omit it to let each CLI use its own default"
                    .to_string(),
            ));
        }
        // 与 `team_spawn` 的 `model` 入参**同一个**判据（控制字符只有一个实现）。
        crate::agent::team::mcp::dispatch::reject_control_chars(
            "start_team_session",
            "default_model",
            model,
        )?;
    }

    // 工作区：`Shared` / `ReadOnly` 没有路径；`Worktree` 必须绝对且落在团队根内。
    // 判据复用执行层那一条（`execution::workspace_cwd`）—— 两份 `starts_with` 迟早会对
    // 「符号链接下的同一棵树」给出两个答案，而其中一个会放行越界的成员。
    crate::agent::team::execution::workspace_cwd(team_root, &config.default_workspace)?;
    Ok(())
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
    use std::path::PathBuf;

    const NOW: i64 = 1_700_000_000_000;
    const TEAM: &str = "tm_18bcfe53700";
    /// 绝对路径，且平台无关（红线 13：不许手写 `/tmp/x`）。
    const ROOT: &str = env!("CARGO_MANIFEST_DIR");
    /// 拥有这个团队执行环境的项目 id（v16 起必填）。
    const PROJECT: &str = "p1";

    fn plan(agent_id: &str) -> TeamBootstrap {
        plan_team(
            agent_id,
            PROJECT,
            Path::new(ROOT),
            None,
            TEAM,
            NOW,
            &TeamConfig::default(),
        )
        .expect("claude-code 可以当队长")
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
        let err = plan_team(
            "dsh",
            PROJECT,
            Path::new(ROOT),
            None,
            TEAM,
            NOW,
            &TeamConfig::default(),
        )
        .expect_err("dsh 无 AgentConfig");
        assert!(matches!(err, AppError::NotFound(_)), "{err:?}");
        assert!(err.to_string().contains("dsh"), "{err}");
    }

    /// C5 的同一判据：起得来但用不了的 CLI 不能在**建队**这一步被放过。
    #[test]
    fn an_agent_that_could_not_reach_the_tool_surface_is_refused() {
        let err = plan_team(
            "omp",
            PROJECT,
            Path::new(ROOT),
            None,
            TEAM,
            NOW,
            &TeamConfig::default(),
        )
        .expect_err("omp 无 MCP 面");
        assert!(matches!(err, AppError::Unsupported(_)), "{err:?}");
        assert!(err.to_string().contains("no MCP surface"), "{err}");

        let err = plan_team(
            "grok",
            PROJECT,
            Path::new(ROOT),
            None,
            TEAM,
            NOW,
            &TeamConfig::default(),
        )
        .expect_err("grok 是子命令注入");
        assert!(err.to_string().contains("Subcommand"), "{err}");
    }

    /// 空 `project_id` 在**纯函数层**就被拒：晚到执行层的后果是「团队行已写入、进程起不来」
    /// 的孤儿队。
    ///
    /// 理由必须**点名 project**：只说「invalid input」会让调用方以为错在路径或 CLI。
    /// 空白串与空串同判（`"  "` 不是一个项目 id）。
    #[test]
    fn planning_a_team_without_a_project_id_is_refused() {
        for project_id in ["", "   "] {
            let err = plan_team(
                "claude-code",
                project_id,
                Path::new(ROOT),
                None,
                TEAM,
                NOW,
                &TeamConfig::default(),
            )
            .expect_err("没有项目归属不能建队");
            assert!(matches!(err, AppError::InvalidInput(_)), "{err:?}");
            assert!(
                err.to_string().contains("project"),
                "理由必须点名 project：{err}"
            );
        }
    }

    /// 合法的 `project_id` 原样进团队行：它与 `project_path` 是**两个**字段。
    #[test]
    fn the_plan_carries_the_project_id_alongside_the_path() {
        let TeamBootstrap { team, .. } = plan("claude-code");
        assert_eq!(team.project_id, PROJECT);
        assert_eq!(team.project_path, PathBuf::from(ROOT));
        assert_ne!(
            team.project_id,
            team.project_path.to_string_lossy(),
            "id 与路径不是同一件事：一个团队可以在工作树上（路径在项目目录之外）"
        );
    }

    #[test]
    fn a_relative_project_path_is_refused() {
        let err = plan_team(
            "claude-code",
            PROJECT,
            Path::new("relative/dir"),
            None,
            TEAM,
            NOW,
            &TeamConfig::default(),
        )
        .expect_err("相对路径必须拒绝");
        assert!(matches!(err, AppError::InvalidInput(_)), "{err:?}");
    }

    /// 名字三段回退：显式名 → 目录名 → id；空串与空白都不许落到 UI 上。
    #[test]
    fn the_display_name_falls_back_from_explicit_to_directory_to_id() {
        let explicit = plan_team(
            "claude-code",
            PROJECT,
            Path::new(ROOT),
            Some("  小队  "),
            TEAM,
            NOW,
            &TeamConfig::default(),
        )
        .expect("显式名");
        assert_eq!(explicit.team.name, "小队", "两端空白被裁掉");

        let derived = plan_team(
            "claude-code",
            PROJECT,
            Path::new(ROOT),
            Some("   "),
            TEAM,
            NOW,
            &TeamConfig::default(),
        )
        .expect("空白 = 没给");
        let dir = Path::new(ROOT).file_name().unwrap().to_string_lossy();
        assert_eq!(derived.team.name, dir, "退到项目目录名");

        // 根目录没有 file_name ⇒ 退到 team id（不会出现空标题）。
        // 根由 **manifest 路径的祖先**推导：`Path::new("/")` 在 Windows 上
        // `is_absolute()` 为假（无盘符），用它当夹具会让这条测试只在 Unix 成立（红线 13）。
        let root = Path::new(ROOT).ancestors().last().expect("路径必有根");
        assert!(root.is_absolute(), "根必须绝对：{root:?}");
        assert_eq!(root.file_name(), None, "根没有文件名：{root:?}");
        let fallback = plan_team(
            "claude-code",
            PROJECT,
            root,
            None,
            TEAM,
            NOW,
            &TeamConfig::default(),
        )
        .expect("根目录");
        assert_eq!(fallback.team.name, TEAM);
    }

    #[test]
    fn team_ids_are_hex_milliseconds_and_differ_over_time() {
        assert_eq!(new_team_id(0), "tm_0");
        assert_ne!(new_team_id(NOW), new_team_id(NOW + 1));
        assert!(new_team_id(NOW).starts_with("tm_"));
    }

    /// 配置五列原样进入团队行（包括**空池不被展开**）。
    ///
    /// 空池原样落库是关键：写侧把它展开成「今天全部可启动」就把「不限制」变成了一个
    /// 时间点快照 —— 明天新准入一个 CLI，这个团队会神秘地不包含它（而用户在面板上
    /// 从未勾过任何限制）。
    #[test]
    fn the_team_row_carries_the_configuration_verbatim() {
        let default = plan("claude-code").team;
        assert!(
            default.allowed_agent_ids.is_empty(),
            "缺省 = 空池（不限制），不得展开成一份清单"
        );
        assert_eq!(default.default_model, None);
        assert_eq!(default.default_workspace, Workspace::Shared);
        assert_eq!(default.default_approval_policy, ApprovalPolicy::Queue);
        assert_eq!(
            default.max_members,
            crate::agent::team::types::DEFAULT_MAX_MEMBERS
        );

        let config = TeamConfig {
            allowed_agent_ids: vec!["pi".into(), "claude-code".into()],
            default_model: Some("haiku".into()),
            default_workspace: Workspace::ReadOnly,
            default_approval_policy: ApprovalPolicy::Bypass,
            max_members: 2,
        };
        let TeamBootstrap { team, lead } = plan_team(
            "claude-code",
            PROJECT,
            Path::new(ROOT),
            None,
            TEAM,
            NOW,
            &config,
        )
        .expect("配置合法");
        assert_eq!(team.allowed_agent_ids, config.allowed_agent_ids);
        assert_eq!(team.default_model, config.default_model);
        assert_eq!(team.default_workspace, Workspace::ReadOnly);
        assert_eq!(team.default_approval_policy, ApprovalPolicy::Bypass);
        assert_eq!(team.max_members, 2);
        // 队长自己的审批策略**不**跟团队默认值走（那是成员的缺省）。
        assert_eq!(lead.approval_policy, ApprovalPolicy::Queue);
    }

    /// 构造期校验：池子里的每一项都必须**真能当成员**，否则拒绝并点名 id + 理由。
    ///
    /// 保护的不变量：**不许静默过滤**。用户勾了 `grok`（子命令注入、v1 不实现），面板
    /// 必须当场说“它不行，因为…”，而不是落库一个把它剔掉的池子 —— 那样队长 spawn 它
    /// 会收到另一句理由，而两个界面都在说实话。
    #[test]
    fn a_pool_entry_that_cannot_be_a_member_is_refused_by_name() {
        for (agent_id, needle) in [
            ("grok", "Subcommand"),
            ("dsh", "not in the team admission table"),
        ] {
            let config = TeamConfig {
                allowed_agent_ids: vec![agent_id.into()],
                ..TeamConfig::default()
            };
            let err = validate_config(&config, Path::new(ROOT)).expect_err("不可启动的池成员");
            assert!(matches!(err, AppError::InvalidInput(_)), "{err:?}");
            let message = err.to_string();
            assert!(message.contains(agent_id), "必须点名 id：{message}");
            assert!(
                message.contains(needle),
                "必须带上理由（{needle}）：{message}"
            );
            assert!(
                message.contains("allowed_agent_ids"),
                "必须说清改哪里：{message}"
            );
        }
        // 能当成员的 id 一律放行（否则上面那两条可能只是“碰巧全拒”）。
        let ok = TeamConfig {
            allowed_agent_ids: vec!["pi".into(), "claude-code".into()],
            ..TeamConfig::default()
        };
        assert!(validate_config(&ok, Path::new(ROOT)).is_ok());
    }

    /// 空白 id 拒绝：空串匹配不到任何 CLI，却会出现在池子的清单里。
    #[test]
    fn an_empty_pool_entry_is_refused() {
        let config = TeamConfig {
            allowed_agent_ids: vec!["  ".into()],
            ..TeamConfig::default()
        };
        let err = validate_config(&config, Path::new(ROOT)).expect_err("空白 id");
        assert!(matches!(err, AppError::InvalidInput(_)), "{err:?}");
        assert!(err.to_string().contains("empty id"), "{err}");
    }

    /// 上限的合法区间是 `1..=MAX_MEMBERS_LIMIT`（两端外面都拒，且带上实际值）。
    #[test]
    fn the_member_limit_is_checked_against_its_range() {
        for max in [0_u32, MAX_MEMBERS_LIMIT + 1] {
            let config = TeamConfig {
                max_members: max,
                ..TeamConfig::default()
            };
            let err = validate_config(&config, Path::new(ROOT)).expect_err("越界上限");
            let AppError::InvalidInput(message) = err else {
                panic!("越界必须是 InvalidInput，实际 {err:?}");
            };
            assert!(message.contains("max_members"), "{message}");
            assert!(message.contains(&max.to_string()), "{message}");
        }
        for max in [1_u32, MAX_MEMBERS_LIMIT] {
            let config = TeamConfig {
                max_members: max,
                ..TeamConfig::default()
            };
            assert!(
                validate_config(&config, Path::new(ROOT)).is_ok(),
                "{max} 合法"
            );
        }
    }

    /// 缺省工作区越界（团队根之外）必须在**写库之前**拒绝（红线 8）。
    ///
    /// 夹具全部由 `tempdir()` 推导（红线 13）。
    #[test]
    fn a_default_worktree_outside_the_team_root_is_refused() {
        let root = tempfile::tempdir().expect("team root");
        let outside = tempfile::tempdir().expect("outside");
        let team_root = std::fs::canonicalize(root.path()).expect("canonical root");

        // 根内（真的建出来：canonicalize 要求存在）—— 放行。
        let inside = team_root.join("wt");
        std::fs::create_dir(&inside).expect("mkdir wt");
        assert!(validate_config(
            &TeamConfig {
                default_workspace: Workspace::Worktree { path: inside },
                ..TeamConfig::default()
            },
            &team_root,
        )
        .is_ok());

        let err = validate_config(
            &TeamConfig {
                default_workspace: Workspace::Worktree {
                    path: outside.path().to_path_buf(),
                },
                ..TeamConfig::default()
            },
            &team_root,
        )
        .expect_err("团队根之外的 worktree");
        assert!(matches!(err, AppError::InvalidInput(_)), "{err:?}");
        assert!(err.to_string().contains("outside the team root"), "{err}");

        // 相对路径同样是拒绝（绝对路径是红线 8 的入口一半）。
        let err = validate_config(
            &TeamConfig {
                default_workspace: Workspace::Worktree {
                    path: Path::new("relative/wt").to_path_buf(),
                },
                ..TeamConfig::default()
            },
            &team_root,
        )
        .expect_err("相对路径");
        assert!(err.to_string().contains("must be absolute"), "{err}");

        // `Shared` / `ReadOnly` 不碰盘，也不受团队根是否存在的约束。
        for workspace in [Workspace::Shared, Workspace::ReadOnly] {
            assert!(validate_config(
                &TeamConfig {
                    default_workspace: workspace,
                    ..TeamConfig::default()
                },
                &team_root,
            )
            .is_ok());
        }
    }

    /// 默认 model 会进 argv：空白与控制字符在**构造期**就拒（不是等第一次 spawn 才炸）。
    #[test]
    fn a_default_model_that_cannot_be_an_argv_value_is_refused() {
        let blank = TeamConfig {
            default_model: Some("   ".into()),
            ..TeamConfig::default()
        };
        let err = validate_config(&blank, Path::new(ROOT)).expect_err("空白 model");
        assert!(err.to_string().contains("default_model"), "{err}");

        let control = TeamConfig {
            default_model: Some("so\nnet".into()),
            ..TeamConfig::default()
        };
        let err = validate_config(&control, Path::new(ROOT)).expect_err("控制字符");
        assert!(err.to_string().contains("control characters"), "{err}");

        let ok = TeamConfig {
            default_model: Some("sonnet".into()),
            ..TeamConfig::default()
        };
        assert!(validate_config(&ok, Path::new(ROOT)).is_ok());
    }
}
