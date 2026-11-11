//! 团队域的 `#[tauri::command]`（**极薄**，红线 6）。
//!
//! 九条命令：
//!
//! | 命令 | 方向 | 载荷 |
//! | --- | --- | --- |
//! | `start_team_session` | 写 | 建队 + 起队长 PTY（`create_team` 的唯一生产调用方；带团队配置）|
//! | `team_list` | 读 | **这台机器上**的团队清单（重启后重开自己的队靠它；有界 + `truncated`）|
//! | `team_snapshot` | 读 | 团队行 + 花名册 + 任务板列（**无 `body`**，红线 4）|
//! | `team_task_detail` | 读 | 列视图 + 派活正文（点开才拉）|
//! | `team_member_detail` | 读 | 成员行 + 它的任务 + 待批队列 + 最近 50 条事件（点开才拉）|
//! | `team_launchable_agents` | 读 | **这台机器上**每个可选 agent 一条 `{ agentId, refusal }`（面板置灰依据）|
//! | `team_options` | 读 | **这个队**允许谁 / 还能加几个 / 缺省值（建队前 `team_id = None` → 全部可启动）|
//! | `team_close` | 写 | 关进程 → 归档成员 → 作废凭证（失败停在 `closing`，可重试）|
//! | `team_delete` | 写 | **永久删除**一个 `closed` 的队（`active` / `closing` 一律拒，返回 `()`）|
//!
//! 九条都只做「接收参数 → 校验 → 调度」：视图构造在 [`crate::agent::team::view`]，可选项面在
//! [`crate::agent::team::options`]，建队/起进程在 `bootstrap` + `execution`，准入判定在
//! [`crate::agent::team::admission`]，删除的状态判据在 [`crate::agent::team::manager`]（红线 6）。
//!
//! # 两条写命令的不可逆程度不同
//!
//! `team_close` 是可**重试**的（有成员关不掉时整次 `Err`，团队停在 `closing`，再调一次就是
//! 同一目标集重走一遍）；`team_delete` 是**永久**的（行 + 成员 + 任务 + 审计一起没，
//! `team_list` 再也看不到它）。所以后者不是前者的一个布尔参数：那会让一次「重试关闭」的
//! 调用多带一个能毁数据的开关，而它长得和关闭一模一样。
//! # 两条读命令**不做 principal 校验**（不是漏了）
//!
//! 它们是**本地 Tauri 入口**，不是 MCP 工具：调用方是本机用户点开自己机器上的面板。授权矩阵
//! [`crate::agent::team::authorize`] 回答的是「**成员**（模型进程）能不能对**队友**做某件事」——
//! 那是把不可信主体放进同一个写面之后的约束。本机用户不在这条判定里：他能直接写 `~/.neeko`，
//! 用面板比绕过面板去改库还费劲。MCP 工具面（`dispatch`）仍然逐工具授权，那条路一行没动。
//!
//! 判据 `the_local_entry_does_not_depend_on_the_mcp_vocabulary` 把这条分界钉在**源码**上：
//! 本文件不出现 MCP 的模块路径，也不出现工具回复的类型名（副作用走
//! `execution::Effect`，结果走 `execution::EffectOutcome`）。
//!
//! # 读＝阻塞 I/O ⇒ 阻塞池（红线 3）
//!
//! 花名册走 `TeamStore::list_members`（rusqlite 同步 API），成员详情的事件流走
//! `TeamStore::member_events`（同一类阻塞读）。三条读命令都通过
//! [`crate::common::runtime::run_blocking_result`] 进阻塞池：本域**不自己** spawn（同
//! `TeamManager` 的取舍），命令层是唯一知道自己在哪个 runtime 上的地方。
//!
//! # 为什么不叫「提升为队长」
//!
//! 提升在技术上不成立：CLI 的 MCP 配置是启动期读取的，已在跑的进程塞不进新的 MCP server。
//! 所以入口是**新开一个会话**（`bootstrap` 的模块文档详细记了这条裁决）。用户看到的差别
//! 只是「队长会话」是新开的那一个。
//!
//! # 顺序即契约（`start_team_session`）
//!
//! ```text
//! 端点门面        → 没有它，队长起来了也连不上工具面 ⇒ 先拒（此时库里什么也没有）
//! 项目环境         → 未知 project_id 直接拒：环境归属是项目的事实，不是从路径猜的
//!                    （v16；与端点同一台阶——两件都是「有没有能力做这件事」）
//! 规范化项目路径   → 信任根（红线 8），I/O ⇒ 阻塞池
//! plan_team        → 纯函数：准入 + 空 project_id + 两行装配（拒绝都发生在写库之前）
//! create_team_with_lead → 一次写入，不留「没有队长的团队」
//! start_member     → **与成员完全同一条**执行路径（签发凭证 → 起 PTY → 回填句柄）
//! ```
//!
//! # 残余失败面（已记账，C11）
//!
//! `create_team_with_lead` 成功而 `start_member` 失败时，库里会留下「有队长行、无进程」的
//! 团队。那是两相位设计**刻意接受**的可查询状态（同 `team_spawn` 的失败语义），缺的是
//! 一条「重试起进程」的入口 —— 那是下一步，不在本命令里偷偷做回滚（回滚会删掉用户刚
//! 建的队，而失败原因可能只是 CLI 二进制没装）。

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::agent::team::admission::{self, LaunchableAgent};
use crate::agent::team::bootstrap::{self, new_team_id, plan_team};
use crate::agent::team::execution;
use crate::agent::team::manager::now_millis;
use crate::agent::team::options::{self, TeamOptions};
use crate::agent::team::types::{MemberRole, RolePreset, TaskRef, TeamConfig, TeamState};
use crate::agent::team::view::{self, MemberDetail, TaskDetail, TeamSnapshot};
use crate::common::error::AppError;
use crate::common::runtime::run_blocking_result;
use crate::AppStateWrapper;

/// `start_team_session` 的返回：**队长能行动的三样**（队 / 成员 / 落脚的终端）。
///
/// `rename_all = "camelCase"` **不是风格**：前端读的是 `session.teamId` / `session.terminalId`。
/// 漏了它，表现是「团队『undefined』已建立，但队长进程没有落地」—— 命令成功、PTY 也在跑，
/// 界面上却什么都没发生（`every_command_payload_uses_camel_case_wire_keys` 钉住这条）。
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamSession {
    /// 新团队 id。
    pub team_id: String,
    /// 队长成员 id（`lead@{team}`）。
    pub member_id: String,
    /// 队长 PTY 的会话 id —— 前端据此在 dock 里打开那个终端。
    ///
    /// 理论上是 `Some`（`execution::start_member` 已成功）；`None` 只会出现在「成员行绑定时
    /// 被别处改坏」这种不一致上，保留可空是为了不假装。
    pub terminal_id: Option<String>,
    /// 队员 MCP 配置里要连的端点（与执行层同源，便于排查）。
    pub endpoint_url: String,
    /// 队长的 agent（`AgentConfig.id`）。
    ///
    /// **随建队响应一起回**，前端 tab 栏据此显示品牌图标 —— 从快照里找会让图标
    /// 依赖一个时序（快照拉回来之前 tab 已经画出来了，那一帧是通用终端图标）。
    pub lead_agent_id: String,
}

/// 以队长身份开一个会话（建队 + 起队长 PTY）。
///
/// 参数：
/// - `project_id`：拥有这个团队**执行环境**的项目 id。**必须**是前端的 `activeProjectId`，
///   **不是**从路径猜出来的：环境归属是项目的事实，而 `project_path` 可能是落在项目目录
///   之外的工作树（`~/.neeko/worktrees/<name>`）。未知 id 在**任何写入之前**拒绝 ——
///   否则晚到的失败会在库里留下一个已建好、永远起不来的孤儿团队。
/// - `agent_id`：队长用哪个 CLI（必须是准入表里的 A 档，注入方式已实现，**且能收到角色
///   preamble** —— `prompt_argv` 为空的行会在这里被拒绝，理由原样返回）。
/// - `project_path`：团队根（**绝对**路径；会被规范化成信任根）。
/// - `name`：团队显示名（缺省取项目目录名）。
/// - `config`：团队组成配置（候选池 / 成员上限 / 三个缺省值）；`None` = 全默认。
///   校验在**写库之前**（同 `plan_team` 的拒绝顺序）：池内每一项必须真能当成员、上限在
///   `1..=MAX_MEMBERS_LIMIT`、默认 worktree 必须落在团队根内。判据见
///   `bootstrap::validate_config`。
#[tauri::command]
pub async fn start_team_session(
    state: tauri::State<'_, AppStateWrapper>,
    project_id: String,
    agent_id: String,
    project_path: String,
    name: Option<String>,
    config: Option<TeamConfig>,
) -> Result<TeamSession, AppError> {
    // 端点门面 = 成员 MCP 配置里的 URL + 签发凭证的端口 + 起进程的执行者。
    // 三样同源（一次取出，不可能只拿半个）；没有端点就没有工具面，也就没有队长 ——
    // 在**任何写入之前**拒绝，不留死团队。
    let surface = state.team_surface().ok_or_else(no_endpoint)?;

    // 项目的存在性同样是「能不能做这件事」的前置条件，所以与端点同一台阶：
    // 未知 id ⇒ 可读的 `NotFound`，且**早于**路径规范化与建队写入。
    // 这一步同时取代了原来那条晚到的失败（执行层拿路径反查不到项目），
    // 并且把「项目认不认这个根」这件事从执行层的猜变成命令层的断言。
    state.project_environment(&project_id)?;

    // 信任根（红线 8）+ 配置校验：两者都是 I/O 或依赖规范化后的根 ⇒ 同一个阻塞池任务
    // （红线 3）。顺序即契约：先有根，再判「默认 worktree 是否落在根内」。
    let runtime = Arc::clone(&state.runtime);
    let config = config.unwrap_or_default();
    let config_for_check = config.clone();
    let root = runtime
        .spawn_blocking(move || -> Result<PathBuf, AppError> {
            let root = canonical_project_root(&project_path)?;
            bootstrap::validate_config(&config_for_check, &root)?;
            Ok(root)
        })
        .await
        .map_err(|err| AppError::Unknown(format!("resolving the project path failed: {err}")))??;

    // 纯计划：准入拒绝（包括「起得来但连不上工具面」）全部发生在写库之前。
    let now = now_millis();
    let plan = plan_team(
        &agent_id,
        &project_id,
        &root,
        name.as_deref(),
        &new_team_id(now),
        now,
        &config,
    )?;

    // 团队 + 队长一次写入。
    let manager = Arc::clone(&state.team_manager);
    let (team, lead) = (plan.team.clone(), plan.lead.clone());
    runtime
        .spawn_blocking(move || manager.create_team_with_lead(team, lead))
        .await
        .map_err(|err| AppError::Unknown(format!("creating the team failed: {err}")))??;

    // 与成员**完全同一条**执行路径：签发凭证（并认门）→ 起 PTY → 回填句柄。
    // 这里只调动作、不碰工具回复的类型 —— 本地入口不该依赖 MCP 的词汇。
    execution::start_member(
        surface.credentials.as_ref(),
        surface.executor.as_ref(),
        &plan.lead.id,
    )
    .await?;

    let terminal_id = state
        .team_manager
        .member(&plan.lead.id)
        .and_then(|member| member.terminal_id);

    log::info!(
        "[agent-team] team {} started with lead {} ({})",
        plan.team.id,
        plan.lead.id,
        agent_id
    );
    Ok(TeamSession {
        team_id: plan.team.id,
        member_id: plan.lead.id,
        terminal_id,
        endpoint_url: surface.endpoint_url,
        lead_agent_id: plan.lead.agent_id,
    })
}

/// 面板的**能力面**：每个可选 agent 一条 `{ agentId, refusal }`。
///
/// 面板据此置灰并显示原因（prd R0.4：能力缺口必须在 UI 上可见，而不是让用户点到
/// 必然失败的按钮）。
///
/// # 只做三件事（红线 6）
///
/// 取 id 列表 → 交给纯函数 → 返回。准入判定**不在命令里**：它是
/// [`admission::launchable_agents`]（`builtin_configs` × `admission_for` × `launch_refusal`），
/// 与 `team_spawn` / `start_team_session` 共用同一个判据。命令里再写一遍的后果是
/// 「面板说能起、`team_spawn` 拒绝」——两侧各有一套真相，用户看到的是两个互相矛盾的回答。
///
/// # 为什么要包含“不在准入表里”的 agent
///
/// 用户自定义 CLI 就在那份清单里（`AgentManager` 含用户覆盖）。静默漏掉它们，面板上
/// 就不会出现那些永远起不来的选项 —— 看起来像“不支持”，实际是“我们没说”。
///
/// 锁定读出一个 id 清单（`Mutex` 不是阻塞 I/O，不进阻塞池）。
/// 角色决定问哪一条判据：`"lead"` 会额外问「它能不能收到角色 preamble」，
/// 因为队长起来之后没有人能替它 trigger 第一个动作（成员可以靠 `team_send` 的第一条消息）。
/// **不给隐藏默认**：面板的队长选择器传 `lead`，别处传 `worker`，写错了立刻报错而不是悄悄降级。
#[tauri::command]
pub fn team_launchable_agents(
    state: tauri::State<'_, AppStateWrapper>,
    role: String,
) -> Result<Vec<LaunchableAgent>, AppError> {
    let agent_ids: Vec<String> = state
        .agent_manager
        .lock()
        .map_err(AppError::from)?
        .get_agents()
        .into_iter()
        .map(|config| config.id)
        .collect();
    let role = match role.as_str() {
        "lead" => MemberRole::Lead,
        "worker" => MemberRole::Worker,
        other => {
            return Err(AppError::InvalidInput(format!(
                "`role` must be `lead` or `worker`, got `{other}`"
            )))
        }
    };
    Ok(admission::launchable_agents(&agent_ids, role))
}

/// `team_close` 的返回（面板用）：**扁平**，不背 MCP 的工具信封（`{"closed": {...}}`）。
///
/// 面板与队长看到的是同一次关闭，只是信封不同：队长经工具面拿工具回复，
/// 面板经这条命令拿 `ClosedReply`；两者都由同一个
/// [`crate::agent::team::execution::CloseOutcome`] 构造，**没有第三份事实**。
///
/// # 为什么不复用工具回复
///
/// 工具回复是**线协议**词汇（变体名就是 wire 名、带 serde 属性、形状是外部标记枚举）。
/// 本地入口若认识它，就必须构造 `{"closed": {...}}` 那个信封或者解它的变体 —— 而这条命令的
/// 载荷是扁平的，两者形状本就不同。认识它的唯一后果是：团队域的本地入口被绑在一条它并不
/// 使用的协议上（改线协议会让面板跟着改）。判据：
/// `the_local_entry_does_not_depend_on_the_mcp_vocabulary`。
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClosedReply {
    /// 被关闭的团队。
    pub team_id: String,
    /// 单成员关闭的目标；整队关闭为 `None`。
    pub member_id: Option<String>,
    /// **本次真的关掉的**成员（决定层的待关列表在执行后回写成事实）。
    pub members_closed: Vec<String>,
    /// 关不掉的成员与原因。成功路径恒空 —— 有失败时整次调用以 `Err` 结束。
    pub members_failed: Vec<(String, String)>,
    /// 执行后的真实团队状态（整队成功 = `closed`；有成员关不掉 = `closing`）。
    pub team_state: TeamState,
    /// 诚实面：`graceful` 未兑现、队长自身 PTY 不由本次关闭、worktree 一律保留。
    pub notes: Vec<String>,
}

impl ClosedReply {
    /// 从**执行之后**的事实构造（唯一的构造点）。
    fn from_outcome(outcome: execution::EffectOutcome) -> Result<Self, AppError> {
        match outcome {
            execution::EffectOutcome::Closed(closed) => Ok(Self {
                team_id: closed.team_id,
                member_id: closed.member_id,
                members_closed: closed.members_closed,
                members_failed: closed.members_failed,
                team_state: closed.team_state,
                notes: closed.notes,
            }),
            other => Err(AppError::Unknown(format!(
                "closing a team produced {other:?} instead of a close outcome"
            ))),
        }
    }
}

/// 以**本机用户**身份关闭团队（面板入口）。
///
/// # 与 MCP 工具的关系
///
/// 同一个决策函数（`execution::plan_close`）与同一条执行路径
/// （`execution::apply_effect(Effect::Close(..))`）：差别只在「谁能关」—— MCP 走授权矩阵
/// （队长），本地走本机用户（本文件模块文档：本地入口不做 principal 校验）。**判据不许复制**，
/// 所以这里不重写任何关闭规则。
///
/// # 为什么走 `Effect` 而不是工具回复
///
/// `Effect` 是**领域**副作用（不是线协议词汇）：本入口只是「本机用户要求关闭」的另一个
/// 来源，它没有工具信封、也没有模型上下文。判据：
/// `the_local_entry_does_not_depend_on_the_mcp_vocabulary`。
///
/// # 顺序（design §7.1）
///
/// 决策（校验 + `Active → Closing` + 审计，写库 ⇒ 阻塞池）→ 执行（关 PTY → 归档成员 →
/// 作废凭证 → 全部成功才落 `closed`）。有成员关不掉时**停在 `closing`**，错误里点名，
/// 可重试 —— 这是可查询的诚实状态，不是半生不死。
///
/// # 为什么需要 `team_surface`
///
/// 执行那一半要 `credentials`（作废凭证）与 `executor`（关 PTY）。端点没起来时它们不存在，
/// 此时**不假装能关**：拒绝并说明原因（一个「关了但进程还在」的队比报错更糟）。
#[tauri::command]
pub async fn team_close(
    state: tauri::State<'_, AppStateWrapper>,
    team_id: String,
    member_id: Option<String>,
    graceful: Option<bool>,
) -> Result<ClosedReply, AppError> {
    let team_id = require_id(team_id, "team_id")?;
    let surface = state.team_surface().ok_or_else(no_endpoint)?;
    let manager = Arc::clone(&state.team_manager);
    let runtime = Arc::clone(&state.runtime);
    let now = now_millis();

    // 决策：写库 ⇒ 阻塞池（红线 3）。
    let plan = Arc::clone(&runtime)
        .spawn_blocking(move || {
            execution::plan_close(
                manager.as_ref(),
                &team_id,
                member_id.as_deref(),
                graceful.unwrap_or(true),
                now,
            )
        })
        .await
        .map_err(|err| AppError::Unknown(format!("planning the close failed: {err}")))??;

    // 执行：与 MCP 入口**同一条**路径（关 PTY → 归档 → 作废凭证 → 落终态）。
    let outcome = execution::apply_effect(
        &runtime,
        surface.credentials.as_ref(),
        surface.executor.as_ref(),
        &state.team_manager,
        &execution::Effect::Close(plan),
    )
    .await?;
    ClosedReply::from_outcome(outcome)
}

/// **永久删除**一个已关闭的团队（面板列表行上的「删除」）。
///
/// # 为什么这是第八个入口，而不是 `team_close` 的一个参数
///
/// 两件事的**不可逆程度**不同：关闭是可重试的（有成员关不掉时团队停在 `closing`，再调一次
/// 就是同一个目标集重走一遍）；删除把行连同成员 / 任务 / 审计一起抹掉，`team_list` 再也
/// 看不到它。把后者做成前者的参数（`team_close(destroy=true)`），等于让一次「重试关闭」
/// 的调用多带一个能毁数据的布尔 —— 而它长得和关闭一模一样。
///
/// # 为什么这里**不需要** `team_surface`
///
/// 关闭需要它（要 `credentials` 作废凭证、要 `executor` 关 PTY）。删除**一个已 `closed` 的
/// 队**两者都不需要：成员已全部归档（`token_hash` 清空、`terminal_id` 清空），进程按关闭
/// 协议已经不再被本域持有。所以端点没起来时「删一个已关的队」依然成立 —— 拒绝它只会让
/// 用户在端点故障时连清理历史都做不到。
///
/// 状态判据不在本层：它落在 [`TeamManager::delete_team`]（域内唯一写入口，红线 6）。
/// 这里只做「参数校验 + 进阻塞池」。
///
/// # 阻塞池（红线 3）
///
/// 删行是 SQLite 同步写（`TeamStore::delete_team`），且级联要删三张子表 —— 放进阻塞池。
///
/// 未知 `team_id` → `NotFound`；`active` / `closing` → `Conflict`（信息里点名状态与下一步）。
#[tauri::command]
pub async fn team_delete(
    state: tauri::State<'_, AppStateWrapper>,
    team_id: String,
) -> Result<(), AppError> {
    let team_id = require_id(team_id, "team_id")?;
    let manager = Arc::clone(&state.team_manager);
    run_blocking_result(move || manager.delete_team(&team_id)).await
}

/// 面板的**团队配置面**：这个队允许谁当成员 / 还能加几个 / 缺省值是什么。
///
/// # 两个出口，一个函数
///
/// - `team_id = None` → **建队前**的目录（池子 = 全部可启动、默认值 = 全局默认），
///   供面板在用户勾选之前展示可选项；
/// - `team_id = Some(id)` → 该团队的实际配置。
///
/// 两条都走 [`options::options_for`] / [`options::default_options`]（同一个 `resolve`），
/// 与 MCP 工具 `team_options` 同源 —— 面板与队长读到的是同一份推导，不是两份长得像的
/// 清单。**不要**在前端把 `team_launchable_agents` 与这里拼起来：前者是「这台机器上谁能
/// 当成员」，后者是「这个队允许谁」（含上限与默认）。
///
/// # 为什么这条命令**不**进阻塞池
///
/// 它读的两样东西都在 `TeamManager` 的内存镜像里（团队行 + 花名册计数），锁内无 I/O ——
/// 与 `team_snapshot`（走 `TeamStore::list_members`，真读库）不同。MCP 那一侧也只有
/// 同样的两样东西（端点不持有 `AgentManager`），所以两个出口在这一点上完全对称。
///
/// 未知 `team_id` → `NotFound`（与 `team_snapshot` 同一句话）。
#[tauri::command]
pub fn team_options(
    state: tauri::State<'_, AppStateWrapper>,
    team_id: Option<String>,
) -> Result<TeamOptions, AppError> {
    let Some(team_id) = team_id else {
        return Ok(options::default_options(0));
    };
    let team_id = require_id(team_id, "team_id")?;
    let team = state
        .team_manager
        .team(&team_id)
        .ok_or_else(|| AppError::NotFound(format!("team `{team_id}` is not loaded")))?;
    let member_count = state.team_manager.member_count(&team_id);
    Ok(options::options_for(&team, member_count))
}

/// 这台机器上有哪些团队（**重启后重开自己的队**的入口）。
///
/// # 为什么这条读命令不进阻塞池
///
/// [`view::list_teams`] 只读 `TeamManager` 的内存镜像（团队行 + 成员数 + 任务行都是 `load`
/// 时 hydrate 的，与库同一把锁内一起改），锁内**没有 I/O** —— 与 `team_options` 同一个理由。
/// 进阻塞池只会给一个纯内存读加一次线程跳转。
///
/// # 载荷有界（红线 4）
///
/// 至多 [`view::MAX_LISTED_TEAMS`] 行 + `truncated`：历史团队只增不减（app 重启会把它们全部
/// hydrate 回来），所以「列出所有队」必须有界，而不是靠「用户不会建很多队」。
///
/// # 不按队过滤
///
/// 它回答的是「这台机器上有哪些队」，不是「我所在的队」。与 MCP 工具 `team_list` 同源
/// （同一个 [`view::list_teams`]）。
#[tauri::command]
// project_id = 项目过滤（面板按 `activeProjectId` 传）；`None` = 不过滤（全部团队）。
pub fn team_list(
    state: tauri::State<'_, AppStateWrapper>,
    project_id: Option<String>,
) -> Result<view::TeamList, AppError> {
    Ok(view::list_teams_scoped(
        &state.team_manager,
        project_id.as_deref(),
    ))
}

// ── 角色库（persona 预设；v19）───────────────────────────────────────
//
// 三条都是**本机用户**的入口（无 principal，不碰授权矩阵 —— 与 `team_snapshot` 同一
// 分界，见 `team-domain.md` §8.4）。校验与镜像/库的一致性都在 `TeamManager`（唯一写
// 入口），命令层只做接收与转发（红线 6）。
//
// # 为什么是同步命令（与 `team_list` 同一理由）
//
// 读写都走 `TeamManager` 的镜像 + 锁内的库调用；它们是低频的用户动作（编辑角色库），
// 不是每帧都走的读路径。与 `team_list` 同步形态保持一致，不进阻塞池。

/// 全部角色预设（建队配置的「缺省角色」下拉与角色库管理面的数据源）。
///
/// 载荷有界（[`view::MAX_LISTED_ROLES`] + `truncated`），与 `team_list` 同一红线 4 纪律：
/// 单行有界不等于载荷有界（行数只增不减）。
#[tauri::command]
pub fn team_role_list(
    state: tauri::State<'_, AppStateWrapper>,
) -> Result<view::RoleList, AppError> {
    Ok(view::list_roles(&state.team_manager))
}

/// 保存（新增或编辑）一条角色预设。名字是主键：同名校 = 编辑。
///
/// 校验（非空 / 长度 / 控制字符）在 `TeamManager::save_role` —— persona 正文会进成员
/// argv，拒绝在保存时发生，不静默截断。
#[tauri::command]
pub fn team_role_save(
    state: tauri::State<'_, AppStateWrapper>,
    role: RolePreset,
) -> Result<(), AppError> {
    state.team_manager.save_role(role)
}

/// 删除一条角色预设；未知名字 → `NotFound`。
///
/// 已 spawn 的成员**不受影响**：它们的人设是成员行上的快照（`Persona`），不是引用。
#[tauri::command]
pub fn team_role_delete(
    state: tauri::State<'_, AppStateWrapper>,
    name: String,
) -> Result<(), AppError> {
    state.team_manager.delete_role(name.trim())
}

/// 团队快照（面板的数据源）。
///
/// 载荷：`{ team, members, tasks, tasksTruncated }`（camelCase，同仓里 `team_status` 的口径）。
/// `tasks` 里**没有** `body`（红线 4：派活正文长度无上限，见 [`view`] 的模块文档）；要正文
/// 走 [`team_task_detail`]。任务数超过 [`view::MAX_BOARD_TASKS`] 时截断并置
/// `tasks_truncated`（列载荷上界，不是分页）。
///
/// 未知 `team_id` → `NotFound`（信息里带 id）。
#[tauri::command]
pub async fn team_snapshot(
    state: tauri::State<'_, AppStateWrapper>,
    team_id: String,
) -> Result<TeamSnapshot, AppError> {
    let team_id = require_id(team_id, "team_id")?;
    let manager = Arc::clone(&state.team_manager);
    run_blocking_result(move || view::team_snapshot(&manager, &team_id)).await
}

/// 单个任务的详情（**点开才拉**）：列视图 + 派活正文。
///
/// 与「成员 transcript 按需拉取」同一条原则（design §7.3）：默认载荷只带恒定小的列，
/// 正文/全文只在用户真的要看的时候走一次 IPC。
///
/// # 两个参数都必填，且顺序固定 `(team_id, task_id)`
///
/// 任务 id 是**队内**标识符（每个队的板都从 `t1` 开始），所以 `task_id` 单独一个不构成
/// 寻址（[`TaskRef`]）。这里是**本地 IPC**入口，没有 principal 可以代答「哪个队」——
/// 模型侧（MCP 工具）的 `team_id` 来自 token，本机面板的只能由调用方显式给
/// （`TaskCard::team_id` 就是让它不必猜父级的那一列）。
///
/// 未知 `(team_id, task_id)` 组合 → `NotFound`。**不许回落到别的队的同名任务**：
/// 那正是「`t1` 在每个队都存在」这个事实的反面事故。
#[tauri::command]
pub async fn team_task_detail(
    state: tauri::State<'_, AppStateWrapper>,
    team_id: String,
    task_id: String,
) -> Result<TaskDetail, AppError> {
    let team_id = require_id(team_id, "team_id")?;
    let task_id = require_id(task_id, "task_id")?;
    let manager = Arc::clone(&state.team_manager);
    run_blocking_result(move || view::task_detail(&manager, &TaskRef::new(team_id, task_id))).await
}

/// 单个**成员**的详情（**点开才拉**）：花名册行 + 任务 + 待批队列 + 最近事件。
///
/// 与 `team_snapshot` 的分工是红线 4 的时间维度：花名册是「每行恒定小字段」，每次脉冲都要
/// 拉一遍；而这里带任务行与 50 条事件 —— 放进快照就是「每次派活都搬一遍全部成员的全部事件」。
/// 所以它只在用户点开一个成员时走一次 IPC。
///
/// # 三个上界（都在 `view` 里，命令不重复实现）
///
/// - `tasks` ≤ [`view::MAX_BOARD_TASKS`]（+ `tasksTruncated`）；
/// - `awaitingApproval` 是 `tasks` 的子集（AC5 待批队列）；
/// - `events` ≤ [`view::MAX_MEMBER_EVENTS`]（+ `eventsTruncated`），**SQL 侧就有 `LIMIT`**。
///
/// # 读库 ⇒ 阻塞池（红线 3）
///
/// 事件流走 `TeamStore::member_events`（rusqlite 同步 API）。与 `team_snapshot` 同一条路径。
///
/// 未知 `member_id` → `NotFound`（信息里带 id）。成员属于哪个队由它的行回答，
/// 不受调用方传入的团队影响（成员 id 自带 `@{team}` 后缀，但这里**不拆字符串**）。
#[tauri::command]
pub async fn team_member_detail(
    state: tauri::State<'_, AppStateWrapper>,
    member_id: String,
) -> Result<MemberDetail, AppError> {
    let member_id = require_id(member_id, "member_id")?;
    let manager = Arc::clone(&state.team_manager);
    run_blocking_result(move || view::member_detail(&manager, &member_id)).await
}

/// id 入参的**唯一**校验：不能为空。
///
/// 空白 id 给一句 `InvalidInput` 而不是让它落成 `NotFound`：两者对调用方含义完全不同
/// （「你传错了」vs「它不在了」），而 `team_id: ""` 几乎只能是面板的 bug。
fn require_id(value: String, field: &str) -> Result<String, AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidInput(format!("{field} must not be empty")));
    }
    Ok(trimmed.to_owned())
}

/// 一条统一的拒绝：「团队端点没起来」。
///
/// 两类调用（凭证 / URL）拿到**同一句**话：它们缺的是同一个东西，给两种措辞只会让
/// 排查者以为是两个故障。
fn no_endpoint() -> AppError {
    AppError::Unsupported(
        "the team mcp endpoint is not running, so a lead could not reach the tool surface; \
         refusing to create a team that has no way to be driven"
            .to_string(),
    )
}

/// 项目路径 → 规范化后的团队根。
///
/// **调用契约：必须在阻塞池里调**（`canonicalize` 是 `std::fs`，红线 3）。本函数不自己
/// `spawn`，与 `plan_member_spawn` / `TeamManager` 的取舍一致 —— 谁在 async 上下文里，
/// 谁负责把同步 I/O 挪出去。
///
/// 三条都在这一层判，因为它们共用同一个 I/O：
/// ① 存在且是目录（否则成员 PTY 的 `cwd` 起不来）；
/// ② `canonicalize`（`..` / 符号链接在 `starts_with` 判据下会产生与肉眼相反的答案，红线 8）；
/// ③ 规范化后仍是绝对路径（Windows 的 `\\?\` 前缀由 `canonicalize` 自己给出，这里只复核）。
fn canonical_project_root(raw: &str) -> Result<PathBuf, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidInput(
            "project_path must not be empty".to_string(),
        ));
    }
    let path = Path::new(trimmed);
    let canonical = std::fs::canonicalize(path)
        .map_err(|err| AppError::Io(format!("project path {trimmed} is not usable: {err}")))?;
    if !canonical.is_dir() {
        return Err(AppError::InvalidInput(format!(
            "project path {trimmed} is not a directory"
        )));
    }
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::team::admission::LaunchableAgent;

    /// **注册判据**：`#[tauri::command]` 的集合与 `neeko_invoke_handler!` 的列表必须双向一致。
    ///
    /// # 为什么这条边两侧的单测都天然绕过
    ///
    /// 漏注册一行的症状是**前端** `command not found`（`invoke("team_close")` 被拒），而
    /// - 后端的每条命令测试都**直接调函数**（注册与否无关）；
    /// - 前端测试用 mock 的 `invoke`（不需要真命令名存在）。
    ///
    /// 2026-11-03 的独立审计确认了这一点：从 `lib.rs` 删掉 `team_close,` 之后，
    /// 全量 2761 条测试一条不红。注册表是**宏表**，不是类型 —— 编译器不会替你数。
    ///
    /// 两个方向都有真实形态：
    /// - **前向**（漏注册）：函数写着、命令调不到 —— 本用例点名缺哪一个；
    /// - **反向**（死注册 / 指错域）：列表里留着本模块早已没有的名字（或路径指到了
    ///   `hooks::commands` 里的同名命令）—— 名字相同不等于域相同。
    ///
    /// `concat!` 是必需的：`include_str!` 会把本用例自己也读进来，裸字面量会匹配到断言本身。
    #[test]
    fn every_team_command_is_registered_in_the_invoke_handler() {
        let source = include_str!("commands.rs");
        let declared = tauri_command_names(source);
        assert!(
            declared.len() >= 9,
            "只抽到 {} 条 `#[tauri::command]`（{:?}）：解析规则漂了，早先 9 条",
            declared.len(),
            declared
        );
        // 每条属性都必须真的挂上一个函数（否则下面两个方向的比对都少一格）。
        let attribute_lines = source
            .lines()
            .filter(|line| line.trim() == concat!("#[tauri::", "command]"))
            .count();
        assert_eq!(
            declared.len(),
            attribute_lines,
            "有 `#[tauri::command]` 后面没跟 `pub (async) fn`：{:?}",
            declared
        );

        // 注册表：**只认本模块的路径**（别的域的同名命令不算数）。
        let registry = include_str!("../../lib.rs");
        let prefix = concat!("agent::team::", "commands::");
        let mut registered: Vec<String> = Vec::new();
        let mut rest = registry;
        while let Some(at) = rest.find(prefix) {
            let after = &rest[at + prefix.len()..];
            let name: String = after
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                .collect();
            assert!(
                !name.is_empty(),
                "`{prefix}` 后面没有命令名：注册表被截断或换了写法，本用例的解析需要同步"
            );
            registered.push(name);
            rest = after;
        }
        assert!(
            !registered.is_empty(),
            "`neeko_invoke_handler!` 里一条团队命令都没有 —— 团队面板的所有入口都会 `command not found`"
        );

        let mut missing: Vec<&str> = declared
            .iter()
            .map(String::as_str)
            .filter(|name| !registered.iter().any(|registered| registered == name))
            .collect();
        missing.sort_unstable();
        assert!(
            missing.is_empty(),
            "这些 `#[tauri::command]` 没有注册进 `neeko_invoke_handler!`：{missing:?} —— \
             前端调到它们时是 `command not found`，而后端（直调函数）与前端的\
             （mock `invoke`）单测都不会红"
        );

        let mut dead: Vec<&str> = registered
            .iter()
            .map(String::as_str)
            .filter(|name| !declared.iter().any(|declared| declared == name))
            .collect();
        dead.sort_unstable();
        dead.dedup();
        assert!(
            dead.is_empty(),
            "注册表里有 commands.rs 中不存在的团队命令：{dead:?}（删了函数留下注册，\
             或路径指到了别的域的同名命令 —— 名字相同不等于域相同）"
        );
    }

    /// 抽出 `#[tauri::command]` 之后的函数名（`pub async fn` / `pub fn`，允许中间夹属性与注释）。
    ///
    /// 只认「**整行就是这条属性**」：模块文档里提到它（`//! 团队域的 \`#[tauri::command]\`…`）
    /// 不算声明 —— 否则会给后面第一个函数挂上一个莫须有的“已声明”。
    fn tauri_command_names(source: &str) -> Vec<String> {
        let marker = concat!("#[tauri::", "command]");
        let mut names: Vec<String> = Vec::new();
        let mut lines = source.lines();
        while let Some(line) = lines.next() {
            if line.trim() != marker {
                continue;
            }
            for next in lines.by_ref() {
                let candidate = next.trim();
                let Some(rest) = candidate
                    .strip_prefix("pub async fn ")
                    .or_else(|| candidate.strip_prefix("pub fn "))
                else {
                    continue;
                };
                names.push(rest.split('(').next().unwrap_or(rest).trim().to_owned());
                break;
            }
        }
        names
    }

    /// 夹具路径由 manifest 目录推导（红线 13：不许手写平台相关的绝对路径）。
    const ROOT: &str = env!("CARGO_MANIFEST_DIR");

    #[test]
    fn a_project_root_is_canonicalized() {
        let root = canonical_project_root(ROOT).expect("manifest 目录可用");
        assert!(root.is_absolute());
        // 规范化是幂等的：这正是「同一棵树只有一种字符串身份」的要求。
        assert_eq!(
            root,
            canonical_project_root(&root.to_string_lossy()).expect("再规范化一次")
        );
    }

    #[test]
    fn an_empty_or_missing_project_root_is_refused() {
        let err = canonical_project_root("  ").expect_err("空路径必须拒绝");
        assert!(matches!(err, AppError::InvalidInput(_)), "{err:?}");

        // 夹具由 manifest 目录推导（红线 13：不写平台相关的绝对路径）。
        let missing = Path::new(ROOT).join("this-directory-does-not-exist");
        let err =
            canonical_project_root(&missing.to_string_lossy()).expect_err("不存在的路径必须拒绝");
        assert!(matches!(err, AppError::Io(_)), "{err:?}");
    }

    /// 命令载荷的**线上键名**必须与前端镜像一致（camelCase）。
    ///
    /// 这条测试的存在理由是一次真实事故：`TeamSession` 少了 `#[serde(rename_all = "camelCase")]`，
    /// 于是前端收到的是 `{ team_id, terminal_id, ... }`，而它读的是 `session.teamId` /
    /// `session.terminalId` —— 表现是「团队『undefined』已建立，但队长进程没有落地」：
    /// 命令成功、队长 PTY 也在跑，界面上却什么都没发生。
    ///
    /// 为什么断言**键集**而不是字段值：字段名对了不代表 wire 上名字对了，序列化口径只能从
    /// JSON 侧看。为什么还要扫一遍下划线：新增载荷时漏加属性是同一个错误，而它在结构体
    /// 定义处完全看不出来。
    #[test]
    fn every_command_payload_uses_camel_case_wire_keys() {
        let session = TeamSession {
            team_id: "tm_1".into(),
            member_id: "lead@tm_1".into(),
            terminal_id: Some("term-1".into()),
            endpoint_url: "http://127.0.0.1:1/team/mcp".into(),
            lead_agent_id: "claude-code".into(),
        };
        let launchable = LaunchableAgent {
            agent_id: "pi".into(),
            refusal: Some("nope".into()),
        };
        let closed = ClosedReply {
            team_id: "tm_1".into(),
            member_id: Some("w1@tm_1".into()),
            members_closed: vec!["w1@tm_1".into()],
            members_failed: Vec::new(),
            team_state: TeamState::Closing,
            notes: vec!["note".into()],
        };

        // 团队配置面的两个载荷也走 IPC（面板建队前/后都读它）。
        let options = crate::agent::team::options::default_options(0);
        // 团队清单（重启后重开自己的队）：行 + 截断标记。
        let teams = view::TeamList {
            teams: Vec::new(),
            truncated: false,
        };
        // 成员详情（抽屉）：成员行 + 任务 + 待批队列 + 事件流。
        let member_detail = MemberDetail {
            member: crate::agent::team::fixtures::fixture_member_status("w1@tm_1"),
            tasks: Vec::new(),
            tasks_truncated: false,
            awaiting_approval: Vec::new(),
            events: vec![view::MemberEventView {
                at: 1,
                kind: "claim".into(),
                actor: "w1@tm_1".into(),
                subject: Some("t1".into()),
                detail: None,
            }],
            events_truncated: true,
        };

        // 角色库命令的载荷（v19）：`team_role_list` 的行形态。
        let role = RolePreset {
            name: "研究员".into(),
            preamble: "Research only.".into(),
            cli_preference: Some("claude-code".into()),
            approval_policy: Some(crate::agent::team::types::ApprovalPolicy::Queue),
            default_workspace: Some(crate::agent::team::types::Workspace::ReadOnly),
            created_at: 1,
        };

        let payloads = [
            ("TeamSession", serde_json::to_value(&session).unwrap()),
            ("RolePreset", serde_json::to_value(&role).unwrap()),
            (
                "LaunchableAgent",
                serde_json::to_value(&launchable).unwrap(),
            ),
            ("TeamOptions", serde_json::to_value(&options).unwrap()),
            (
                "TeamOptions.defaults",
                serde_json::to_value(&options.defaults).unwrap(),
            ),
            ("TeamList", serde_json::to_value(&teams).unwrap()),
            ("ClosedReply", serde_json::to_value(&closed).unwrap()),
            (
                "MemberDetail",
                serde_json::to_value(&member_detail).unwrap(),
            ),
            (
                "MemberDetail.member",
                serde_json::to_value(&member_detail.member).unwrap(),
            ),
            (
                "MemberEventView",
                serde_json::to_value(&member_detail.events[0]).unwrap(),
            ),
        ];

        for (name, json) in payloads {
            let keys: Vec<&str> = json
                .as_object()
                .unwrap_or_else(|| panic!("{name} 必须是对象"))
                .keys()
                .map(String::as_str)
                .collect();
            assert!(
                keys.iter().all(|key| !key.contains('_')),
                "{name} 的线上键名必须是 camelCase，实际 {keys:?}"
            );
        }

        let session_json = serde_json::to_value(&session).unwrap();
        let mut sorted: Vec<&str> = session_json
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        sorted.sort_unstable();
        assert_eq!(
            sorted,
            vec![
                "endpointUrl",
                "leadAgentId",
                "memberId",
                "teamId",
                "terminalId"
            ],
            "前端的 TeamSession 镜像依赖这五个键"
        );
    }

    /// **源码级判据**：本地入口不得依赖 MCP 的词汇。
    ///
    /// # 为什么只能看源码
    ///
    /// 「本地入口不该依赖 MCP 的词汇」是把 `plan_close` 搬进 `execution` 的**唯一**理由。
    /// 一旦有人把工具回复的类型 import 回来（为了省一次映射），这条裁决就被悄悄推翻了，而
    /// **所有行为测试依然是绿的** —— 两种写法都跑得通，差别只在依赖方向上。所以判据只能
    /// 读源码。
    ///
    /// `concat!` 是必需的：`include_str!` 会把本测试自己也读进来，字面量会匹配到断言本身。
    #[test]
    fn the_local_entry_does_not_depend_on_the_mcp_vocabulary() {
        let source = include_str!("commands.rs");
        for needle in [concat!("mc", "p::"), concat!("Tool", "Reply")] {
            assert!(
                !source.contains(needle),
                "commands.rs 里出现了 `{needle}` —— 本地入口不该认识工具回复（MCP 词汇）：\
                 副作用用 `execution::Effect`，结果用 `execution::EffectOutcome`"
            );
        }
    }

    /// 文件（不是目录）不能当团队根：成员 PTY 的 cwd 会是它，`create_session` 会失败得
    /// 更难懂。判据放在这里，错误就有可读来源。
    #[test]
    fn a_file_is_not_a_team_root() {
        let file = Path::new(ROOT).join("Cargo.toml");
        let err = canonical_project_root(&file.to_string_lossy()).expect_err("文件不是目录");
        assert!(matches!(err, AppError::InvalidInput(_)), "{err:?}");
    }

    /// 空白 id 是**入参错误**，不是 `NotFound`：两者对面板的含义完全不同
    /// （「你传错了」vs「它不在了」），而空串几乎只能是面板的 bug。
    #[test]
    fn an_id_is_validated_before_reaching_the_manager() {
        let err = require_id("   ".to_string(), "team_id").expect_err("空白 id");
        assert!(matches!(err, AppError::InvalidInput(_)), "{err:?}");
        assert!(err.to_string().contains("team_id"), "{err}");
        assert_eq!(require_id(" tm_1 ".to_string(), "team_id").unwrap(), "tm_1");
    }

    /// 建队前（`team_id = None`）的目录就是**全局默认**：池子 = 全部可启动、默认值 = 默认值、
    /// 成员数 = 0。
    ///
    /// 保护的不变量：面板在用户还没建队时也必须能渲染可选项；而它渲染的必须是**同一条**
    /// 推导（`options::default_options`）—— 面板自己拼一份的话，用户勾完选项进入「已建队」
    /// 视图的那一刻会看到两份不同的清单。
    #[test]
    fn the_pre_team_catalogue_is_the_global_default() {
        let catalogue = crate::agent::team::options::default_options(0);
        assert_eq!(catalogue.defaults.member_count, 0);
        assert_eq!(
            catalogue.defaults.max_members,
            crate::agent::team::types::DEFAULT_MAX_MEMBERS
        );
        assert!(
            !catalogue.members.is_empty(),
            "本机至少有一个可启动的成员 CLI（准入表里的 A 档）"
        );
        assert!(catalogue.defaults.allowed_agent_ids.len() == catalogue.members.len());
    }

    /// 端点缺失的两种调用拿到同一句理由（它们是同一个前提）。
    #[test]
    fn a_missing_endpoint_has_one_readable_reason() {
        let err = no_endpoint();
        assert!(matches!(err, AppError::Unsupported(_)), "{err:?}");
        assert!(err.to_string().contains("team mcp endpoint"), "{err}");
    }
}
