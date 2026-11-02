//! MCP 工具调用 → `TeamManager`（design §4.2 的**唯一**调度点）。
//!
//! # 这一层做什么，不做什么
//!
//! 做三件事，顺序固定（顺序本身就是契约）：
//!
//! 1. **翻译** `wire` 名 → [`ToolName`]；未知 → `NotFound` 且错误信息列出已知工具名
//!    （模型据此自我纠正，而不是收到一句 "unknown tool"）。
//! 2. **授权** [`crate::agent::team::authorize::authorize`]（只看角色）。
//! 3. **入参校验**（存在性 / 归属 / 状态闭集）后**委派**给 `TeamManager` 的既有方法。
//!
//! 不做：状态机裁决（`manager`/`completion`）、租约计算（`lease`）。投递与起进程都是
//! **执行层**的事（`team_send` 只返回 [`ToolReply::NeedsDelivery`]、`team_spawn` 只返回
//! [`ToolReply::MemberCreated`]），消费侧是 [`crate::agent::team::execution::apply_effect`]
//! —— 那是决策 → 执行的**唯一**交接点：本函数不写任何字节、不起任何进程。
//!
//! # 线协议词汇只在本文件与 handler 之间出现（[`effect_for`] / [`reply_for`]）
//!
//! `ToolReply` 是**线协议**词汇（变体名就是 wire 名、整段会进模型上下文）。执行层因此不认识
//! 它，只认识领域副作用 [`crate::agent::team::execution::Effect`]：
//!
//! ```text
//! ToolReply ──effect_for──▶ Option<Effect> ──apply_effect──▶ EffectOutcome ──reply_for──▶ ToolReply
//! ```
//!
//! 两个箭头各只有一份实现：本文件负责「回复 → 副作用」与「结果 → 回复」，执行层负责「副作用
//! → 动手」。于是新增一个工具时漏加翻译会以**编译错误**出现（`effect_for` 的 `match` 没有
//! `_` 分支），而不是让那个工具的副作用静默地不发生。
//! 回复只携带「队长能行动的信息」—— 执行参数从成员行推导，不随回复走（见该变体的文档）。
//!
//! # 入口：生产只有 [`call_async`]
//!
//! `team_wait` 必须在**工具调用内**阻塞（design §4.3：队长物理上无法边等边干活），
//! 而阻塞需要 `.await`；同时写库工具必须进阻塞池（红线 3）。两条都由 [`call_async`]
//! 兑现，所以它是唯一的生产入口。同步的 [`call`] 是 `#[cfg(test)]` —— 留一个能在
//! async 上下文直接调的同步入口，等于给「把 SQLite 写回 tokio worker」留后门。
//!
//! 两者共用同一份翻译 / 授权 / 同步分支：复制第二份授权矩阵会让「worker 能不能调 X」
//! 出现两个会漂移的答案。
//!
//! # 载荷契约（红线 4）
//!
//! [`ToolReply`] 里**任何字段都不得承载 transcript**。`Status` 视图只有 id / 名字 /
//! 状态 / 租约剩余秒 + 三个计数（恒定小载荷）；成员全文走 `conversation` 分页
//! （design §7.3）。`Tasks` 变体返回的是板上的任务行——它们的 `summary` 已由
//! `store::clamp_summary` 截到 4 KiB，且**不含**任何工具输出片段。
//! `Wait` 变体更窄：成员行只有 `id/name/role/state/verification`，任务行只有
//! `id/state/owner/reclaim_count/租约剩余秒`（连 `summary` 都不带 —— 等待是长轮次调用，
//! 回来的必须是「还在跑吗」而不是一份可用它替代 `team_status` 的板视图）。
//!
//! # 错误信息的可读性要求
//!
//! 错误是写给**队长模型**看的提示，不是给日志看的状态码。所以每条错误都必须说清
//! 「哪个工具、哪个入参、允许什么」。这也是为什么本层不用 `AppError::Unknown`。

use crate::agent::team::admission::{admission_for, refusal, tier_of};
use crate::agent::team::authorize::authorize;
use crate::agent::team::delivery;
use crate::agent::team::execution;
use crate::agent::team::manager::{now_millis, TeamManager};
use crate::agent::team::mcp::schema::{self, spec_for, ToolName, UPDATABLE_STATES};
use crate::agent::team::options::{options_for, TeamOptions};
use crate::agent::team::types::{
    AdmissionTier, ApprovalPolicy, MemberRole, MemberState, TaskRef, Team, TeamMember,
    TeamPrincipal, TeamState, TeamTask, TeamTaskState, WorkerChannel, Workspace,
};
use crate::agent::team::view::{self, team_status_view, TeamStatusView};
use crate::agent::team::wait::{WaitOutcome, WaitTargets, WaitUntil};
use crate::common::error::AppError;

/// `task_create` 未指定 `lease_ttl` 时的默认租约（秒）—— 与 `TeamTask.lease_ttl` 的
/// 文档口径一致（30 分钟）。
pub const DEFAULT_LEASE_TTL_SECS: i64 = 1800;

/// `team_wait` 的 `timeout_s` 上限（秒，30 分钟）。
///
/// 上限存在的意义是「不让一个写错的 timeout 把队长钉死半小时以上」，超出就截到它，
/// **不报错**（见 [`wait_timeout`] 的注释）。
pub const WAIT_TIMEOUT_MAX_SECS: i64 = 1800;

/// 一次工具调用的结果。
///
/// 变体即「调用方接下来该干什么」：`MemberCreated` 需要起进程、`NeedsDelivery` 需要投递、
/// `Closed` 需要收尾 PTY，其余是纯数据。**没有 `Text(String)` 变体是刻意的** ——
/// 自由文本会立刻退化成 transcript 通道（红线 4）。
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolReply {
    /// `team_status`：团队 + 成员 + 板摘要（恒定小载荷）。
    Status(TeamStatusView),
    /// `task_list`：板视图。
    Tasks(Vec<TeamTask>),
    /// `team_options`：这个队允许谁当成员 / 还能加几个 / 缺省值是什么（只读，无副作用）。
    ///
    /// 载荷与本地命令 `team_options` **同形同源**（`options::options_for`）：队长与面板
    /// 读到的是同一份推导，不是两份长得像的清单。
    Options(TeamOptions),
    /// `task_create` / `task_claim` / `task_update`：单个任务的最新态。
    Task(TeamTask),
    /// `team_spawn`：成员已落库，**待执行层起进程**（消费侧：`dispatch::effect_for` →
    /// `execution::apply_effect(Effect::StartMember)`）。
    ///
    /// 两相位与 `team_send → NeedsDelivery` 同构：本层不做任何进程副作用，
    /// 所以 PTY 起不来时成员是「已落库、可查询、可清理」的，而不是半生不死。
    ///
    /// # 为什么只有三个字段（执行参数不随回复走）
    ///
    /// 这条回复会进模型上下文（`tools/call` 的 `content[0].text`），所以它只应携带
    /// **收件人能行动的信息**：建出了谁（`member_id`）、它属于哪一档（`tier`）、
    /// 哪些能力没验过（`unverified`）。
    ///
    /// 执行层需要的东西（env / 注入方式 / 传输 / 旁路参数）**全部可以从已落库的行重新
    /// 推导**：`identity::member_env(team_id, member_id)` 由两个 id 算出，
    /// `admission_for(member.agent_id)` 给出注入方式与旁路参数，`member.approval_policy`
    /// 决定要不要追加。两个理由：
    ///
    /// 1. 把推导结果再传一遍 = 给同一件事实造第二个源（成员行改过之后，回复里的副本就错了）；
    /// 2. 同一个文件里已经写过「Schema 里多一个 dispatch 不读的参数，就是向模型声明一条
    ///    传了也没用的能力」—— **输出侧同理**：多一个接收方无法行动的字段，就是在邀请
    ///    模型去重放它。
    ///
    /// 机器判据：`member_row_carries_everything_the_executor_needs`。
    #[serde(rename_all = "camelCase")]
    MemberCreated {
        /// 成员 id（`{name}@{team}`）。
        ///
        /// **不含 token**：工具的返回值会进模型上下文，明文凭证不得经过模型。
        /// 凭证由端点的 `CredentialLedger::admit` 签发（与「让门认识它」同一动作），
        /// 随即交给执行层进启动参数 —— 全程不经过模型。
        member_id: String,
        /// 准入档位（由准入表推导，调用方不可声明）。
        tier: AdmissionTier,
        /// 未实测确认的点，原样回给队长（让他知道自己在用不确定的能力）。
        unverified: Vec<String>,
    },
    /// `team_send`：已通过全部校验，**待投递**（消费侧：`execution::apply_effect` →
    /// `MemberExecutor::deliver`，通道由执行层按成员的 `WorkerChannel` 选）。
    ///
    /// # 载荷是**投递文本**，不是发送者字段
    ///
    /// 接收方在 TUI 里只能看到一行文本，那行文本是它**唯一**的身份线索（没有发送者时，
    /// 队长收到 `1275` / `3775` 也分不清是谁在说话 —— 一次真实冒烟测试的现场）。所以发送者
    /// 身份必须进那一行字：本层（principal 在场）用
    /// [`crate::agent::team::delivery::delivery_text`] 把它拼好，执行层只负责把这段字节写进
    /// stdin。
    ///
    /// 因此 wire 上只有 `to` + `text`：**模型看到的是投递文本，不是发送者字段**。
    /// 一个 `from` 字段是模型无行动可做的执行参数（它既不能改也不能用），按
    /// 「执行参数不随工具回复走」的口径不该出现在这里 —— 同时它还会让「谁发的」在两个
    /// 地方各有一份（字段与正文里拼好的那一份），而两份迟早会不一致。
    #[serde(rename_all = "camelCase")]
    NeedsDelivery {
        /// 目标成员 id（队内）。
        to: String,
        /// **完整的投递文本**（`[team] {发送者}: {正文}`）—— 就是接收方会看到的那一行。
        text: String,
    },
    /// `team_close`：已校验的关闭目标（进程收尾与状态迁移由
    /// [`crate::agent::team::execution::apply_effect`] 的 `Close` 那一半完成）。
    ///
    /// # 字段都是一句话就能行动的信息（红线 14 的输出侧）
    ///
    /// | 字段 | 队长拿它做什么 |
    /// | --- | --- |
    /// | `member_id` | 单成员关闭时的目标；整队关闭时 `None` |
    /// | `members_closed` | 这次关闭涉及的成员（单成员 = 它自己；整队 = 待关列表）；成功返回时**就是刚刚被关掉的** |
    /// | `members_failed` | 失败面（成功返回时恒空：有失败就以错误结束）|
    /// | `team_state` | 关完之后团队在哪（`closing` = 还有成员没关掉；`closed` = 终态）|
    /// | `notes` | 诚实面：本期没兑现的东西（`graceful` / 保留的 worktree 路径）|
    ///
    /// `notes` 存在而不是静默：`graceful=true` **本期不会被真正兑现**（没有 shutdown 协议
    /// 可发），不说就等于让队长以为成员做过收尾。
    #[serde(rename_all = "camelCase")]
    Closed {
        /// 被关闭的团队。
        team_id: String,
        /// 单成员关闭的目标；整队关闭 = `None`。
        member_id: Option<String>,
        /// 本次确实关掉的成员（队长据此知道还剩谁）。
        members_closed: Vec<String>,
        /// 关不掉的成员与原因。
        ///
        /// **成功返回时恒为空**：有成员关不掉时整次调用以 `Err` 结束（错误文案逐个点名），
        /// 这个载荷根本不会到模型手里。它保留为失败面的形状 —— 逆命题：若哪天允许部分成功，
        /// 这个键已经在这里了。
        members_failed: Vec<(String, String)>,
        /// 团队当前状态（`closing` = 还有成员没关掉）。
        team_state: TeamState,
        /// 诚实面：`graceful` 本期是否真的被兑现（为什么不是），以及没有删除的目录。
        notes: Vec<String>,
    },
    /// `team_list`：这台机器上**全部**团队（不按队过滤，只读）。
    ///
    /// 载荷与本地命令 `team_list` 同形同源（[`crate::agent::team::view::list_teams`]）：
    /// 队长与面板读到的是同一份推导，不是两份长得像的清单。
    TeamList(crate::agent::team::view::TeamList),
    /// `team_wait`：Satisfied / Timeout / TargetGone 三结局之一（design §4.3）。
    ///
    /// 超时落在这里的 `Timeout` 而不是 `Err` —— 调用方拿到的是**现状**，不是失败。
    Wait(WaitOutcome),
}

/// 执行一次工具调用。
///
/// 顺序固定（顺序本身就是契约）：**翻译 → 授权 → 入参校验 → 委派**。
/// 授权在校验之前：未授权的主体不应该能通过错误信息探测团队内部状态
/// （例如用 `task_claim` 猜哪个 `task_id` 存在）。
///
/// # 为什么还有个 [`call_async`]，以及本函数为什么是 `#[cfg(test)]`
///
/// `team_wait` 必须**在工具调用内阻塞**（design §4.3：队长物理上无法边等边干活），
/// 而阻塞需要 `.await`；**且**所有写库工具必须进阻塞池（红线 3）。两条都由
/// [`call_async`] 兑现，所以**生产路径只有 `call_async` 一个入口**。
///
/// 本函数刻意只在测试期存在：留一个可在 async 上下文直接调的同步入口，等于给
/// 「把 SQLite 写回 tokio worker」留一道后门 —— 那正是红线 3 要防的。将来若真有同步
/// 调用方（如 stdio bridge 的同步分支），它应当**自己**在阻塞池里调 [`dispatch_tool`]。
#[cfg(test)]
fn call(
    manager: &TeamManager,
    principal: &TeamPrincipal,
    wire: &str,
    args: &serde_json::Value,
) -> Result<ToolReply, AppError> {
    let tool = resolve(wire)?;
    authorize(principal, tool)?;
    ensure_team_accepts(manager, principal, tool)?;
    dispatch_tool(manager, principal, tool, args)
}

/// 异步入口：与 [`call`] 共用**同一份**翻译、授权与入参校验，只多两条分支。
///
/// 两份授权实现会让「worker 能不能调 team_wait」出现两个答案，所以这里**不**复制
/// 任何判定 —— 它只把两格叉出去，其余一律回落到 [`dispatch_tool`]。
///
/// # 红线 3：这里是全链路**唯一**的异步边界
///
/// `rusqlite` 是阻塞 API，而 `tokio` worker 是稀缺共享资源（同批还跑 IPC / LSP / 终端）。
/// `TeamManager` 因此保持**同步**（它的模块文档写明「调用方负责把整次调用放进
/// `spawn_blocking`」），由本函数兑现那份契约：
///
/// - `team_wait`：等待循环只读内存快照、不碰 SQLite → 留在异步侧（阻塞它就等于阻塞
///   一个 worker 直到超时，那才是最坏形态）；
/// - 其余工具：**一律进阻塞池** —— 它们是唯一会写库的一类。
///
/// 把 `spawn_blocking` 摊到每个工具函数里会得到 8 个「别忘了」的点；收口在这里后，
/// 新增工具默认就是安全的（想不安全得主动绕开本函数）。
pub async fn call_async(
    runtime: &crate::common::runtime::AppRuntime,
    manager: &std::sync::Arc<TeamManager>,
    principal: &TeamPrincipal,
    wire: &str,
    args: &serde_json::Value,
) -> Result<ToolReply, AppError> {
    let tool = resolve(wire)?;
    authorize(principal, tool)?;
    ensure_team_accepts(manager, principal, tool)?;
    match tool {
        ToolName::TeamWait => team_wait(manager, principal, args).await,
        other => {
            let manager = std::sync::Arc::clone(manager);
            let principal = principal.clone();
            let args = args.clone();
            runtime
                .spawn_blocking(move || dispatch_tool(&manager, &principal, other, &args))
                .await
                .map_err(|err| {
                    AppError::Storage(format!(
                        "team tool dispatch panicked or was cancelled: {err}"
                    ))
                })?
        }
    }
}

/// wire 名 → [`ToolName`]；未知时列出已知工具名（模型据此自我纠正）。
fn resolve(wire: &str) -> Result<ToolName, AppError> {
    schema::lookup(wire).ok_or_else(|| {
        AppError::NotFound(format!(
            "unknown tool `{wire}`; known tools: {}",
            schema::known_wires()
        ))
    })
}

/// 逐工具的同步分支。
///
/// `match` 是穷尽的（不加 `_ =>`）：新增工具变体会在这里被追着处理 ——
/// 这正是 P2.4 加 `team_wait` 时发生的事。
fn dispatch_tool(
    manager: &TeamManager,
    principal: &TeamPrincipal,
    tool: ToolName,
    args: &serde_json::Value,
) -> Result<ToolReply, AppError> {
    match tool {
        ToolName::TeamStatus => status(manager, principal),
        ToolName::TeamList => Ok(ToolReply::TeamList(view::list_teams(manager))),
        ToolName::TeamOptions => options(manager, principal),
        ToolName::TeamSpawn => spawn(manager, principal, args),
        ToolName::TeamSend => send(manager, principal, args),
        ToolName::TaskCreate => create(manager, principal, args),
        ToolName::TaskClaim => claim(manager, principal, args),
        ToolName::TaskUpdate => update(manager, principal, args),
        ToolName::TaskList => list(manager, principal, args),
        // 阻塞需要 `.await`：同步入口拿到它只能是编程错误（调用方选错了入口）。
        ToolName::TeamWait => Err(AppError::Unsupported(format!(
            "{} must be awaited; call `dispatch::call_async` instead of `dispatch::call`",
            spec_for(ToolName::TeamWait).wire
        ))),
        ToolName::TeamClose => close(manager, principal, args),
    }
}

// ═══════════════════════════════════════════════════════════════════
// 关闭中的写门禁（唯一的实现点）
// ═══════════════════════════════════════════════════════════════════

/// 团队处于 `closing` / `closed` 时**仍允许**的工具（其余一律 `Conflict`）。
///
/// # 为什么是一张表而不是在每个 handler 里判
///
/// 「哪些工具在关闭中还能调」是一条域规则（design 的 `active → closing → closed` 状态机），
/// 而不是 11 个工具各自的巧合。写在表里还有一个直接收益：新增工具时它必须在**两种状态里**
/// 各被想一次 —— 否则新工具会静默地绕过整条状态机（表驱动测试守着这件事）。
///
/// - `team_close`：**必须**允许，否则一个关不干净的队永远关不了（重试路径）；
/// - `team_status` / `task_list` / `team_list`：只读，关完还要能查现状（面板的重开与归档
///   也靠它们）。
///
/// `closed` 与 `closing` 用同一张表：`closed` 只多一层「写操作已经不是 `Conflict` 而是
/// 无意义」的差别，而 `team_close` 本身对 `closed` 是幂等的。
const ALLOWED_WHILE_CLOSING: [ToolName; 4] = [
    ToolName::TeamStatus,
    ToolName::TaskList,
    ToolName::TeamList,
    ToolName::TeamClose,
];

/// 非 `active` 的团队只接受 [`ALLOWED_WHILE_CLOSING`] 里的工具。
///
/// 错误里带上**当前状态**：队长看到 `closing` 就知道「有人在关队」，看到 `closed` 就知道
/// 「这个队已经完了」—— 两者的下一步不同，把它们归成一句「不能写」会让模型去猜。
fn ensure_team_accepts(
    manager: &TeamManager,
    principal: &TeamPrincipal,
    tool: ToolName,
) -> Result<(), AppError> {
    if ALLOWED_WHILE_CLOSING.contains(&tool) {
        return Ok(());
    }
    let team = team_of(manager, &principal.team_id)?;
    if team.state == TeamState::Active {
        return Ok(());
    }
    Err(AppError::Conflict(format!(
        "team `{}` is {}; `{}` is not accepted in that state (allowed while closing/closed: {})",
        team.id,
        team_state_text(team.state),
        spec_for(tool).wire,
        ALLOWED_WHILE_CLOSING
            .iter()
            .map(|allowed| spec_for(*allowed).wire)
            .collect::<Vec<_>>()
            .join(", "),
    )))
}

/// 状态的线上文本（与 serde 的 `snake_case` 口径一致，错误信息与载荷因此不漂移）。
const fn team_state_text(state: TeamState) -> &'static str {
    match state {
        TeamState::Active => "active",
        TeamState::Closing => "closing",
        TeamState::Closed => "closed",
    }
}

// ═══════════════════════════════════════════════════════════════════
// 逐工具
// ═══════════════════════════════════════════════════════════════════

/// `team_status`：花名册 + 板摘要。
///
/// **载荷构造不在本层**：[`crate::agent::team::view::team_status_view`] 是唯一构造点，
/// 本地 Tauri 命令（`commands::team_snapshot`）用的是同一个函数。让 MCP 侧拥有一份构造，
/// 面板就会长出第二份 —— 而「租约剩余秒怎么算」这类推导漂移是静默的。
fn status(manager: &TeamManager, principal: &TeamPrincipal) -> Result<ToolReply, AppError> {
    Ok(ToolReply::Status(team_status_view(
        manager,
        &principal.team_id,
    )?))
}

/// `team_options`：**读**这个队的可选项（池 / 上限 / 默认值）。
///
/// 只做三件事：读团队行 → 取花名册计数 → 调纯函数 [`options_for`]（红线 6 的同一条原则：
/// 入口层不自己推导）。视图构造因此只有一处，与面板那条命令共用。
///
/// 为什么队长需要它：过去它只能从**报错信息**里学到哪些 CLI 可用。让它在派活前就能读到
/// 「这个队允许谁 / 还能加几个 / 缺省是什么」，就不会把回合花在一次必然被拒的 `team_spawn` 上。
///
/// 未知团队 → `NotFound`：`TeamPrincipal` 是签发时真实存在过的凭证产物，走到这里说明
/// 团队行被删了（或 manager 的镜像与库不一致），那是真异常而不是「没权限」。
fn options(manager: &TeamManager, principal: &TeamPrincipal) -> Result<ToolReply, AppError> {
    let team = team_of(manager, &principal.team_id)?;
    let member_count = manager.member_count(&principal.team_id);
    Ok(ToolReply::Options(options_for(&team, member_count)))
}

/// `team_send`：**只校验，不投递**。
///
/// 目标 `Awaiting`（在等人）一律 `target_blocked`，且返回前一行字节都不写
/// （design §4.3：往等待中的提示符写消息会把半行输入吃进去）。
fn send(
    manager: &TeamManager,
    principal: &TeamPrincipal,
    args: &serde_json::Value,
) -> Result<ToolReply, AppError> {
    let wire = spec_for(ToolName::TeamSend).wire;
    let to = required_str(wire, args, "to")?;
    let message = required_str(wire, args, "message")?;
    let target = member_of_team(manager, &principal.team_id, to)?;
    if target.state == MemberState::Awaiting {
        return Err(AppError::Conflict("target_blocked".into()));
    }
    Ok(ToolReply::NeedsDelivery {
        to: target.id,
        // 发送者**是 principal**，不是入参：`team_send` 没有 `from` 参数（模型不得冒充队友）。
        // 拼进正文在这里做（principal 就在手边），而不是在执行层：执行层不该认识「谁是发送者」
        // 这个决定层的事实，它只该拿到「要写进 stdin 的那一行」。
        text: delivery::delivery_text(&principal.member_id, message),
    })
}

/// `team_spawn`：**准入 + 团队配置 + 落库**（起进程在 2.5b 的接线段）。
///
/// # 顺序即契约
///
/// 授权已由 [`call_async`] 先做（仅 Lead）→ 准入查表 → **团队池子** → **成员上限** →
/// 名字合法性 → 缺省值补全 → 落库（重名由 `add_member` 报）。先校验再落库很重要：
/// 拒绝路径上不能留下任何成员行（否则队长的花名册里会多出一个永远不会跑的名字，
/// 而「成员行 = 可查询状态」是本域对两相位设计的承诺）。判据：
/// `a_spawn_outside_the_team_pool_is_refused_with_the_pool` 与
/// `the_member_limit_is_enforced_and_the_lead_does_not_count`（两者都断言「被拒后库里没有
/// 新成员行」）。
///
/// # 团队配置从哪来（方案 C：三处同一份事实）
///
/// 池子 / 上限 / 默认值都存在 `team` 行上，`team_options` 与角色 preamble 读同一份
/// （[`options_for`]），这里读它做**校验与补全**：
///
/// | 配置项 | 这里怎么用 | 拒绝时说什么 |
/// | --- | --- | --- |
/// | `allowed_agent_ids` | `agent_id` 必须在**解析后**的池内 | 列出池子 + 指向 `team_options`（改配置的地方） |
/// | `max_members` | 已有成员数（不含队长）必须 `< max_members` | 带上限与当前数量 |
/// | `default_model` / `default_workspace` / `default_approval_policy` | 入参缺省时的来源 | —（填进成员行） |
///
/// 校验放在**写库之前**：成员行一旦落库就是「可查询状态」，被拒的请求不该污染它。
///
/// # 缺省值 ≠ 常量
///
/// `workspace` 的缺省**不是** `shared`、`approval_policy` 的缺省**不是** `queue`：
/// 它们都读团队列（`Team.default_*`）。硬编码一份在这里，就等于团队配置在 `team_spawn`
/// 这一侧被悄悄忽略 —— 而用户是在面板上配的，他没有任何办法发现它没生效。
///
/// # 为什么只允许 spawn worker
///
/// 队长是**已有会话**（`Team.lead_session_id`），不是 spawn 出来的。允许 spawn
/// 一个 lead 会造出第二个队长 —— 而授权矩阵里「Lead 全通」于是被复制了一份。
/// 换队长是另一件事（本期没有）。
///
/// # 返回值只描述「队长能行动的事」
///
/// 这里**不**把 env / 注入方式 / 传输 / 旁路参数算一遍塞进回复：那些是执行层的装配
/// 参数，全部可以从刚落库的成员行重新推导（见 [`ToolReply::MemberCreated`] 的文档）。
/// 判据：`member_row_carries_everything_the_executor_needs`。
fn spawn(
    manager: &TeamManager,
    principal: &TeamPrincipal,
    args: &serde_json::Value,
) -> Result<ToolReply, AppError> {
    let wire = spec_for(ToolName::TeamSpawn).wire;
    let agent_id = required_str(wire, args, "agent_id")?.trim().to_owned();
    // 准入：**数据查表**（红线 15）。`None` = 不可作成员；`refusal` 给出可读理由
    // 与可用 id 清单，让队长能自己纠正。
    let admission =
        admission_for(&agent_id).ok_or_else(|| AppError::NotFound(refusal(&agent_id)))?;
    // C5：**建成员之前**就拒绝「起得来但用不了」的 CLI（无 MCP 面 / 注入档未实现）。
    // 放到执行层再拒会让成员先落库 —— 花名册里多一个永远不动的名字，而队长以为它已开工。
    //
    // 这里问的是**成员**判据（`launch_refusal`）：成员侧不需要 `prompt_argv`（它的第一条
    // 上下文可以由 `team_send` 带来），所以「不能当队长」不得在这里拒 —— 那就是另一条判据
    // （`lead_refusal`，只给 `plan_team` / `plan_member_spawn` 的 Lead 分支用）。
    if let Some(why) = admission.launch_refusal() {
        return Err(AppError::Unsupported(why));
    }

    // 团队配置：池 / 上限 / 默认值。团队行缺失是真异常（队长凭证是签发时真实存在过的
    // 产物），因此 `NotFound` 而不是「当作没限制」—— 后者会让一个被删掉的团队仍然可写。
    let team = team_of(manager, &principal.team_id)?;
    let member_count = manager.member_count(&principal.team_id);
    let options = options_for(&team, member_count);

    // 池子：**池外一律拒绝并列出池子**。静默接受一个池外的 CLI，等于让面板上的勾选
    // 失去意义；而只说「不行」不说「允许谁」，队长只能靠试 → 它会把回合花在枚举上。
    if !options
        .defaults
        .allowed_agent_ids
        .iter()
        .any(|allowed| allowed == &agent_id)
    {
        return Err(AppError::Conflict(format!(
            "agent `{agent_id}` is not an allowed member of team `{}`; allowed members: {}; \
             the pool is part of this team's configuration (read it with `{}`)",
            principal.team_id,
            options.defaults.allowed_agent_ids.join(", "),
            spec_for(ToolName::TeamOptions).wire,
        )));
    }

    // 上限：**不含队长**（队长不是 spawn 出来的，见下面的「为什么只允许 spawn worker」）。
    if options.defaults.remaining() == 0 {
        return Err(AppError::Conflict(format!(
            "team `{}` already has {} members and its limit is {}; close one with `{}` before \
             spawning another",
            principal.team_id,
            options.defaults.member_count,
            options.defaults.max_members,
            spec_for(ToolName::TeamClose).wire,
        )));
    }

    let name = member_name(wire, required_str(wire, args, "name")?)?;
    // 三个缺省值的来源都是**团队列**（不是常量，见函数的「缺省值 ≠ 常量」）。
    let workspace = spawn_workspace(wire, args)?.unwrap_or_else(|| team.default_workspace.clone());
    let approval_policy = spawn_approval_policy(wire, args, &team)?;
    let model = spawn_model(wire, args, &team)?;

    let member_id = format!("{name}@{}", principal.team_id);
    let member = TeamMember {
        id: member_id.clone(),
        team_id: principal.team_id.clone(),
        name: name.clone(),
        role: MemberRole::Worker,
        agent_id,
        model,
        // `session_id` 是 Chat 成员的位置（design §7.4，本期恒 None）；
        // `terminal_id` 由 2.5b 起 PTY 后回填 —— 本层不得声称进程已就绪。
        session_id: None,
        terminal_id: None,
        workspace,
        // CLI 成员的唯一通道是 PTY（`WorkerChannel::CLI_MEMBER` 的文档记了为什么
        // 「有 MCP 面」不等于「能往它嘴里推消息」）。
        channel: WorkerChannel::CLI_MEMBER,
        result_channel: admission.result_channel(),
        tier: tier_of(admission),
        approval_policy,
        mcp_injection: admission.mcp_injection,
        last_seq: 0,
        state: MemberState::Spawned,
        // 空 hash ⇒ **不可认证**：凭证由执行层调 `issue_token` 取一次，
        // 明文因此永远不经过模型上下文（见 `ToolReply::MemberCreated` 的文档）。
        token_hash: String::new(),
        joined_at: now_millis(),
    };
    // 重名 / 团队不存在都由 `add_member` 报（成员 id 唯一性只在一处裁决）。
    manager.add_member(member)?;

    Ok(ToolReply::MemberCreated {
        member_id,
        tier: tier_of(admission),
        unverified: admission
            .unverified
            .iter()
            .map(|note| (*note).to_owned())
            .collect(),
    })
}

/// `task_create`：派活（队长）。
fn create(
    manager: &TeamManager,
    principal: &TeamPrincipal,
    args: &serde_json::Value,
) -> Result<ToolReply, AppError> {
    let wire = spec_for(ToolName::TaskCreate).wire;
    let title = required_str(wire, args, "title")?;
    let body = required_str(wire, args, "body")?;
    let workspace = workspace_arg(wire, args)?;
    let depends_on = depends_on_arg(manager, &principal.team_id, wire, args)?;
    let lease_ttl = lease_ttl_arg(wire, args)?;

    let task = TeamTask {
        // 任务 id 形如 `t{seq}`（design §2），seq 是**本队板**的水位线
        // （`store::TeamStore::next_task_seq(team_id)`）：任务 id 是队内标识符，
        // 主键是 `(team_id, id)`，所以每个队的板都从 `t1` 开始。
        // 并发创任务时两边可能算出同一个 id，但那会让 `create_task` 报 `Conflict`
        // （可见的重试），而不是静默覆盖别人的任务。
        id: next_task_id(manager, &principal.team_id)?,
        team_id: principal.team_id.clone(),
        title: title.to_owned(),
        body: body.to_owned(),
        state: TeamTaskState::Pending,
        owner: None,
        workspace,
        depends_on,
        claimed_at: None,
        lease_ttl,
        summary: None,
        summary_truncated: false,
        artifacts: vec![],
        reclaim_count: 0,
    };
    Ok(ToolReply::Task(manager.create_task(task)?))
}

/// `task_claim`：原子认领（状态机裁决在 manager）。
fn claim(
    manager: &TeamManager,
    principal: &TeamPrincipal,
    args: &serde_json::Value,
) -> Result<ToolReply, AppError> {
    let wire = spec_for(ToolName::TaskClaim).wire;
    let task_id = required_str(wire, args, "task_id")?;
    let (key, _) = task_of_team(manager, &principal.team_id, task_id)?;
    Ok(ToolReply::Task(manager.claim_task(
        &key,
        &principal.member_id,
        now_millis(),
    )?))
}

/// `task_update`：显式声明（L2）。
fn update(
    manager: &TeamManager,
    principal: &TeamPrincipal,
    args: &serde_json::Value,
) -> Result<ToolReply, AppError> {
    let wire = spec_for(ToolName::TaskUpdate).wire;
    let task_id = required_str(wire, args, "task_id")?;
    let raw_state = required_str(wire, args, "state")?;
    let (key, task) = task_of_team(manager, &principal.team_id, task_id)?;

    // design §3.2 的 `task_update(他人任务)` 行：Worker ❌ / Lead ✅。
    // 归属是「读任务表才能判」的格，所以它在这里而不是 `authorize`。
    //（队长穿过这一格后的路径是 `force_done`，那条走 manager 的审计；
    //  本层不代替 manager 做最终裁决。）
    if principal.role == MemberRole::Worker
        && task.owner.as_deref() != Some(principal.member_id.as_str())
    {
        return Err(AppError::Conflict(format!(
            "task `{task_id}` is owned by {:?}, not `{}`; only its owner (or the lead via force_done) may update it",
            task.owner, principal.member_id
        )));
    }

    let state = parse_updatable_state(wire, raw_state)?;
    let summary = optional_str(wire, args, "summary")?;
    Ok(ToolReply::Task(manager.update_task(
        &key,
        &principal.member_id,
        state,
        summary,
        now_millis(),
    )?))
}

/// `task_list`：板视图（可按状态过滤，不过滤 = 全部）。
fn list(
    manager: &TeamManager,
    principal: &TeamPrincipal,
    args: &serde_json::Value,
) -> Result<ToolReply, AppError> {
    let wire = spec_for(ToolName::TaskList).wire;
    let filter = match args.get("state") {
        None => None,
        Some(serde_json::Value::String(raw)) => Some(parse_any_state(wire, raw)?),
        Some(_) => {
            return Err(AppError::InvalidInput(format!(
                "`state` for {wire} must be a string"
            )))
        }
    };
    let tasks = manager
        .tasks(&principal.team_id)
        .into_iter()
        .filter(|task| filter.is_none_or(|state| state == task.state))
        .collect();
    Ok(ToolReply::Tasks(tasks))
}

/// `team_wait`：后端阻塞（design §4.3）。
///
/// 三层入参校验后交给 [`crate::agent::team::wait::wait`]：目标（`on`）、判据（`until`）、
/// 上限（`timeout_s`）。**参数错（如拼错 `until`）报错，但 timeout 超上限不报错** ——
/// 参见 [`wait_timeout`] 的注释。
async fn team_wait(
    manager: &TeamManager,
    principal: &TeamPrincipal,
    args: &serde_json::Value,
) -> Result<ToolReply, AppError> {
    let wire = spec_for(ToolName::TeamWait).wire;
    let targets = wait_targets(manager, &principal.team_id, wire, args)?;
    let until = wait_until(wire, args)?;
    let timeout = wait_timeout(wire, args)?;
    let outcome =
        crate::agent::team::wait::wait(manager, &principal.team_id, &targets, until, timeout)
            .await?;
    Ok(ToolReply::Wait(outcome))
}

/// `on.members` / `on.tasks` → [`WaitTargets`]。
///
/// **二选一**，不是并集：同时等成员与等任务时，「全部满足」的语义会含混不明
/// （成员空闲不等于它手上的任务已 done）。替调用方猜比报错危险得多。
fn wait_targets(
    manager: &TeamManager,
    team_id: &str,
    wire: &str,
    args: &serde_json::Value,
) -> Result<WaitTargets, AppError> {
    let Some(on) = args.get("on") else {
        return Err(AppError::InvalidInput(format!(
            "missing required argument `on` for {wire}; pass {{\"members\": [\"…\"]}} or {{\"tasks\": [\"…\"]}}"
        )));
    };
    if !on.is_object() {
        return Err(AppError::InvalidInput(format!(
            "`on` for {wire} must be an object with `members` or `tasks`"
        )));
    }
    let members = id_list(wire, on, "members")?;
    let tasks = id_list(wire, on, "tasks")?;
    match (members.is_empty(), tasks.is_empty()) {
        (false, true) => {
            for member_id in &members {
                // 入参阶段就把「外队成员 / 不存在」拦下（不泄漏别队花名册）；
                // 等待循环里因此可以假定目标行都存在。
                member_of_team(manager, team_id, member_id)?;
            }
            Ok(WaitTargets::Members(members))
        }
        (true, false) => {
            for task_id in &tasks {
                task_of_team(manager, team_id, task_id)?;
            }
            Ok(WaitTargets::Tasks(tasks))
        }
        (false, false) => Err(AppError::InvalidInput(format!(
            "`on` for {wire} takes `members` or `tasks`, not both"
        ))),
        (true, true) => Err(AppError::InvalidInput(format!(
            "`on` for {wire} needs a non-empty `members` or `tasks` array"
        ))),
    }
}

/// 对象里的一个可选 id 数组：缺 = 空，类型错 / 空串 = 可读错误。
fn id_list(wire: &str, on: &serde_json::Value, key: &str) -> Result<Vec<String>, AppError> {
    let Some(value) = on.get(key) else {
        return Ok(Vec::new());
    };
    let Some(items) = value.as_array() else {
        return Err(AppError::InvalidInput(format!(
            "`on.{key}` for {wire} must be an array of ids"
        )));
    };
    let mut out = Vec::with_capacity(items.len());
    for item in items {
        match item.as_str().map(str::trim) {
            Some(id) if !id.is_empty() => out.push(id.to_owned()),
            _ => {
                return Err(AppError::InvalidInput(format!(
                    "`on.{key}` for {wire} must be an array of non-empty ids"
                )))
            }
        }
    }
    Ok(out)
}

/// `until` → [`WaitUntil`]；缺省 = `Declared`。
///
/// 缺省取 `declared` 而不是 `any`：队长问「它做完了吗」时，「它说完了」满足不了它
/// （design §6 硬规则 1）。缺省值若取 `any`，最常出现的调用会静默地少等一层。
fn wait_until(wire: &str, args: &serde_json::Value) -> Result<WaitUntil, AppError> {
    let Some(raw) = optional_str(wire, args, "until")? else {
        return Ok(WaitUntil::Declared);
    };
    WaitUntil::parse(raw).ok_or_else(|| {
        AppError::InvalidInput(format!(
            "unknown `until` value `{raw}` for {wire}; known: declared, idle, any"
        ))
    })
}

/// `timeout_s` → `Duration`；缺省 1800 秒，**超过上限就截到 1800（不报错）**。
///
/// # 为什么超出上限不报错
///
/// 队长多给一个 timeout 不该让整次派活失败（它已经把活派出去了，报错只能让它重试）。 而
/// 「截断」保留了它真正想要的东西：一个足够长的等待。反过来，`0` / 负数 / 非整数必须拒绝
/// —— 那是「没给」与「给错了」的混淆，静默降级成默认值会让一个写错的调用看起来成功了。
fn wait_timeout(wire: &str, args: &serde_json::Value) -> Result<std::time::Duration, AppError> {
    let Some(value) = args.get("timeout_s") else {
        return Ok(std::time::Duration::from_secs(
            WAIT_TIMEOUT_MAX_SECS.unsigned_abs(),
        ));
    };
    let Some(seconds) = value.as_i64() else {
        return Err(AppError::InvalidInput(format!(
            "`timeout_s` for {wire} must be an integer (seconds)"
        )));
    };
    if seconds < 1 {
        return Err(AppError::InvalidInput(format!(
            "`timeout_s` for {wire} must be at least 1 second"
        )));
    }
    let seconds = seconds.min(WAIT_TIMEOUT_MAX_SECS).unsigned_abs();
    Ok(std::time::Duration::from_secs(seconds))
}

/// `team_close`：关闭目标与状态的**决策部分**（队长）。
///
/// # 两相位（design §7.1）
///
/// 本层只决定「关谁」并把团队推到正确的状态（整队关闭时先 `active → closing`），
/// **进程副作用与成员归档不做** —— 它们在
/// [`crate::agent::team::execution::apply_effect`] 里，那里才有 `MemberExecutor` 与
/// 状态迁移的成套动作。两个理由：① 本层必须能单测（不需要 `AppHandle`）；
/// ② 「先 close PTY，再归档成员」的顺序只能由一个地方拥有。
///
/// # 两种形态
///
/// | 入参 | 含义 | 本层做的状态迁移 |
/// | --- | --- | --- |
/// | `member_id` 有值 | 关**一个**成员（不能是队长：关队长 = 关队） | 无（归档在执行层）|
/// | `member_id` 缺省 | 关**整队** → `active → closing`，返回待关的成员列表 | `begin_team_close` |
///
/// # `graceful`：本期不兑现（红线 14）
///
/// 缺省 `true` 意味着「先给它一次收尾机会」，而**本期没有可发的 shutdown 协议**
/// （`Pty` 只有字节流，没有消息边界）。所以 `true` 与 `false` 的行为完全相同，区别只在于：
/// ① 审计多一条 `close_request`（`graceful=true`）；② 返回里`notes` **明说没兑现**。
/// 假装做过比不做更坏：队长会以为成员收到过收尾信号，从而不去查它到底停在哪。
fn close(
    manager: &TeamManager,
    principal: &TeamPrincipal,
    args: &serde_json::Value,
) -> Result<ToolReply, AppError> {
    let wire = spec_for(ToolName::TeamClose).wire;
    if args.get("graceful").is_some_and(|v| !v.is_boolean()) {
        return Err(AppError::InvalidInput(format!(
            "`graceful` for {wire} must be a boolean"
        )));
    }
    // 缺省 `true`：协商式是**预设**，直接拔电源是显式选择。
    let graceful = args
        .get("graceful")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(true);
    let member_id = optional_str(wire, args, "member_id")?;
    // 决策（校验 + 状态迁移 + 审计 + 诚实面）在 `execution::plan_close`：**本地面板命令走
    // 同一个函数**（它没有 principal）。这里只负责「按线协议解析入参」与「谁在调」。
    let plan = execution::plan_close(
        manager,
        &principal.team_id,
        member_id.map(str::trim),
        graceful,
        now_millis(),
    )?;
    // 计划是**领域**类型；把它翻译成线协议载荷是本层的职责（见 [`effect_for`] 的另一半）。
    Ok(closed_reply(&plan))
}

/// [`execution::ClosePlan`] → 决定层的 `Closed` 载荷。
///
/// 这是「决定层能说的话」：`members_closed` 是**待关列表**（还没关），`team_state` 是团队
/// **此刻**的状态（整队关闭刚被推成 `closing`）。执行之后的事实由
/// [`crate::agent::team::execution::CloseOutcome`] + [`reply_for`] 给出。
fn closed_reply(plan: &execution::ClosePlan) -> ToolReply {
    ToolReply::Closed {
        team_id: plan.team_id.clone(),
        member_id: plan.member_id.clone(),
        members_closed: plan.targets.clone(),
        members_failed: Vec::new(),
        team_state: plan.team_state,
        notes: plan.notes.clone(),
    }
}

// ═══════════════════════════════════════════════════════════════════
// 线协议 ⇄ 领域副作用（**唯一**翻译点）
// ═══════════════════════════════════════════════════════════════════

/// 这条回复有没有**副作用**要做？做哪一件？
///
/// # 为什么翻译只在这里
///
/// `ToolReply` 是线协议（变体名 = wire 名、整段进模型上下文），`Effect` 是领域动作。
/// 两者之间的翻译若散在调用点，第二个入口（本地面板命令）就会写一份长得像、判据不同的
/// `match`；更糟的是**新增一个工具时谁都可能忘了加翻译**，而症状是「工具返回成功、副作用
/// 静默不发生」。
///
/// # 「没有副作用」只有一种表示法：`None`
///
/// 不引入 `Effect::Nothing`：两个表示法意味着调用方要同时处理 `None` 与 `Nothing`，而它们
/// 永远不会同时出现。
///
/// # 一一对应由**编译器**兜住
///
/// 下面的 `match` 是穷尽的（没有 `_ => None`）：新增 `ToolReply` 变体 → 编译不过，直到你
/// 明确回答「它要不要副作用」。判据：`every_tool_reply_variant_is_translated`。
#[must_use]
pub fn effect_for(reply: &ToolReply) -> Option<execution::Effect> {
    match reply {
        ToolReply::MemberCreated { member_id, .. } => Some(execution::Effect::StartMember {
            member_id: member_id.clone(),
        }),
        ToolReply::NeedsDelivery { to, text } => Some(execution::Effect::Deliver {
            to: to.clone(),
            text: text.clone(),
        }),
        ToolReply::Closed {
            team_id,
            member_id,
            members_closed,
            team_state,
            notes,
            ..
        } => Some(execution::Effect::Close(execution::ClosePlan {
            team_id: team_id.clone(),
            member_id: member_id.clone(),
            targets: members_closed.clone(),
            team_state: *team_state,
            notes: notes.clone(),
        })),
        // 纯数据（板视图 / 任务行 / 等待结局 / 只读配置面）：没有进程副作用。
        ToolReply::Status(_)
        | ToolReply::Tasks(_)
        | ToolReply::Options(_)
        | ToolReply::Task(_)
        | ToolReply::TeamList(_)
        | ToolReply::Wait(_) => None,
    }
}

/// 执行结果 → 要交给调用方的回复（**只**在 MCP 入口调用）。
///
/// `Applied` ⇒ 决定层那条回复本身就是事实（起进程 / 投递成功没有第二个版本）。
/// `Closed` ⇒ 用执行之后的**事实**构造一条新 `Closed`（团队可能已经从 `closing` 变成
/// `closed`，`members_closed` 也从待关列表变成了真关掉的名单）。
#[must_use]
pub fn reply_for(reply: &ToolReply, outcome: execution::EffectOutcome) -> ToolReply {
    match outcome {
        execution::EffectOutcome::Applied => reply.clone(),
        execution::EffectOutcome::Closed(closed) => ToolReply::Closed {
            team_id: closed.team_id,
            member_id: closed.member_id,
            members_closed: closed.members_closed,
            members_failed: closed.members_failed,
            team_state: closed.team_state,
            notes: closed.notes,
        },
    }
}

// ═══════════════════════════════════════════════════════════════════
// 入参校验辅助
// ═══════════════════════════════════════════════════════════════════
/// 必填字符串：缺失 / 类型错 / 空白都给出可读错误（点名工具与参数）。
fn required_str<'a>(
    wire: &str,
    args: &'a serde_json::Value,
    key: &str,
) -> Result<&'a str, AppError> {
    match args.get(key) {
        Some(serde_json::Value::String(value)) if !value.trim().is_empty() => Ok(value),
        Some(serde_json::Value::String(_)) => Err(AppError::InvalidInput(format!(
            "`{key}` for {wire} must not be empty"
        ))),
        Some(_) => Err(AppError::InvalidInput(format!(
            "`{key}` for {wire} must be a string"
        ))),
        None => Err(AppError::InvalidInput(format!(
            "missing required argument `{key}` for {wire}"
        ))),
    }
}

/// 可选字符串：缺失 = `None`，类型错 = 可读错误。
///
/// **不得**用 `args.get(key).and_then(Value::as_str)`：那会把 `workspace: 42`
/// 静默降级成「没给」，于是一个写错的任务会落到 `Workspace::Shared` —— 看起来成功、
/// 实际在错的 cwd 里干活。
fn optional_str<'a>(
    wire: &str,
    args: &'a serde_json::Value,
    key: &str,
) -> Result<Option<&'a str>, AppError> {
    match args.get(key) {
        None => Ok(None),
        Some(serde_json::Value::String(value)) => Ok(Some(value)),
        Some(_) => Err(AppError::InvalidInput(format!(
            "`{key}` for {wire} must be a string"
        ))),
    }
}

/// 团队必须存在（读配置类工具的入口：`team_options` 与 `team_spawn` 都要它的池 / 默认值）。
fn team_of(manager: &TeamManager, team_id: &str) -> Result<Team, AppError> {
    manager
        .team(team_id)
        .ok_or_else(|| AppError::NotFound(format!("team `{team_id}` is not loaded")))
}

/// 成员必须**存在于本队**；外队成员与不存在一律 `NotFound`（不泄漏别队花名册）。
fn member_of_team(
    manager: &TeamManager,
    team_id: &str,
    member_id: &str,
) -> Result<TeamMember, AppError> {
    match manager.member(member_id) {
        Some(member) if member.team_id == team_id => Ok(member),
        _ => Err(AppError::NotFound(format!(
            "member `{member_id}` is not in team `{team_id}`"
        ))),
    }
}

/// 任务必须存在且**属于本队** —— 返回它的 [`TaskRef`] 与任务行。
///
/// # 这是本文件**唯一**构造 `TaskRef` 的地方（语义分界）
///
/// 工具面的线上形状仍然只有 `task_id`（不给模型一个伪造 / 写错 `team_id` 的机会）：
/// 队从 `principal.team_id`（token 里声明的）来。所以「拼 `(team_id, task_id)`」这个动作
/// 必须只有一个落点 —— 散落的拼接一旦漏了队（或用了别处的队），症状是**静默读到别队的
/// 同名任务**，比任何报错都难查（红线 12 的同一条纪律）。
///
/// 局部 `member_of_team` / `task_of_team` 这种「先按 id 取，再比 team」的写法在这里
/// **不能**沿用：那种形状的前提是 id 全局唯一，而现在 `t1` 在每个队都有。
fn task_of_team(
    manager: &TeamManager,
    team_id: &str,
    task_id: &str,
) -> Result<(TaskRef, TeamTask), AppError> {
    let key = TaskRef::new(team_id, task_id);
    match manager.task(&key) {
        Some(task) => Ok((key, task)),
        None => Err(AppError::NotFound(format!(
            "task `{task_id}` is not on team `{team_id}`'s board"
        ))),
    }
}

/// 解析 wire 形式的状态串（依赖 `types` 的 snake_case 口径，那道字面量已被
/// `types::tests::enum_wire_names_are_the_documented_snake_case` 钉住）。
fn parse_any_state(wire: &str, raw: &str) -> Result<TeamTaskState, AppError> {
    serde_json::from_value::<TeamTaskState>(serde_json::Value::String(raw.to_owned())).map_err(
        |_| {
            AppError::InvalidInput(format!(
                "unknown task state `{raw}` for {wire}; known: pending, claimed, in_progress, \
                 awaiting_approval, done, failed, blocked, proposed"
            ))
        },
    )
}

/// 只允许工具可写的三态（[`UPDATABLE_STATES`]）。
fn parse_updatable_state(wire: &str, raw: &str) -> Result<TeamTaskState, AppError> {
    let state = parse_any_state(wire, raw)?;
    if UPDATABLE_STATES.contains(&state) {
        return Ok(state);
    }
    let allowed = UPDATABLE_STATES
        .iter()
        .map(|state| {
            serde_json::to_value(state)
                .ok()
                .and_then(|value| value.as_str().map(str::to_owned))
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" / ");
    Err(AppError::InvalidInput(format!(
        "task state `{raw}` is internal; {wire} accepts only {allowed}"
    )))
}

/// 可选的 `workspace`（`task_create` 的**字符串**形态）：本步只接受 `shared` / `read_only`。
///
/// `worktree` 需要先建树（P4 §4.1），而**字符串形态无法携带路径** —— 所以这里不是
/// "忘了支持"，而是"这个入参形状表达不了"。需要隔离时用 `team_spawn` 的对象形态
/// （它带 `path`），不要给 `task_create` 加一个没有路径的 `worktree`。
fn workspace_arg(wire: &str, args: &serde_json::Value) -> Result<Workspace, AppError> {
    match optional_str(wire, args, "workspace")? {
        None | Some("shared") => Ok(Workspace::Shared),
        Some("read_only") => Ok(Workspace::ReadOnly),
        Some(other) => Err(AppError::InvalidInput(format!(
            "`workspace` for {wire} accepts `shared` or `read_only`; an isolated worktree needs a \
             path, so pass it to `team_spawn` instead; got `{other}`"
        ))),
    }
}

/// 拒绝控制字符（`\0` / `\n` / `\r` / `\t` …）。
///
/// # 为什么这是一条**跨字段**的判据
///
/// 这里校验的三个字符串最终都会离开 JSON 世界，进入不能再转义的地方：
///
/// | 落点 | 谁 | 不可转义的原因 |
/// | --- | --- | --- |
/// | env | `NEEKO_TEAM_MEMBER_ID`（`name`） | OS 层 env 不允许 NUL，`Command::env` 直接 panic |
/// | argv | `--model <value>`、CLI 启动参数 | 同上，`Command::arg` 遇到 NUL 也 panic |
/// | 文件系统 | `workspace.path` | 路径里的 NUL 无法表示为 `CString` |
/// | 单行日志 / sentinel | 全部三者 | `\n` 会把一行劈成两行，扫描器与日志解析同时错位 |
///
/// 同一个判据、同一句错误文案 —— 三个字段各自复制一份的话，未来加第四个注入点时
/// 必然漏一处，而漏掉的表现是 2.5b 在跨平台 spawn 时 panic。
/// `pub(crate)`：建队时的配置校验（`bootstrap::validate_config` 的 `default_model`）与
/// `team_spawn` 的 `model` 入参必须用**同一份**判据 —— 两份判据会漂移，而漂移的表现是
/// 「面板接受了这个默认值，起进程时 panic」。
pub(crate) fn reject_control_chars(wire: &str, field: &str, value: &str) -> Result<(), AppError> {
    if value.chars().any(char::is_control) {
        return Err(AppError::InvalidInput(format!(
            "`{field}` for {wire} must not contain control characters (a NUL cannot be \
             passed to an env var, an argv element or a path; a newline breaks one-line \
             logs and sentinel scanning); got `{}`",
            value.escape_debug()
        )));
    }
    Ok(())
}

/// 成员名最大字符数（**标识符**预算，不是标题预算）。
///
/// 名字同时是：`TeamMember.id` 的前半（`{name}@{team}`）、`NEEKO_TEAM_MEMBER_ID` 的 env 值、
/// 日志行的一段、`team_status` 花名册里的一格。三条都是「单行小载荷」，所以给它一个
/// 与通知标题（`MAX_TITLE_CHARS = 80`）同量级的上限；超出就**拒绝**而不是截断 ——
/// 截断会把两个不同的名字悄悄压成同一个 id。
const MEMBER_NAME_MAX_CHARS: usize = 64;

/// 成员名：**入口即 sanitize**（design §5.4「`{name}@{team}` 落库前 sanitize」）。
///
/// 三条判据，每条都对应一个具体的坏结果：
///
/// | 判据 | 否则会发生什么 |
/// | --- | --- |
/// | 不含 `@` | `{name}@{team}` 的解析错位 —— 身份可伪造（`evil@w1@tm_1` 与 `evil` 前缀混淆） |
/// | 不含控制字符 | `\0` 会让 2.5b 的 `Command::env` **panic**（OS 层面 env 不允许 NUL）；`\n`/`\r` 会把一行日志与 sentinel 行劈成两行 |
/// | ≤ [`MEMBER_NAME_MAX_CHARS`] | 一个模型随手写的长串把花名册与每次 `tools/call` 的载荷撑大（同一件事实在 N 个成员上叠加） |
///
/// **非空不在这里判**：[`required_str`] 已经对每个字符串入参做了「trim 后非空」，
/// 再判一次就是给同一条规则造第二个源（而且那条分支从公开路径到不了）。
///
/// 措辞是「拒绝」不是「清洗」：这里的字符串是**标识符**，静默改写会让队长拿到的 id
/// 与它请求的名字不一致，而它下一步还要用这个 id 派活。
fn member_name(wire: &str, raw: &str) -> Result<String, AppError> {
    let name = raw.trim();
    if name.contains('@') {
        return Err(AppError::InvalidInput(format!(
            "`name` for {wire} must not contain `@`: member ids are `{{name}}@{{team}}`, \
             so the name `{name}` would make the id ambiguous"
        )));
    }
    reject_control_chars(wire, "name", name)?;
    let chars = name.chars().count();
    if chars > MEMBER_NAME_MAX_CHARS {
        return Err(AppError::InvalidInput(format!(
            "`name` for {wire} is {chars} characters; the limit is {MEMBER_NAME_MAX_CHARS} \
             (the name is the first half of the member id, an env value and a one-line label)"
        )));
    }
    Ok(name.to_owned())
}

/// `workspace`（**对象**，与 `task_create` 的字符串形态不同）：`kind` 必填，
/// `worktree` 还必须有**绝对**的 `path`。
///
/// # 为什么返回 `Option`
///
/// 缺省（`None`）≠「落到 shared」：缺省值的来源是**团队配置**
/// （`Team.default_workspace`），由调用方补。在这里返回 `Workspace::Shared` 会把
/// 「团队说默认用 worktree」这一条静默吃掉。
///
/// 缺 `kind` 仍然报错（那是**给了但形状不对**，与「没给」是两件事）。
/// 缺 `path` 时报错而不是降级成 `Shared`：那是「以为在做隔离的活，实际与别的成员
/// 共用同一个 cwd」，而共享 cwd 下的 hook 归因只能靠 env（design §5.4）。
/// `path` 还要过 [`reject_control_chars`]（NUL 无法表示为文件系统路径）。
///
/// # 为何本层就要求绝对路径（红线 8 的入口一半）
///
/// 本层不触盘（不 `canonicalize`、不校验是否落在团队根下）——那是执行层在**消费**
/// 这个路径之前的事。但“消费”不会是别的：2.5b 用它 `git worktree` / 起 PTY，
/// 而那里的相对路径会按进程 cwd 解析。所以相对路径在这里就是一条**已定的错误**，
/// 只是失败点被推迟到很远的地方。放到入口拒，错误信息才能说清“我期望什么”。
///
/// 执行层的剩余义务（必须写在它的文档里）：`canonicalize()` + 校验落在团队
/// `project_path` 之下。
fn spawn_workspace(wire: &str, args: &serde_json::Value) -> Result<Option<Workspace>, AppError> {
    let Some(value) = args.get("workspace") else {
        // 缺省：由团队配置填（`Team.default_workspace`），不是常量。
        return Ok(None);
    };
    let Some(object) = value.as_object() else {
        return Err(AppError::InvalidInput(format!(
            "`workspace` for {wire} must be an object with a `kind`"
        )));
    };
    let kind = match object.get("kind") {
        Some(serde_json::Value::String(kind)) => kind.as_str(),
        Some(_) => {
            return Err(AppError::InvalidInput(format!(
                "`workspace.kind` for {wire} must be a string"
            )))
        }
        None => {
            return Err(AppError::InvalidInput(format!(
                "missing `workspace.kind` for {wire}"
            )))
        }
    };
    match kind {
        "shared" => Ok(Some(Workspace::Shared)),
        "read_only" => Ok(Some(Workspace::ReadOnly)),
        "worktree" => match object.get("path") {
            Some(serde_json::Value::String(path)) if !path.trim().is_empty() => {
                reject_control_chars(wire, "workspace.path", path)?;
                let path = std::path::PathBuf::from(path.trim());
                if !path.is_absolute() {
                    return Err(AppError::InvalidInput(format!(
                        "`workspace.path` for {wire} must be absolute; `{}` would be resolved \
                         against the process cwd when the worktree is created",
                        path.display()
                    )));
                }
                Ok(Some(Workspace::Worktree { path }))
            }
            _ => Err(AppError::InvalidInput(format!(
                "`workspace.path` for {wire} is required when `kind` is `worktree`"
            ))),
        },
        other => Err(AppError::InvalidInput(format!(
            "`workspace.kind` for {wire} must be one of shared, read_only, worktree; got `{other}`"
        ))),
    }
}

/// 生效的 `approval_policy`：入参优先，**缺省取团队的 `default_approval_policy`**。
///
/// 缺省不是常量 `Queue`：那是团队列的缺省值，不是这里写死的值 —— 用户在面板上把默认改成
/// `Bypass` 之后，不传这个参数的 spawn 必须拿到 `Bypass`，否则那条配置从未生效过。
///
/// 走 serde 而不是手写 `match`：枚举的 wire 字面量只有一个源（
/// `types::tests::enum_wire_names_are_the_documented_snake_case` 钉着），手写一份
/// 字符串匹配就是给同一个闭集造第二个名字。
fn spawn_approval_policy(
    wire: &str,
    args: &serde_json::Value,
    team: &Team,
) -> Result<ApprovalPolicy, AppError> {
    let Some(raw) = optional_str(wire, args, "approval_policy")? else {
        return Ok(team.default_approval_policy);
    };
    serde_json::from_value::<ApprovalPolicy>(serde_json::Value::String(raw.to_owned())).map_err(
        |_| {
            AppError::InvalidInput(format!(
                "unknown `approval_policy` `{raw}` for {wire}; known: interactive, queue, bypass"
            ))
        },
    )
}

/// 生效的 `model`：入参优先，**缺省取团队的 `default_model`**（`None` = 该 CLI 自己的默认）。
///
/// 两个来源走**同一个**判据：空白串拒绝（避免把拼错当成「没给」），控制字符拒绝
/// （这个值最终作为 `--model <value>` 进 argv，NUL 会让 `Command::arg` panic）。
/// 团队默认值也过一遍 —— 它同样会进 argv，而它是从面板（外部输入）来的。
fn spawn_model(
    wire: &str,
    args: &serde_json::Value,
    team: &Team,
) -> Result<Option<String>, AppError> {
    let chosen = match optional_str(wire, args, "model")? {
        None => team.default_model.as_deref(),
        Some(raw) if raw.trim().is_empty() => {
            return Err(AppError::InvalidInput(format!(
                "`model` for {wire} must not be empty (omit it to use the team default)"
            )))
        }
        Some(raw) => Some(raw.trim()),
    };
    let Some(model) = chosen else {
        return Ok(None);
    };
    let model = model.trim();
    reject_control_chars(wire, "model", model)?;
    Ok(Some(model.to_owned()))
}

/// 可选的 `depends_on`：每一项必须是本队已有任务（否则板上会多一条永不满足的边）。
fn depends_on_arg(
    manager: &TeamManager,
    team_id: &str,
    wire: &str,
    args: &serde_json::Value,
) -> Result<Vec<String>, AppError> {
    let Some(value) = args.get("depends_on") else {
        return Ok(Vec::new());
    };
    let Some(items) = value.as_array() else {
        return Err(AppError::InvalidInput(format!(
            "`depends_on` for {wire} must be an array of task ids"
        )));
    };
    let mut out = Vec::with_capacity(items.len());
    for item in items {
        let Some(dependency) = item.as_str() else {
            return Err(AppError::InvalidInput(format!(
                "`depends_on` for {wire} must be an array of task ids"
            )));
        };
        task_of_team(manager, team_id, dependency)?;
        out.push(dependency.to_owned());
    }
    Ok(out)
}

/// 可选的 `lease_ttl`（秒）：必须是正整数（`<= 0` 会让任务一被认领就到期）。
fn lease_ttl_arg(wire: &str, args: &serde_json::Value) -> Result<i64, AppError> {
    match args.get("lease_ttl") {
        None => Ok(DEFAULT_LEASE_TTL_SECS),
        Some(value) => match value.as_i64() {
            Some(ttl) if ttl > 0 => Ok(ttl),
            _ => Err(AppError::InvalidInput(format!(
                "`lease_ttl` for {wire} must be a positive integer (seconds)"
            ))),
        },
    }
}

/// 本队的下一个任务 id：`t{seq}`，`seq` 来自本队板的水位线（空板 = `t1`）。
///
/// 极薄是刻意的：命名空间规则（队内单调 / `GLOB` / 数值序 / 为什么可以整表重建）
/// 全部归 [`crate::agent::team::store::TeamStore::next_task_seq`] —— 这里只做
/// 「seq → `t{n}`」这一句拼接，不重复推导任何规则，也**不**自己 `+1`。
fn next_task_id(manager: &TeamManager, team_id: &str) -> Result<String, AppError> {
    Ok(format!("t{}", manager.store().next_task_seq(team_id)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::team::fixtures::{fixture_member, fixture_team, fixture_team_configured};
    use crate::agent::team::identity;
    use crate::agent::team::manager::{self, TeamManager};
    use crate::agent::team::store::TeamStore;
    use crate::agent::team::types::{
        AdmissionTier, ApprovalPolicy, McpInjection, ResultChannel, Team, TeamConfig, TeamState,
        WorkerChannel, Workspace,
    };
    use serde_json::json;

    /// 建出来的成员**必须可投递**（这就是把 CLI 通道定为 `Pty` 的全部理由）。
    ///
    /// 反例是曾经的推导「有 MCP 面 ⇒ `channel = Mcp`」：它让每个成员的 `team_send`
    /// 都命中 `Unsupported` —— 队长以为派了活，成员从未收到。这条测试只看一件事：
    /// 成员行的通道能排出一次真实写入。
    #[test]
    fn a_spawned_member_is_deliverable_over_its_pty() {
        use crate::agent::team::delivery::{self, DeliveryRoute};

        let manager = seeded();
        let spawned = spawn_ok(&manager, &lead(), &spawn_args("claude-code", "w9"));
        let member = manager.member(&spawned.member_id).expect("member");
        match delivery::route(member.channel, "claim t1") {
            DeliveryRoute::Pty(plan) => {
                assert_eq!(plan.text, b"claim t1", "正文与回车是两笔（AC14）");
                assert_eq!(plan.enter, b"\r");
            }
            DeliveryRoute::Unsupported(why) => panic!("成员不可投递: {why}"),
        }
        // 与之并列：队长的行也一样（同一条执行路径）。
        let lead_member = manager.member(LEAD).expect("lead");
        assert!(matches!(
            delivery::route(lead_member.channel, "hi"),
            DeliveryRoute::Pty(_)
        ));
    }

    const TEAM: &str = "tm_1";
    const OTHER: &str = "tm_2";
    const LEAD: &str = "lead@tm_1";
    const W1: &str = "w1@tm_1";
    const W2: &str = "w2@tm_1";
    const OUTSIDER: &str = "x9@tm_2";

    /// 测试团队：上限放到硬上界，让「池 / 上限」之外的用例不会被缺省的 4 个名额挡住
    /// （上限自己的判据在 `the_member_limit_is_enforced_and_the_lead_does_not_count`，
    /// 那里用显式配置的团队）。
    fn team(id: &str) -> Team {
        Team {
            name: format!("team {id}"),
            max_members: crate::agent::team::types::MAX_MEMBERS_LIMIT,
            ..fixture_team(id)
        }
    }

    fn member(id: &str, name: &str, role: MemberRole, team_id: &str) -> TeamMember {
        TeamMember {
            name: name.into(),
            role,
            token_hash: "deadbeef".into(),
            ..fixture_member(id, team_id)
        }
    }

    fn task(id: &str, team_id: &str) -> TeamTask {
        TeamTask {
            id: id.into(),
            team_id: team_id.into(),
            title: "do it".into(),
            body: "body".into(),
            state: TeamTaskState::Pending,
            owner: None,
            workspace: Workspace::Shared,
            depends_on: vec![],
            claimed_at: None,
            lease_ttl: 1800,
            summary: None,
            summary_truncated: false,
            artifacts: vec![],
            reclaim_count: 0,
        }
    }

    /// 两队各一名队长 + 两名/一名成员（外队成员用于「跨队必须 NotFound」）。
    fn seeded() -> std::sync::Arc<TeamManager> {
        let manager = TeamManager::new(TeamStore::open_in_memory().unwrap());
        manager.create_team(team(TEAM)).unwrap();
        manager.create_team(team(OTHER)).unwrap();
        for (id, name, role, team_id) in [
            (LEAD, "lead", MemberRole::Lead, TEAM),
            (W1, "w1", MemberRole::Worker, TEAM),
            (W2, "w2", MemberRole::Worker, TEAM),
            (OUTSIDER, "x9", MemberRole::Lead, OTHER),
        ] {
            manager.add_member(member(id, name, role, team_id)).unwrap();
        }
        std::sync::Arc::new(manager)
    }

    /// 一个按**给定团队配置**建好的团队 + 队长（无成员）。
    ///
    /// 池子 / 上限 / 默认值三处的判据都用它：配置在这条路径上是**真的落库**的
    /// （`create_team` → `store.upsert_team`），所以断言到的是读回来的值。
    fn configured_team(config: &TeamConfig) -> std::sync::Arc<TeamManager> {
        let manager = TeamManager::new(TeamStore::open_in_memory().unwrap());
        manager
            .create_team(fixture_team_configured(TEAM, config))
            .unwrap();
        manager
            .add_member(member(LEAD, "lead", MemberRole::Lead, TEAM))
            .unwrap();
        std::sync::Arc::new(manager)
    }

    /// 测试用执行器：`#[tokio::test]` 里 `Handle::current()` 是有效的。
    fn rt() -> crate::common::runtime::AppRuntime {
        crate::common::runtime::AppRuntime::from_handle(tokio::runtime::Handle::current())
    }

    fn principal(member_id: &str, role: MemberRole, team_id: &str) -> TeamPrincipal {
        TeamPrincipal {
            team_id: team_id.into(),
            member_id: member_id.into(),
            role,
            channel: WorkerChannel::Mcp,
            tier: AdmissionTier::A,
        }
    }

    fn lead() -> TeamPrincipal {
        principal(LEAD, MemberRole::Lead, TEAM)
    }

    fn worker(id: &str) -> TeamPrincipal {
        principal(id, MemberRole::Worker, TEAM)
    }

    /// 未知 wire → `NotFound`，且错误里逐条列出已知工具名。
    ///
    /// 保护的不变量：模型调错名字时必须能自我纠正（列出已知工具），
    /// 否则它会一直重试同一个拼错的名字。
    ///
    /// `team_spawn` 已随 P2.5a 进清单，所以这里换一个**真的**不存在的 wire
    /// （`team_hire`）—— 断言里的 9 条必须与 §4.2 的工具清单一字不差。
    #[test]
    fn unknown_wire_is_not_found_and_lists_known_tools() {
        let manager = seeded();
        let err = call(&manager, &lead(), "team_hire", &json!({})).unwrap_err();
        let AppError::NotFound(message) = err else {
            panic!("未知 wire 必须是 NotFound，实际 {err:?}");
        };
        assert!(message.contains("team_hire"), "{message}");
        // §4.2 一致性：清单里的 9 条都必须出现在错误信息里，模型才能照抄。
        for wire in [
            "team_status",
            "team_spawn",
            "team_send",
            "task_create",
            "task_claim",
            "task_update",
            "task_list",
            "team_wait",
            "team_close",
        ] {
            assert!(message.contains(wire), "错误信息漏了 {wire}：{message}");
        }
    }

    /// 授权格：worker 调 `task_create` / `team_close` 一律拒绝（design §3.2）。
    ///
    /// 保护的不变量：「成员不能建新成员/新任务」—— 建任务是队长的能力，
    /// 否则任意成员都能无限扇出工作量绕过队长。
    #[test]
    fn worker_cannot_create_tasks_or_close_the_team() {
        let manager = seeded();
        let cases = [
            ("task_create", json!({"title": "t", "body": "b"})),
            ("team_close", json!({"member_id": W2})),
        ];
        for (wire, args) in cases {
            let err = call(&manager, &worker(W1), wire, &args).unwrap_err();
            assert!(matches!(err, AppError::Conflict(_)), "{wire}: {err:?}");
        }
        // 正例对照：同一组入参换队长必须成功（否则上面的拒绝可能是「碰巧全拒」）。
        assert!(call(
            &manager,
            &lead(),
            "task_create",
            &json!({"title":"t","body":"b"})
        )
        .is_ok());
        assert!(call(&manager, &lead(), "team_close", &json!({"member_id": W2})).is_ok());
    }

    /// 授权格 + 归属格：worker 改**他人**任务 → `Conflict`。
    ///
    /// 保护的不变量：design §3.2 的 `task_update(他人任务) | Lead ✅ / Worker ❌`。
    /// 这条判定在 dispatch（本函数）而不是 `authorize`，因为它需要读任务表。
    #[test]
    fn worker_cannot_update_another_members_task() {
        let manager = seeded();
        manager.create_task(task("t1", TEAM)).unwrap();
        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, 1_000)
            .unwrap();

        let err = call(
            &manager,
            &worker(W2),
            "task_update",
            &json!({"task_id": "t1", "state": "done"}),
        )
        .unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
        assert_eq!(
            manager.task(&TaskRef::new(TEAM, "t1")).unwrap().state,
            TeamTaskState::Claimed
        );
    }

    /// 归属格：worker 改**自己**任务 → 成功，且板上真的变成 `done`。
    #[test]
    fn worker_can_update_own_task() {
        let manager = seeded();
        manager.create_task(task("t1", TEAM)).unwrap();
        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, 1_000)
            .unwrap();

        let reply = call(
            &manager,
            &worker(W1),
            "task_update",
            &json!({"task_id": "t1", "state": "done", "summary": "ok"}),
        )
        .unwrap();
        let ToolReply::Task(task) = reply else {
            panic!("task_update 必须返回 Task，实际 {reply:?}");
        };
        assert_eq!(task.state, TeamTaskState::Done);
        assert_eq!(task.summary.as_deref(), Some("ok"));
        assert_eq!(
            manager.task(&TaskRef::new(TEAM, "t1")).unwrap().state,
            TeamTaskState::Done
        );
    }

    /// 内部态必须被工具层拒绝（`in_progress` / `claimed` / `pending` 等）。
    ///
    /// 保护的不变量：工具只能写 `done`/`failed`/`blocked`；其余是系统迁移的产物。
    /// 放行 `in_progress` 会让成员跳过 claim 直接开工（绕过不变量 1 的归属检查）。
    #[test]
    fn task_update_rejects_internal_states() {
        let manager = seeded();
        manager.create_task(task("t1", TEAM)).unwrap();
        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, 1_000)
            .unwrap();
        for state in [
            "in_progress",
            "claimed",
            "pending",
            "awaiting_approval",
            "proposed",
            "bogus",
        ] {
            let err = call(
                &manager,
                &worker(W1),
                "task_update",
                &json!({"task_id": "t1", "state": state}),
            )
            .unwrap_err();
            let AppError::InvalidInput(message) = err else {
                panic!("{state} 必须被 InvalidInput 拒绝，实际 {err:?}");
            };
            // 错误必须说清允许什么（否则模型只会反复试空格 / 大小写变体）。
            assert!(message.contains("done"), "{}", message);
            assert!(message.contains("failed"), "{}", message);
        }
        assert_eq!(
            manager.task(&TaskRef::new(TEAM, "t1")).unwrap().state,
            TeamTaskState::Claimed
        );
    }

    /// `blocked` 过了工具层校验，但**冻结的裁决仍在 manager**（不变量 4）。
    ///
    /// 这条测试记录的是一个**分层事实**而不是需求：工具层按 design §4.2 接受
    /// `blocked`，而 `TeamManager::update_task` 只允许 owner 走
    /// `in_progress`/`awaiting_approval`/`done`/`failed` —— 冻结属于租约回收
    /// （`reclaim_expired`: `reclaim_count > 3 → blocked`），不是 owner 的自助操作。
    /// 保留它让「工具接受但 manager 拒绝」这个缝可见，未来若要放开必须同时改两处。
    #[test]
    fn task_update_blocked_is_judged_by_the_manager_not_the_tool_layer() {
        let manager = seeded();
        manager.create_task(task("t1", TEAM)).unwrap();
        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, 1_000)
            .unwrap();

        let err = call(
            &manager,
            &worker(W1),
            "task_update",
            &json!({"task_id": "t1", "state": "blocked"}),
        )
        .unwrap_err();
        assert!(matches!(err, AppError::InvalidInput(_)), "{err:?}");
        assert_eq!(
            manager.task(&TaskRef::new(TEAM, "t1")).unwrap().state,
            TeamTaskState::Claimed
        );
    }

    /// `to` 必须是**本队**成员：外队成员与不存在一律 `NotFound`（不泄漏别队花名册）。
    #[test]
    fn team_send_to_a_foreign_member_is_not_found() {
        let manager = seeded();
        for to in [OUTSIDER, "nobody@tm_1"] {
            let err = call(
                &manager,
                &lead(),
                "team_send",
                &json!({"to": to, "message": "hi"}),
            )
            .unwrap_err();
            assert!(matches!(err, AppError::NotFound(_)), "{to}: {err:?}");
        }
    }

    /// 目标 `Awaiting` → `Conflict("target_blocked")`（design §4.3：**不写任何字节**）。
    ///
    /// 保护的不变量：在等人（审批/输入）的成员收不到投递 —— 往它的 stdin 写消息
    /// 会把等待中的提示符吃进半行输入，后果是不可见的状态污染。
    #[test]
    fn team_send_to_awaiting_member_is_target_blocked() {
        let manager = seeded();
        manager
            .observe_signal(
                W2,
                crate::agent::team::types::MemberSignal::ApprovalRequested,
                1_000,
            )
            .unwrap();
        assert_eq!(manager.member(W2).unwrap().state, MemberState::Awaiting);

        let err = call(
            &manager,
            &lead(),
            "team_send",
            &json!({"to": W2, "message": "hi"}),
        )
        .unwrap_err();
        assert_eq!(err.to_string(), "Conflict: target_blocked");
    }

    /// `task_id` 必须属于本队（外队任务 → `NotFound`）。
    ///
    /// 保护的不变量：任务 id 是全局键（`t1` 在每队都叫 `t1`），若不校验归属，
    /// 队长会改到别队的任务上。
    #[test]
    fn task_from_another_team_is_not_found() {
        let manager = seeded();
        manager.create_task(task("t1", OTHER)).unwrap();
        for wire in ["task_claim", "task_update"] {
            let err = call(
                &manager,
                &lead(),
                wire,
                &json!({"task_id": "t1", "state": "done"}),
            )
            .unwrap_err();
            assert!(matches!(err, AppError::NotFound(_)), "{wire}: {err:?}");
        }
    }

    /// `task_create` 的依赖必须存在且同队 —— 否则写进板上的是一条永不满足的边。
    #[test]
    fn task_create_rejects_unknown_or_foreign_dependency() {
        let manager = seeded();
        manager.create_task(task("t9", OTHER)).unwrap();
        for dependency in ["nope", "t9"] {
            let err = call(
                &manager,
                &lead(),
                "task_create",
                &json!({"title": "t", "body": "b", "depends_on": [dependency]}),
            )
            .unwrap_err();
            assert!(
                matches!(err, AppError::NotFound(_)),
                "{dependency}: {err:?}"
            );
        }
    }

    /// 整队关闭需要 `closing` 状态机（P4 §4.2）→ 本步必须 `Unsupported` 而不是静默成功。
    ///
    /// 错误文案面向**队长模型**：它只该读到「现在还不能整队关，请逐个关」，不该读到
    /// 本仓的阶段编号（那对模型是噪声，也无法行动）。
    #[test]
    fn team_close_without_member_id_is_no_longer_unsupported() {
        let manager = seeded();
        // 这条护栏原本钉的是「整队关闭还没实现」（Unsupported）。现在它已实现，
        // 判据翻转为「必须真的把团队推进 closing」—— 见 `team_close_without_a_member_id_*`。
        assert!(call(&manager, &lead(), "team_close", &json!({})).is_ok());
        assert_eq!(manager.team(TEAM).unwrap().state, TeamState::Closing);
    }

    // ── 全部工具的 happy path（每个 `ToolReply` 变体各一条）─────────────────

    /// `team_status` → `ToolReply::Status`：花名册 + 板摘要 + 租约剩余秒。
    ///
    /// 载荷断言（红线 4）：视图只含 id / 名字 / 角色 / 状态 / 取证 / 租约秒 + 三个计数。
    #[test]
    fn team_status_reports_roster_and_board_summary() {
        let manager = seeded();
        manager.create_task(task("t1", TEAM)).unwrap();
        let now = now_millis();
        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, now)
            .unwrap();
        manager
            .update_task(
                &TaskRef::new(TEAM, "t1"),
                W1,
                TeamTaskState::Done,
                Some("ok"),
                now + 10,
            )
            .unwrap();
        manager.create_task(task("t2", TEAM)).unwrap();

        let reply = call(&manager, &lead(), "team_status", &json!({})).unwrap();
        let ToolReply::Status(view) = reply else {
            panic!("team_status 必须返回 Status，实际 {reply:?}");
        };
        assert_eq!(view.team_id, TEAM);
        assert_eq!(view.team_state, TeamState::Active);
        assert_eq!(view.members.len(), 3);
        assert_eq!(view.task_total, 2);
        assert_eq!(view.task_done, 1);
        assert_eq!(view.task_open, 1);
        // 无在飞任务的成员 → None（不是 0：0 表示「租约已超时」）。
        assert_eq!(view.members[0].lease_remaining_secs, None);

        // 红线 4：视图里不得出现正文 / 摘要 / transcript 类字段。
        let json = serde_json::to_value(&view).unwrap();
        let mut keys: Vec<&str> = json
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec![
                // 成员数（不含队长）：两个面（`team_status` 与团队清单）必须同源。
                "memberCount",
                "members",
                "taskDone",
                "taskOpen",
                "taskTotal",
                "teamId",
                "teamState"
            ]
        );
        let mut member_keys: Vec<&str> = json["members"][0]
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        member_keys.sort_unstable();
        // `verification` 是 AC2 的判据（见 `view::MemberStatusView` 的文档）：花名册必须能
        // 区分「空闲」与「空闲但未声明」，而这两者的 `state` 完全相同。
        //
        // 另外四项是「这一行能干什么」：`agentId` + `tier`（能力边界）、`workspace`（在哪干活）、
        // `channel`（怎么发消息）、`terminalId`（**点开它的唯一凭据**）。少了最后一项，
        // 成员进程虽然在跑，面板却只能看队长 —— 花名册成了只读名单。
        assert_eq!(
            member_keys,
            vec![
                "agentId",
                "channel",
                "leaseRemainingSecs",
                "memberId",
                "name",
                "role",
                "state",
                "terminalId",
                "tier",
                "verification",
                "workspace"
            ]
        );
    }

    /// 在飞任务的租约剩余秒必须由「起租时间 + ttl - now」推出（无在飞任务时 `None`）。
    #[test]
    fn team_status_computes_lease_remaining_from_the_live_task() {
        let manager = seeded();
        manager.create_task(task("t1", TEAM)).unwrap();
        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, now_millis())
            .unwrap();

        let ToolReply::Status(view) = call(&manager, &lead(), "team_status", &json!({})).unwrap()
        else {
            panic!("必须是 Status");
        };
        let w1 = view.members.iter().find(|m| m.member_id == W1).unwrap();
        let remaining = w1.lease_remaining_secs.expect("在飞任务必须有租约剩余秒");
        assert!(
            (0..=DEFAULT_LEASE_TTL_SECS).contains(&remaining),
            "剩余秒 {remaining} 不在 [0, ttl] 内"
        );
        let lead_row = view.members.iter().find(|m| m.member_id == LEAD).unwrap();
        assert_eq!(lead_row.lease_remaining_secs, None);
    }

    /// `team_send` → `ToolReply::NeedsDelivery`（本步不投递），且**投递文本已带发送者**。
    ///
    /// 发送者来自 principal，不是入参（`team_send` 没有 `from` 参数）：模型不得冒充队友。
    /// 拼接发生在**这一层**（principal 在手边），执行层只拿到「要写进 stdin 的那一行」。
    #[test]
    fn team_send_returns_needs_delivery_without_writing_anything() {
        let manager = seeded();
        let reply = call(
            &manager,
            &worker(W1),
            "team_send",
            &json!({"to": W2, "message": "please rebase"}),
        )
        .unwrap();
        assert_eq!(
            reply,
            ToolReply::NeedsDelivery {
                to: W2.into(),
                // 发送者是 principal（W1），**不是**收件人。
                text: format!("[team] {W1}: please rebase"),
            }
        );
    }

    /// 投递文本里的发送者必须是 principal，**不是**收件人。
    ///
    /// 保护的不变量：把 `from` 换成 `to` 时投递仍然「成功」（成员确实收到了一行字），差别只
    /// 在于那一行把发送者写成了接收人自己 —— 队长永远看不出谁在跟它说话，而所有测试依然是
    /// 绿的。所以这条用例必须存在。
    #[test]
    fn the_delivery_text_names_the_sender_not_the_recipient() {
        let manager = seeded();
        let ToolReply::NeedsDelivery { text, .. } = call(
            &manager,
            &worker(W1),
            "team_send",
            &json!({"to": W2, "message": "please rebase"}),
        )
        .unwrap() else {
            panic!("必须是 NeedsDelivery");
        };
        assert!(text.contains(&format!("[team] {W1}:")), "{text}");
        assert!(
            !text.contains(&format!("[team] {W2}:")),
            "投递文本不得把收件人当作发送者：{text}"
        );
    }

    /// 正文**逐字**保留（拼接不做任何加工）。
    #[test]
    fn the_delivery_text_keeps_the_body_verbatim() {
        let manager = seeded();
        let body = "\n  line1\n\tline2  \n";
        let ToolReply::NeedsDelivery { text, .. } = call(
            &manager,
            &worker(W1),
            "team_send",
            &json!({"to": W2, "message": body}),
        )
        .unwrap() else {
            panic!("必须是 NeedsDelivery");
        };
        assert_eq!(text, format!("[team] {W1}: {body}"));
    }

    /// `NeedsDelivery` 的**线上键名**（camelCase）与变体名逐字钉住。
    ///
    /// # 为什么是 `text` 而不是 `from` + `message`
    ///
    /// 模型看到的是**投递文本**，不是发送者字段：发送者已经在正文里（`[team] w1@tm_1: …`）。
    /// 一个 `from` 字段是模型无行动可做的执行参数（它既改不了也用不上），并且会给「谁发的」
    /// 造出第二个源（字段 vs 正文里拼好的那一份）—— 两份迟早不一致。
    ///
    /// 反例（本用例挡的正是它）：把 `from` 加回 wire —— 键集多一个键，而「模型只该看到投递
    /// 文本」这条裁决没有任何别的地方能发现被推翻。
    #[test]
    fn the_needs_delivery_payload_uses_the_documented_wire_keys() {
        let manager = seeded();
        let reply = call(
            &manager,
            &worker(W1),
            "team_send",
            &json!({"to": W2, "message": "hi"}),
        )
        .unwrap();
        let json = serde_json::to_value(&reply).unwrap();
        let body = json
            .get("needs_delivery")
            .unwrap_or_else(|| panic!("变体名必须是 `needs_delivery`：{json}"));
        let mut keys: Vec<&str> = body
            .as_object()
            .unwrap_or_else(|| panic!("载荷必须是对象：{json}"))
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec!["text", "to"],
            "载荷键集变了就必须同步模型侧 / 执行层的读法"
        );
        assert_eq!(body["to"], W2);
        assert_eq!(
            body["text"],
            format!("[team] {W1}: hi"),
            "发送者必须在**正文里**（那是接收方唯一的身份线索）"
        );
    }

    // ───────────────────────────────────────────────────────────────
    // 线协议 ⇄ 领域副作用（一一对应）
    // ───────────────────────────────────────────────────────────────

    /// **每个** `ToolReply` 变体都必须在 [`effect_for`] 里有明确答案。
    ///
    /// # 这条判据挡的是什么
    ///
    /// 新增一个工具（因此新增一个 `ToolReply` 变体）而忘了写翻译 —— 症状是「工具返回成功、
    /// 副作用静默不发生」：队长以为成员起来了 / 消息送达了，实际上什么都没做。
    ///
    /// # 两层保护
    ///
    /// ① `effect_for` 的 `match` 没有 `_` 分支 ⇒ 新增变体直接**编译不过**；
    /// ② 这条用例把「九个变体各自的答案」写下来，于是变体名单本身在 diff 里可见 ——
    ///    改判据（比如「`team_list` 也要落副作用」）必须显式改这里。
    #[test]
    fn every_tool_reply_variant_is_translated() {
        use crate::agent::team::execution::{Effect, EffectOutcome};
        use crate::agent::team::options::default_options;
        use crate::agent::team::view::{TeamList, TeamStatusView};
        use crate::agent::team::wait::{WaitOutcome, WaitSnapshot};

        let samples: Vec<(&str, ToolReply, bool)> = vec![
            (
                "status",
                ToolReply::Status(TeamStatusView {
                    team_id: TEAM.into(),
                    team_state: TeamState::Active,
                    members: Vec::new(),
                    task_total: 0,
                    task_open: 0,
                    task_done: 0,
                    member_count: 0,
                }),
                false,
            ),
            ("tasks", ToolReply::Tasks(Vec::new()), false),
            ("options", ToolReply::Options(default_options(0)), false),
            ("task", ToolReply::Task(task("t1", TEAM)), false),
            (
                "member_created",
                ToolReply::MemberCreated {
                    member_id: W1.into(),
                    tier: tier_of(admission_for("claude-code").expect("admitted")),
                    unverified: Vec::new(),
                },
                true,
            ),
            (
                "needs_delivery",
                ToolReply::NeedsDelivery {
                    to: W1.into(),
                    text: format!("[team] {LEAD}: hi"),
                },
                true,
            ),
            (
                "closed",
                ToolReply::Closed {
                    team_id: TEAM.into(),
                    member_id: None,
                    members_closed: vec![W1.into()],
                    members_failed: Vec::new(),
                    team_state: TeamState::Closing,
                    notes: vec!["n".into()],
                },
                true,
            ),
            (
                "team_list",
                ToolReply::TeamList(TeamList {
                    teams: Vec::new(),
                    truncated: false,
                }),
                false,
            ),
            (
                "wait",
                ToolReply::Wait(WaitOutcome::Timeout {
                    snapshot: WaitSnapshot {
                        team_id: TEAM.into(),
                        members: Vec::new(),
                        tasks: Vec::new(),
                        gone: None,
                    },
                }),
                false,
            ),
        ];

        for (name, reply, has_effect) in samples {
            assert_eq!(
                effect_for(&reply).is_some(),
                has_effect,
                "`{name}` 的副作用判定变了就必须同步执行层：{reply:?}"
            );
        }

        // 三个有副作用的变体：**逐字段**落到领域类型里（少一个字段 = 执行层拿不到那条信息）。
        assert_eq!(
            effect_for(&ToolReply::NeedsDelivery {
                to: W1.into(),
                text: "hi".into(),
            }),
            Some(Effect::Deliver {
                to: W1.into(),
                text: "hi".into()
            })
        );
        assert_eq!(
            effect_for(&ToolReply::Closed {
                team_id: TEAM.into(),
                member_id: Some(W1.into()),
                members_closed: vec![W2.into()],
                members_failed: Vec::new(),
                team_state: TeamState::Closing,
                notes: vec!["n".into()],
            }),
            Some(Effect::Close(execution::ClosePlan {
                team_id: TEAM.into(),
                member_id: Some(W1.into()),
                targets: vec![W2.into()],
                team_state: TeamState::Closing,
                notes: vec!["n".into()],
            }))
        );

        // 回翻：`Applied` 原样返回那条回复（起进程 / 投递没有第二个版本）。
        let created = ToolReply::MemberCreated {
            member_id: W1.into(),
            tier: tier_of(admission_for("claude-code").expect("admitted")),
            unverified: Vec::new(),
        };
        assert_eq!(
            reply_for(&created, EffectOutcome::Applied),
            created,
            "没有「执行之后」的事实可说的动作，回复必须原样"
        );

        // 回翻：`Closed` 用**执行之后**的事实（团队可能已经从 closing 变成 closed）。
        let decision = ToolReply::Closed {
            team_id: TEAM.into(),
            member_id: None,
            members_closed: vec![W1.into(), W2.into()],
            members_failed: Vec::new(),
            team_state: TeamState::Closing,
            notes: vec![],
        };
        let factual = reply_for(
            &decision,
            EffectOutcome::Closed(execution::CloseOutcome {
                team_id: TEAM.into(),
                member_id: None,
                members_closed: vec![W1.into()],
                members_failed: Vec::new(),
                team_state: TeamState::Closed,
                notes: vec!["n".into()],
            }),
        );
        assert_eq!(
            factual,
            ToolReply::Closed {
                team_id: TEAM.into(),
                member_id: None,
                members_closed: vec![W1.into()],
                members_failed: Vec::new(),
                team_state: TeamState::Closed,
                notes: vec!["n".into()],
            },
            "执行之后的事实必须覆盖决定层的意图（teamState / membersClosed 都是）"
        );
    }

    /// `task_create` → `ToolReply::Task`，且 id 由板上最大序号派生（`t1`、`t2`…）。
    #[test]
    fn task_create_returns_the_persisted_task_and_increments_ids() {
        let manager = seeded();
        let reply = call(
            &manager,
            &lead(),
            "task_create",
            &json!({"title": "build", "body": "run cargo build", "lease_ttl": 60}),
        )
        .unwrap();
        let ToolReply::Task(task) = reply else {
            panic!("task_create 必须返回 Task，实际 {reply:?}");
        };
        assert_eq!(task.id, "t1");
        assert_eq!(task.team_id, TEAM);
        assert_eq!(task.state, TeamTaskState::Pending);
        assert_eq!(task.lease_ttl, 60);
        assert_eq!(task.owner, None);

        let ToolReply::Task(second) = call(
            &manager,
            &lead(),
            "task_create",
            &json!({"title": "test", "body": "run tests"}),
        )
        .unwrap() else {
            panic!("必须是 Task");
        };
        assert_eq!(second.id, "t2");
        assert_eq!(second.lease_ttl, DEFAULT_LEASE_TTL_SECS);
    }

    /// 任务 id 的命名空间是**队内**的：另一个队建的第一个任务**必须**是 `t1`。
    ///
    /// # 这条判据的来历（D1 的复盘）
    ///
    /// v16 期这里是反过来的（`a_second_team_continues_the_global_task_sequence`）：
    /// `team_task.id` 是单列主键，于是新团队的空板算出 `t1` 会撞上别队的 `t1`
    /// （2026-11-03 真实现场：`tm_1a196cefa87` 已占 t1/t2/t3，再建一个队就派不出活），
    /// 权宜之计是让序号**全库**单调 —— 代价是新队的第一件活叫 `t7`。
    ///
    /// 主键改成 `(team_id, id)` 之后，全局序号唯一的理由消失了：现在**必须**回到
    /// 每队从 `t1` 开始（任务 id 是队长与成员在对话里互相指代的东西，越短越好），
    /// 而「跨队同名」由 `TaskRef` 在类型层兜住（见 `a_task_id_is_only_unique_inside_its_team`）。
    #[test]
    fn a_new_team_numbers_its_tasks_from_one() {
        let manager = seeded();
        for title in ["a", "b", "c"] {
            let ToolReply::Task(task) = call(
                &manager,
                &lead(),
                "task_create",
                &json!({"title": title, "body": "work"}),
            )
            .unwrap() else {
                panic!("必须是 Task");
            };
            assert_eq!(task.team_id, TEAM);
        }
        assert_eq!(manager.tasks(TEAM).len(), 3);

        // 队 B 的空板 → `t1`（不是接着队 A 的水位线往下数）。
        let other_lead = principal(OUTSIDER, MemberRole::Lead, OTHER);
        let ToolReply::Task(first_of_other) = call(
            &manager,
            &other_lead,
            "task_create",
            &json!({"title": "first", "body": "work"}),
        )
        .unwrap() else {
            panic!("必须是 Task（新团队的第一个任务不得 Conflict）");
        };
        assert_eq!(
            first_of_other.id, "t1",
            "队 B 从 t1 开始编号（队 A 的 t1/t2/t3 不是它的水位线）"
        );
        assert_eq!(first_of_other.team_id, OTHER);

        // 两个队的 `t1` 并存，互不覆盖（复合主键的直接收益）。
        assert_eq!(manager.tasks(TEAM).len(), 3);
        assert_eq!(manager.tasks(OTHER).len(), 1);
    }

    /// **判据 1**：`t1` 只在队内唯一 —— A 的 `t1` 与 B 的 `t1` 是两条不同的任务。
    ///
    /// 三个断言各挡一个事故：
    ///
    /// 1. 内容不同：两行没有互相覆盖（`HashMap<String, TeamTask>` 会在这里变红）；
    /// 2. `update_task(A/t1, done)` 之后 B/t1 状态不变（写路径没有串台）；
    /// 3. `view::task_detail(B/t1)` 返回 B 的正文而不是 A 的（读路径没有串台）。
    #[test]
    fn a_task_id_is_only_unique_inside_its_team() {
        let manager = seeded();
        let mut a = task("t1", TEAM);
        a.title = "A 的活".into();
        a.body = "A 的正文".into();
        let mut b = task("t1", OTHER);
        b.title = "B 的活".into();
        b.body = "B 的正文".into();
        manager.create_task(a).unwrap();
        manager.create_task(b).unwrap();

        let a_key = TaskRef::new(TEAM, "t1");
        let b_key = TaskRef::new(OTHER, "t1");
        assert_eq!(manager.task(&a_key).unwrap().title, "A 的活");
        assert_eq!(manager.task(&b_key).unwrap().title, "B 的活");

        // 队 A 的 t1 由 W1 认领并声明完成。
        manager.claim_task(&a_key, W1, 1_000).unwrap();
        manager
            .update_task(&a_key, W1, TeamTaskState::Done, Some("ok"), 1_100)
            .unwrap();
        assert_eq!(manager.task(&a_key).unwrap().state, TeamTaskState::Done);
        assert_eq!(
            manager.task(&b_key).unwrap().state,
            TeamTaskState::Pending,
            "改 A/t1 不得改动 B/t1"
        );

        // 读路径：详情必须是 B 自己的正文。
        let detail = view::task_detail(&manager, &b_key).expect("B/t1 的详情");
        assert_eq!(detail.body, "B 的正文");
        assert_eq!(detail.card.team_id.as_str(), OTHER);
        assert_eq!(detail.card.id, "t1");
    }

    /// **判据 4**：`(tm_b, t1)` 不存在时返回 `NotFound`，**不许回落到 `tm_a` 的 t1`**。
    #[test]
    fn task_detail_rejects_a_pair_that_does_not_belong() {
        let manager = seeded();
        manager.create_task(task("t1", TEAM)).unwrap();

        // 队 B 上没有 `t1`（尽管队 A 有）。
        let err = view::task_detail(&manager, &TaskRef::new(OTHER, "t1")).expect_err("必须 404");
        assert!(matches!(err, AppError::NotFound(_)), "{err:?}");
        let message = err.to_string();
        assert!(message.contains(OTHER), "错误必须点名被问的队：{message}");
    }

    /// **判据 5**：`depends_on` 按**队内**解析 —— 跨队的同名 id **不得**被当成依赖满足。
    ///
    /// # 为什么把「本队缺那个 id」做成主判据
    ///
    /// 「按 id 找」的实现（`values().find(|t| t.id == dep)`）在两个队都有 `t1` 时是
    /// **不确定**的：它可能命中本队那个（于是看起来正确）。所以这里构造一个只有一种
    /// 可能命中的局面：**本队没有 `t1`**，而队 B 的 `t1` 已经 `done`。
    ///
    /// - 正确实现（按 `(team_id, id)` 解析）→ `NotFound`（依赖不存在）；
    /// - 按 id 解析 → 命中队 B 那个 `done` → 认领成功（正是「跨队依赖被满足」的事故）。
    #[test]
    fn depends_on_resolves_inside_the_team() {
        let manager = seeded();

        // 队 B 的 t1 已经完成（一个「看起来能满足依赖」的跨队同名任务）。
        manager.create_task(task("t1", OTHER)).unwrap();
        let other_key = TaskRef::new(OTHER, "t1");
        manager.claim_task(&other_key, "x9@tm_2", 1_000).unwrap();
        manager
            .update_task(&other_key, "x9@tm_2", TeamTaskState::Done, None, 1_100)
            .unwrap();

        // 队 A 的 t2 依赖 `t1`，而**队 A 根本没有 t1**。
        let mut dependent = task("t2", TEAM);
        dependent.depends_on = vec!["t1".into()];
        manager.create_task(dependent).unwrap();

        let err = manager
            .claim_task(&TaskRef::new(TEAM, "t2"), W1, 1_200)
            .expect_err("本队没有 t1：依赖不得被队 B 的 t1 满足");
        assert!(matches!(err, AppError::NotFound(_)), "{err:?}");
        assert!(
            err.to_string().contains(TEAM),
            "错误必须点名本队（依赖解析在队内）：{err}"
        );

        // 本队的 t1 建出来但还没 done → 仍然不能认领（依赖是「done」而不是「存在」）。
        manager.create_task(task("t1", TEAM)).unwrap();
        let err = manager
            .claim_task(&TaskRef::new(TEAM, "t2"), W1, 1_300)
            .expect_err("本队 t1 还是 pending");
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");

        // 本队 t1 完成后才可以。
        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, 1_400)
            .unwrap();
        manager
            .update_task(
                &TaskRef::new(TEAM, "t1"),
                W1,
                TeamTaskState::Done,
                Some("ok"),
                1_500,
            )
            .unwrap();
        manager
            .claim_task(&TaskRef::new(TEAM, "t2"), W1, 1_600)
            .expect("本队依赖已满足");
    }

    /// 序号是**数值**序：`t10` 之后是 `t11`（字符串比较会退回 `t2`）。
    #[test]
    fn the_task_sequence_grows_numerically_past_t9() {
        let manager = seeded();
        for id in ["t9", "t10"] {
            manager.create_task(task(id, TEAM)).unwrap();
        }
        let ToolReply::Task(next) = call(
            &manager,
            &lead(),
            "task_create",
            &json!({"title": "next", "body": "work"}),
        )
        .unwrap() else {
            panic!("必须是 Task");
        };
        assert_eq!(next.id, "t11", "`max(id)` 字符串比较会得到 t9 → t10 重撞");
    }

    /// `task_claim` → `ToolReply::Task`（`claimed` + owner = 调用者）。
    #[test]
    fn task_claim_returns_the_claimed_task() {
        let manager = seeded();
        manager.create_task(task("t1", TEAM)).unwrap();
        let reply = call(
            &manager,
            &worker(W1),
            "task_claim",
            &json!({"task_id": "t1"}),
        )
        .unwrap();
        let ToolReply::Task(task) = reply else {
            panic!("task_claim 必须返回 Task，实际 {reply:?}");
        };
        assert_eq!(task.state, TeamTaskState::Claimed);
        assert_eq!(task.owner.as_deref(), Some(W1));
        assert!(task.claimed_at.is_some());
    }

    /// `task_list` → `ToolReply::Tasks`（可按 state 过滤；无过滤 = 全部）。
    #[test]
    fn task_list_returns_the_board_and_honours_the_state_filter() {
        let manager = seeded();
        manager.create_task(task("t1", TEAM)).unwrap();
        manager.create_task(task("t2", TEAM)).unwrap();
        manager
            .claim_task(&TaskRef::new(TEAM, "t2"), W1, 1_000)
            .unwrap();

        let ToolReply::Tasks(all) = call(&manager, &worker(W1), "task_list", &json!({})).unwrap()
        else {
            panic!("task_list 必须返回 Tasks");
        };
        assert_eq!(all.len(), 2);

        let ToolReply::Tasks(pending) = call(
            &manager,
            &worker(W1),
            "task_list",
            &json!({"state": "pending"}),
        )
        .unwrap() else {
            panic!("必须是 Tasks");
        };
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].id, "t1");

        let err = call(
            &manager,
            &worker(W1),
            "task_list",
            &json!({"state": "nonsense"}),
        )
        .unwrap_err();
        assert!(matches!(err, AppError::InvalidInput(_)), "{err:?}");
    }

    // ───────────────────────────────────────────────────────────────
    // `team_close`（决策层）+ 关闭中的写门禁 + `team_list`
    // ───────────────────────────────────────────────────────────────

    /// `Closed` 的字段摊平成测试结构，让每条断言都能点名自己保护哪条不变量。
    #[derive(Debug)]
    struct ClosedReply {
        team_id: String,
        member_id: Option<String>,
        members_closed: Vec<String>,
        members_failed: Vec<(String, String)>,
        team_state: TeamState,
        notes: Vec<String>,
    }

    fn closed_reply(reply: ToolReply) -> ClosedReply {
        match reply {
            ToolReply::Closed {
                team_id,
                member_id,
                members_closed,
                members_failed,
                team_state,
                notes,
            } => ClosedReply {
                team_id,
                member_id,
                members_closed,
                members_failed,
                team_state,
                notes,
            },
            other => panic!("team_close 必须返回 Closed，实际 {other:?}"),
        }
    }

    /// 单成员关闭：目标由 `member_id` 指明，**进程还没关**（那是执行层的事）。
    ///
    /// 两条同时钉住：① 决定层不声称已关（`members_closed` 还空着 —— 两相位）；
    /// ② `graceful` 本期不兑现必须在 `notes` 里**明说**（红线 14 的诚实面）。
    #[test]
    fn team_close_of_one_member_names_the_target_and_admits_graceful_is_a_no_op() {
        let manager = seeded();
        let reply = closed_reply(
            call(
                &manager,
                &lead(),
                "team_close",
                &json!({"member_id": W2, "graceful": true}),
            )
            .unwrap(),
        );

        assert_eq!(reply.team_id, TEAM);
        assert_eq!(reply.member_id.as_deref(), Some(W2));
        assert!(
            reply.members_closed.is_empty(),
            "决定层还没关掉任何东西：{:?}",
            reply.members_closed
        );
        assert!(reply.members_failed.is_empty());
        assert_eq!(
            reply.team_state,
            TeamState::Active,
            "关一个成员不改团队状态"
        );
        assert!(
            reply.notes.iter().any(|note| note.contains("graceful")),
            "graceful 没兑现必须写在 notes 里：{:?}",
            reply.notes
        );
        assert!(
            !reply.notes.iter().any(|note| note.contains("lead")),
            "关一个成员时不该出现「队长 PTY 不关」这种噪音（那是整队关闭的事实）：{:?}",
            reply.notes
        );
        // 审计里留下「被要求过 graceful」这一条（与「做过」严格区分）。
        let events = manager.events(TEAM).unwrap();
        assert!(
            events
                .iter()
                .any(|event| event.kind == manager::EVENT_CLOSE_REQUEST
                    && event
                        .detail
                        .as_deref()
                        .is_some_and(|d| d.contains("graceful=true"))),
            "必须记录 graceful_requested：{events:?}"
        );
    }

    /// 整队关闭：`active → closing`，返回待关列表（**不含队长**）。
    #[test]
    fn team_close_without_a_member_id_closes_the_whole_team() {
        let manager = seeded();
        let reply = closed_reply(call(&manager, &lead(), "team_close", &json!({})).unwrap());

        assert_eq!(reply.team_id, TEAM);
        assert_eq!(reply.member_id, None, "整队关闭没有单一目标");
        assert_eq!(
            reply.members_closed,
            vec![W1.to_owned(), W2.to_owned()],
            "待关列表 = 全部 worker（队长是发起方，不在里面）"
        );
        assert_eq!(reply.team_state, TeamState::Closing);
        assert_eq!(
            manager.team(TEAM).unwrap().state,
            TeamState::Closing,
            "状态必须真的落到库里（不是只在载荷里说说）"
        );
    }

    /// 队长成员不能走单成员关闭：关队长 = 关队。
    #[test]
    fn team_close_refuses_to_close_the_lead_as_a_member() {
        let manager = seeded();
        let err = call(&manager, &lead(), "team_close", &json!({"member_id": LEAD})).unwrap_err();
        let AppError::Conflict(message) = err else {
            panic!("关队长必须 Conflict，实际 {err:?}");
        };
        assert!(message.contains(LEAD), "{message}");
        assert!(
            message.contains("without `member_id`"),
            "必须指向正确的路径：{message}"
        );
    }

    /// `closing` 期间写操作一律拒绝（理由里带当前状态），读操作仍然可用。
    ///
    /// 保护的不变量：状态机不是摆设 —— 一个正在解散的队不该还能 spawn / 派活 / 认领，
    /// 但队长必须还能看到「还剩谁」（`team_status` / `task_list` / `team_list`）并重试关闭。
    #[test]
    fn a_closing_team_refuses_writes_but_answers_reads() {
        let manager = seeded();
        manager
            .begin_team_close(TEAM, crate::agent::team::manager::now_millis())
            .unwrap();

        for (wire, args) in [
            (
                "team_spawn",
                json!({"agent_id": "claude-code", "name": "w9"}),
            ),
            ("task_create", json!({"title": "t", "body": "b"})),
            ("task_claim", json!({"task_id": "t1"})),
            ("task_update", json!({"task_id": "t1", "state": "done"})),
            ("team_send", json!({"to": W1, "message": "hi"})),
            ("team_wait", json!({"on": {"members": [W1]}})),
        ] {
            let err = call(&manager, &lead(), wire, &args).unwrap_err();
            let AppError::Conflict(message) = err else {
                panic!("{wire} 在 closing 里必须 Conflict，实际 {err:?}");
            };
            assert!(
                message.contains("closing"),
                "{wire} 的理由必须带当前状态：{message}"
            );
            assert!(
                message.contains(wire),
                "{wire} 的错误必须点名工具：{message}"
            );
        }

        // 读仍然可用（关队期间要看还剩谁）。
        for wire in ["team_status", "task_list", "team_list"] {
            assert!(
                call(&manager, &lead(), wire, &json!({})).is_ok(),
                "{wire} 在 closing 里必须可读"
            );
        }
        // 关闭本身必须可重试（否则一个关不干净的队永远关不了）。
        assert!(call(&manager, &lead(), "team_close", &json!({})).is_ok());
        // 重试是幂等的：状态没被重新推进，审计也不重复。
        let begins = manager
            .events(TEAM)
            .unwrap()
            .into_iter()
            .filter(|event| event.kind == manager::EVENT_CLOSE_BEGIN)
            .count();
        assert_eq!(begins, 1, "重复进入 closing 不得重复记审计");
    }

    /// `Closed` 载荷的**线上键名**（camelCase）与变体名逐字钉住。
    ///
    /// 这条载荷会进模型上下文（`content[0].text`），键名错了不会有任何报错 ——
    /// 队长只是读不到 `teamState` / `membersClosed`，于是它对「还剩谁」的判断永远是空的。
    #[test]
    fn the_closed_payload_uses_the_documented_wire_keys() {
        let manager = seeded();
        let reply = call(&manager, &lead(), "team_close", &json!({"member_id": W2})).unwrap();
        let json = serde_json::to_value(&reply).unwrap();
        let body = json
            .get("closed")
            .unwrap_or_else(|| panic!("变体名必须是 `closed`：{json}"));
        let mut keys: Vec<&str> = body
            .as_object()
            .unwrap_or_else(|| panic!("载荷必须是对象：{json}"))
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec![
                "memberId",
                "membersClosed",
                "membersFailed",
                "notes",
                "teamId",
                "teamState",
            ],
            "载荷键集变了就必须同步模型侧的读法"
        );
    }

    /// `team_list`：列出**这台机器上**的团队（跨队只读，worker 也能调）。
    #[test]
    fn team_list_lists_every_team_and_is_readable_by_a_worker() {
        let manager = seeded();
        let ToolReply::TeamList(list) =
            call(&manager, &worker(W1), "team_list", &json!({})).unwrap()
        else {
            panic!("team_list 必须返回 TeamList");
        };
        let ids: Vec<&str> = list
            .teams
            .iter()
            .map(|team| team.team_id.as_str())
            .collect();
        assert_eq!(ids, vec![TEAM, OTHER], "同毫秒建队时按 id 升序");
        assert!(!list.truncated);
        let team = &list.teams[0];
        assert_eq!(team.state, TeamState::Active);
        assert_eq!(team.member_count, 2, "成员数不含队长");
        assert_eq!(team.lead_agent_id, "claude-code");
    }

    /// 入参缺失 / 类型错时的错误必须点名参数与工具（可读性契约）。
    #[test]
    fn missing_arguments_name_the_parameter_and_the_tool() {
        let manager = seeded();
        let err = call(&manager, &lead(), "team_send", &json!({"to": W2})).unwrap_err();
        let AppError::InvalidInput(message) = err else {
            panic!("缺参必须是 InvalidInput，实际 {err:?}");
        };
        assert!(message.contains("message"), "{message}");
        assert!(message.contains("team_send"), "{message}");

        let err = call(
            &manager,
            &lead(),
            "task_create",
            &json!({"title": "t", "body": "b", "depends_on": "t1"}),
        )
        .unwrap_err();
        let AppError::InvalidInput(message) = err else {
            panic!("类型错必须是 InvalidInput，实际 {err:?}");
        };
        assert!(message.contains("depends_on"), "{message}");

        // 空白串与缺失同属「没给」，不得当成一个合法的状态值。
        let err = call(
            &manager,
            &lead(),
            "task_update",
            &json!({"task_id": "t1", "state": "  "}),
        )
        .unwrap_err();
        let AppError::InvalidInput(message) = err else {
            panic!("空白 state 必须是 InvalidInput，实际 {err:?}");
        };
        assert!(message.contains("state"), "{message}");
    }

    /// `workspace` 只接受 `shared` / `read_only`（`worktree` 属 P4，需要 git 建树）。
    #[test]
    fn task_create_workspace_accepts_only_the_implemented_variants() {
        let manager = seeded();
        let ToolReply::Task(shared) = call(
            &manager,
            &lead(),
            "task_create",
            &json!({"title": "t", "body": "b", "workspace": "shared"}),
        )
        .unwrap() else {
            panic!("必须是 Task");
        };
        assert_eq!(shared.workspace, Workspace::Shared);

        let ToolReply::Task(ro) = call(
            &manager,
            &lead(),
            "task_create",
            &json!({"title": "t", "body": "b", "workspace": "read_only"}),
        )
        .unwrap() else {
            panic!("必须是 Task");
        };
        assert_eq!(ro.workspace, Workspace::ReadOnly);

        let err = call(
            &manager,
            &lead(),
            "task_create",
            &json!({"title": "t", "body": "b", "workspace": "worktree"}),
        )
        .unwrap_err();
        let AppError::InvalidInput(message) = err else {
            panic!("worktree 必须是 InvalidInput，实际 {err:?}");
        };
        assert!(message.contains("worktree"), "{message}");
    }

    /// 可选参数的类型错**不得**被静默当成「没给」。
    ///
    /// 保护的不变量：`workspace: 42` 若被当成 `None`，任务会惄无声息地落到
    /// `Workspace::Shared`（共享工作区）而不是报错 —— 那是一个**看起来成功了**的写操作，
    /// 成员随后会在一个错的 cwd 里干活 (`task_update` 的 `summary` 同理)。
    #[test]
    fn wrong_argument_types_are_rejected_instead_of_ignored() {
        let manager = seeded();
        manager.create_task(task("t1", TEAM)).unwrap();
        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, 1_000)
            .unwrap();
        let cases = [
            (
                "task_create",
                json!({"title": "t", "body": "b", "workspace": 42}),
                "workspace",
            ),
            (
                "task_update",
                json!({"task_id": "t1", "state": "done", "summary": ["x"]}),
                "summary",
            ),
            ("team_close", json!({"member_id": 7}), "member_id"),
        ];
        for (wire, args, key) in cases {
            let err = call(&manager, &lead(), wire, &args).unwrap_err();
            let AppError::InvalidInput(message) = err else {
                panic!("{wire}/{key} 必须是 InvalidInput，实际 {err:?}");
            };
            assert!(message.contains(key), "{message}");
        }
    }

    // ── 团队配置（方案 C）：池子 / 上限 / 默认值 ─────────────────────────

    /// 池外的 `agent_id` 被拒，且错误里**列出池子**并指向改配置的工具。
    ///
    /// 保护的不变量（拒绝，不静默过滤）：面板上勾的池子必须真的生效；而只说「不行」不说
    /// 「允许谁」，队长只能靠枚举 —— 它会把回合花在一串必然失败的调用上。
    #[test]
    fn a_spawn_outside_the_team_pool_is_refused_with_the_pool() {
        let manager = configured_team(&TeamConfig {
            allowed_agent_ids: vec!["pi".into()],
            ..TeamConfig::default()
        });
        let err = call(
            &manager,
            &lead(),
            "team_spawn",
            &spawn_args("claude-code", "w9"),
        )
        .unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
        let message = err.to_string();
        assert!(
            message.contains("claude-code"),
            "必须点名被拒的 id：{message}"
        );
        assert!(message.contains("pi"), "必须列出池子：{message}");
        assert!(
            message.contains("team_options"),
            "必须指向「从哪读/改配置」：{message}"
        );
        // 拒绝路径上不得留下成员行（成员行 = 可查询状态的承诺）。
        assert!(manager.member("w9@tm_1").is_none(), "被拒的请求不得落库");
        assert!(manager.store().list_members(TEAM).unwrap().len() == 1);
    }

    /// 池内的 `agent_id` 照常通过（否则上面那条可能只是「碰巧全拒」）。
    #[test]
    fn a_spawn_inside_the_team_pool_succeeds() {
        let manager = configured_team(&TeamConfig {
            allowed_agent_ids: vec!["claude-code".into()],
            ..TeamConfig::default()
        });
        let spawned = spawn_ok(&manager, &lead(), &spawn_args("claude-code", "w9"));
        assert_eq!(spawned.member_id, "w9@tm_1");
    }

    /// 空池 = **不限制**：默认团队什么都能 spawn（入场不该强迫用户先勾选）。
    #[test]
    fn an_empty_pool_allows_every_launchable_cli() {
        let manager = configured_team(&TeamConfig::default());
        for (agent_id, name) in [("claude-code", "w1"), ("pi", "w2")] {
            let spawned = spawn_ok(&manager, &lead(), &spawn_args(agent_id, name));
            assert_eq!(
                manager.member(&spawned.member_id).unwrap().agent_id,
                agent_id
            );
        }
    }

    /// 第 `max_members + 1` 个成员被拒，错误里带上限与当前数量；**队长不计入**。
    ///
    /// 队长在花名册里（`lead@tm_1`）但不在名额里：它是这个队的第一个主体，不是被 spawn
    /// 出来的。把队长算进去的后果是「上限 = 1 的队连一个成员都加不了」。
    #[test]
    fn the_member_limit_is_enforced_and_the_lead_does_not_count() {
        let manager = configured_team(&TeamConfig {
            max_members: 1,
            ..TeamConfig::default()
        });
        spawn_ok(&manager, &lead(), &spawn_args("claude-code", "w1"));

        let err = call(&manager, &lead(), "team_spawn", &spawn_args("pi", "w2")).unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
        let message = err.to_string();
        assert!(message.contains("limit is 1"), "必须带上限：{message}");
        assert!(
            message.contains("already has 1 members"),
            "必须带当前数量（不含队长）：{message}"
        );

        // 被拒之后：花名册里只有 w1 + 队长，库里同样两行。
        assert!(manager.member("w2@tm_1").is_none());
        assert_eq!(manager.store().list_members(TEAM).unwrap().len(), 2);
        assert_eq!(manager.member_count(TEAM), 1, "队长不计入成员数");
    }

    /// 缺省值**来自团队列**（不是硬编码常量），且落库值是团队默认值。
    ///
    /// 三列全部取非默认值：`model = Some(…)` / `workspace = ReadOnly` /
    /// `approval_policy = Bypass`。把任何一处改回常量（`None` / `Shared` / `Queue`）
    /// 这条都会红 —— 而那种偏差的后果是「用户在面板上配了默认值，它从未生效过」。
    ///
    /// 断言的是**落库行**（`store.get_member`），不是 `spawn` 的返回值：返回值只带三个
    /// 字段（红线 14 的输出侧），看它无法证明缺省值进了成员行。
    #[test]
    fn spawn_defaults_come_from_the_team_row() {
        let manager = configured_team(&TeamConfig {
            default_model: Some("team-default-model".into()),
            default_workspace: Workspace::ReadOnly,
            default_approval_policy: ApprovalPolicy::Bypass,
            ..TeamConfig::default()
        });
        // 只给必填的两项：`workspace` / `model` / `approval_policy` 全部省掉。
        let args = json!({"agent_id": "claude-code", "name": "w9"});
        let spawned = spawn_ok(&manager, &lead(), &args);

        let stored = manager
            .store()
            .get_member(&spawned.member_id)
            .unwrap()
            .expect("成员必须已落库");
        assert_eq!(stored.model.as_deref(), Some("team-default-model"));
        assert_eq!(stored.workspace, Workspace::ReadOnly);
        assert_eq!(stored.approval_policy, ApprovalPolicy::Bypass);
    }

    /// 入参**优先于**团队默认值（否则配置会覆盖队长的显式选择）。
    #[test]
    fn explicit_spawn_arguments_win_over_the_team_defaults() {
        let manager = configured_team(&TeamConfig {
            default_model: Some("team-default-model".into()),
            default_workspace: Workspace::ReadOnly,
            default_approval_policy: ApprovalPolicy::Bypass,
            ..TeamConfig::default()
        });
        let spawned = spawn_ok(
            &manager,
            &lead(),
            &json!({
                "agent_id": "claude-code",
                "name": "w9",
                "workspace": {"kind": "shared"},
                "model": "explicit-model",
                "approval_policy": "interactive",
            }),
        );
        let stored = manager
            .store()
            .get_member(&spawned.member_id)
            .unwrap()
            .unwrap();
        assert_eq!(stored.model.as_deref(), Some("explicit-model"));
        assert_eq!(stored.workspace, Workspace::Shared);
        assert_eq!(stored.approval_policy, ApprovalPolicy::Interactive);
    }

    /// 团队默认 model 也会进 argv：控制字符必须在这里被拒（不是等执行层 panic）。
    #[test]
    fn a_team_default_model_with_control_characters_is_refused() {
        let manager = configured_team(&TeamConfig {
            default_model: Some("so\nnet".into()),
            ..TeamConfig::default()
        });
        let err = call(
            &manager,
            &lead(),
            "team_spawn",
            &json!({"agent_id": "claude-code", "name": "w9"}),
        )
        .unwrap_err();
        assert!(matches!(err, AppError::InvalidInput(_)), "{err:?}");
        assert!(err.to_string().contains("control characters"), "{err}");
        assert!(manager.member("w9@tm_1").is_none());
    }

    /// `team_options`（MCP 出口）与别的出口**同一个函数**：载荷逐字等于
    /// `options_for(team, member_count)`。
    ///
    /// 判据的形态是「比对可见行为」而不是「读源码找函数名」：把这里改成自己拼一份清单
    /// （哪怕只少一个成员），这条就会红。
    #[test]
    fn team_options_is_the_same_derivation_as_the_panel() {
        let manager = configured_team(&TeamConfig {
            allowed_agent_ids: vec!["pi".into(), "claude-code".into()],
            default_model: Some("team-default-model".into()),
            max_members: 2,
            ..TeamConfig::default()
        });
        spawn_ok(&manager, &lead(), &spawn_args("claude-code", "w1"));

        let reply = call(&manager, &lead(), "team_options", &json!({})).unwrap();
        let ToolReply::Options(options) = reply else {
            panic!("team_options 必须返回 Options，实际 {reply:?}");
        };

        let team = manager.team(TEAM).expect("团队行");
        assert_eq!(options, options_for(&team, manager.member_count(TEAM)));
        assert_eq!(options.defaults.max_members, 2);
        assert_eq!(options.defaults.member_count, 1);
        assert_eq!(options.defaults.remaining(), 1);
        assert_eq!(
            options.defaults.default_model.as_deref(),
            Some("team-default-model")
        );
        let ids: Vec<&str> = options
            .members
            .iter()
            .map(|row| row.agent_id.as_str())
            .collect();
        assert_eq!(ids, vec!["claude-code", "pi"]);

        // 成员（worker）也能读（只读面，授权矩阵里与 `team_status` 同列）。
        let as_worker = call(&manager, &worker(W1), "team_options", &json!({})).unwrap();
        assert_eq!(as_worker, ToolReply::Options(options));
    }

    /// 未知团队 → `NotFound`（队长凭证是签发时真实存在过的产物，走到这里说明团队行没了）。
    #[test]
    fn team_options_for_a_missing_team_is_not_found() {
        let manager = configured_team(&TeamConfig::default());
        let err = call(
            &manager,
            // 团队行不存在的队长凭证（内存镜像里没有 `tm_gone`）。
            &principal("ghost@tm_gone", MemberRole::Lead, "tm_gone"),
            "team_options",
            &json!({}),
        )
        .unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "{err:?}");
    }

    // ── P2.4：`team_wait`（异步入口）──────────────────────────────

    /// 已满足 → `ToolReply::Wait(Satisfied)`，且**载荷只有快照**。
    ///
    /// 保护的不变量：`team_wait` 走 `call_async` 时与同步工具共用同一份翻译/授权/校验
    /// （本用例的入参形状就是 schema 里 `on.members` 那一格），并且返回值是
    /// `WaitOutcome` 而不是自由文本（红线 4）。
    /// 红线 3 的机器判据：`call_async` 的非阻塞分支必须把同步工具**推进阻塞池**。
    ///
    /// # 为什么是源码级断言而不是行为断言
    ///
    /// 两种实现的**外部可观测行为完全相同** —— 差别只在于「哪条线程持锁写库」。
    /// 没有可注入的探针就无法在运行时区分它们（有 Spy 也测不到"占没占 worker"）。
    /// 所以这里退回源码判据：它至少能把「有人删掉 spawn_blocking」变成一条红测试。
    ///
    /// 真正的端到端证明要靠压测（多 Agent 并发 + IPC 延迟），不在单测层。
    #[test]
    fn synchronous_tools_are_dispatched_on_the_blocking_pool() {
        let source = include_str!("dispatch.rs");
        let start = source
            .find("pub async fn call_async")
            .expect("call_async 存在");
        // 字符安全切片：源码里有中文，按**字节**切片会撞 UTF-8 边界。
        let body: String = source[start..].chars().take(2_000).collect();
        assert!(
            body.contains(concat!("spawn", "_blocking")),
            "call_async 必须把同步工具推进阻塞池（红线 3）：rusqlite 是阻塞 API，\
             在 tokio worker 上持锁写库会拖垮同批的 IPC / LSP / 终端任务"
        );
        assert!(
            body.contains("ToolName::TeamWait"),
            "team_wait 必须留在异步侧：它的等待循环不碰 SQLite，阻塞它等于白占一个 worker"
        );
    }

    #[tokio::test]
    async fn team_wait_returns_a_satisfied_snapshot() {
        let manager = seeded();
        manager
            .observe_signal(
                W1,
                crate::agent::team::types::MemberSignal::TurnCompleted,
                1_000,
            )
            .unwrap();

        let reply = call_async(
            &rt(),
            &manager,
            &lead(),
            "team_wait",
            &json!({"on": {"members": [W1]}, "until": "idle", "timeout_s": 5}),
        )
        .await
        .unwrap();

        let ToolReply::Wait(WaitOutcome::Satisfied { snapshot }) = reply else {
            panic!("必须是 Wait(Satisfied)，实际 {reply:?}");
        };
        assert_eq!(snapshot.team_id, TEAM);
        assert_eq!(snapshot.members.len(), 1);
        assert_eq!(snapshot.members[0].member_id, W1);
    }

    /// 超时**不是错误**：`call_async` 返回 `Ok(Wait(Timeout))`，方便队长读现状。
    ///
    /// 保护的不变量：design §4.3「超时不报错」。若这里返回 `Err`，MCP 层会把它映成
    /// `-32000`，模型只会重试同一个调用（而不是换策略）。
    #[tokio::test]
    async fn team_wait_times_out_without_an_error() {
        let manager = seeded();
        let reply = call_async(
            &rt(),
            &manager,
            &lead(),
            "team_wait",
            &json!({"on": {"members": [W1]}, "until": "declared", "timeout_s": 1}),
        )
        .await
        .unwrap();
        let ToolReply::Wait(WaitOutcome::Timeout { snapshot }) = reply else {
            panic!("必须是 Wait(Timeout)，实际 {reply:?}");
        };
        assert_eq!(snapshot.members[0].state, MemberState::Spawned);
    }

    /// worker 也能调 `team_wait`（design §3.2 两角色均放行）。
    ///
    /// 保护的不变量：授权只看角色，而 `team_wait` 不是队长专属 —— 成员等同伴是合法的。
    /// 同时这是 `call_async` **没有**另写一套授权逻辑的反证（若它复制了一份矩阵，
    /// 这里就会漏掉 `TeamWait` 那一格）。
    #[tokio::test]
    async fn worker_may_call_team_wait() {
        let manager = seeded();
        manager
            .observe_signal(
                W2,
                crate::agent::team::types::MemberSignal::TurnCompleted,
                1_000,
            )
            .unwrap();
        let reply = call_async(
            &rt(),
            &manager,
            &worker(W1),
            "team_wait",
            &json!({"on": {"members": [W2]}, "until": "idle", "timeout_s": 5}),
        )
        .await
        .unwrap();
        assert!(
            matches!(reply, ToolReply::Wait(WaitOutcome::Satisfied { .. })),
            "{reply:?}"
        );
    }

    /// 同步入口拿到 `team_wait` 必须明确拒绝（不返回一个假的「已超时」）。
    ///
    /// 保护的不变量：两入口并存时，「选错入口」的错误必须是响亮的。静默降级成
    /// `Timeout{snapshot}` 会让队长把「实现走错分支」读成「队友还没做完」。
    #[test]
    fn sync_entry_point_refuses_team_wait() {
        let manager = seeded();
        let err = call(
            &manager,
            &lead(),
            "team_wait",
            &json!({"on": {"members": [W1]}}),
        )
        .unwrap_err();
        let AppError::Unsupported(message) = err else {
            panic!("同步入口必须是 Unsupported，实际 {err:?}");
        };
        assert!(message.contains("call_async"), "{message}");
    }

    /// `on` 的形状校验：缺 / 空 / 同时给 members+tasks / 类型错，都要点名参数。
    ///
    /// 保护的不变量：空目标集若被放过，`satisfied` 会立刻（或永不）返回 ——
    /// 两种都是「看起来成功但什么也没等」。同时给 members 与 tasks 则语义含混
    /// （成员空闲 ≠ 它手上的任务 done），必须让调用方选一个。
    #[tokio::test]
    async fn team_wait_rejects_malformed_targets() {
        let manager = seeded();
        let cases = [
            json!({}),
            json!({"on": {}}),
            json!({"on": {"members": []}}),
            json!({"on": {"members": [W1], "tasks": ["t1"]}}),
            json!({"on": {"members": "w1@tm_1"}}),
            json!({"on": {"members": [""]}}),
            json!({"on": {"members": [7]}}),
        ];
        for args in cases {
            let err = call_async(&rt(), &manager, &lead(), "team_wait", &args)
                .await
                .unwrap_err();
            let AppError::InvalidInput(message) = err else {
                panic!("{args} 必须是 InvalidInput，实际 {err:?}");
            };
            assert!(message.contains("on"), "{args}: {message}");
        }
    }

    /// 未知 `until` → `InvalidInput` 并列出三个合法值（模型据此自我纠正）。
    #[tokio::test]
    async fn team_wait_rejects_unknown_until() {
        let manager = seeded();
        let err = call_async(
            &rt(),
            &manager,
            &lead(),
            "team_wait",
            &json!({"on": {"members": [W1]}, "until": "finished"}),
        )
        .await
        .unwrap_err();
        let AppError::InvalidInput(message) = err else {
            panic!("必须是 InvalidInput，实际 {err:?}");
        };
        for wire in ["declared", "idle", "any"] {
            assert!(message.contains(wire), "{message}");
        }
    }

    /// `timeout_s`：缺省 1800、**超过上限截到 1800（不报错）**、非法值拒绝。
    ///
    /// 保护的不变量：「队长多给不该失败」与「写错的 0 不能被静默当成默认值」是两条方向
    /// 相反的规则，用**同一个**解析函数的表格钉住，避免它们被分散到两处各改一半。
    #[test]
    fn timeout_defaults_clamps_and_rejects() {
        let parse = |args: serde_json::Value| wait_timeout("team_wait", &args);
        assert_eq!(
            parse(json!({})).unwrap(),
            std::time::Duration::from_secs(1800)
        );
        assert_eq!(
            parse(json!({"timeout_s": 60})).unwrap(),
            std::time::Duration::from_secs(60)
        );
        assert_eq!(
            parse(json!({"timeout_s": 99_999})).unwrap(),
            std::time::Duration::from_secs(1800),
            "超过上限必须截断而不是报错"
        );
        for bad in [
            json!({"timeout_s": 0}),
            json!({"timeout_s": -5}),
            json!({"timeout_s": "60"}),
        ] {
            let err = parse(bad.clone()).unwrap_err();
            assert!(matches!(err, AppError::InvalidInput(_)), "{bad}: {err:?}");
        }
    }

    /// 目标必须**属于本队**：外队成员 / 不存在一律 `NotFound`（不泄漏别队花名册）。
    #[tokio::test]
    async fn team_wait_on_a_foreign_or_unknown_target_is_not_found() {
        let manager = seeded();
        for args in [
            json!({"on": {"members": [OUTSIDER]}}),
            json!({"on": {"members": ["nobody@tm_1"]}}),
            json!({"on": {"tasks": ["t404"]}}),
        ] {
            let err = call_async(&rt(), &manager, &lead(), "team_wait", &args)
                .await
                .unwrap_err();
            assert!(matches!(err, AppError::NotFound(_)), "{args}: {err:?}");
        }
    }

    /// 等任务：`tasks` 目标在 done 后满足，且载荷只有任务行。
    #[tokio::test]
    async fn team_wait_on_tasks_reports_the_task_rows() {
        let manager = seeded();
        manager.create_task(task("t1", TEAM)).unwrap();
        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, 1_000)
            .unwrap();
        manager
            .update_task(
                &TaskRef::new(TEAM, "t1"),
                W1,
                TeamTaskState::Done,
                Some("ok"),
                1_100,
            )
            .unwrap();

        let reply = call_async(
            &rt(),
            &manager,
            &lead(),
            "team_wait",
            &json!({"on": {"tasks": ["t1"]}, "until": "declared", "timeout_s": 1}),
        )
        .await
        .unwrap();
        let ToolReply::Wait(WaitOutcome::Satisfied { snapshot }) = reply else {
            panic!("必须是 Wait(Satisfied)，实际 {reply:?}");
        };
        assert!(snapshot.members.is_empty());
        assert_eq!(snapshot.tasks.len(), 1);
        assert_eq!(snapshot.tasks[0].state, TeamTaskState::Done);
        assert_eq!(snapshot.tasks[0].owner.as_deref(), Some(W1));
    }

    /// `team_close` 对已 `Dead` 的成员必须 `Conflict`（重复关闭是无意义写操作）。
    #[test]
    fn team_close_rejects_an_already_dead_member() {
        let manager = seeded();
        manager
            .observe_signal(W2, crate::agent::team::types::MemberSignal::Exited, 1_000)
            .unwrap();
        let err = call(&manager, &lead(), "team_close", &json!({"member_id": W2})).unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
    }

    // ───────────────────────────────────────────────────────────────
    // P2.5a：`team_spawn` 的决策部分（准入 + 落库；起进程在 2.5b）
    // ───────────────────────────────────────────────────────────────

    /// `MemberCreated` 的字段摊平成测试结构，让每条断言都能点名自己保护哪条不变量。
    #[derive(Debug)]
    struct Spawned {
        member_id: String,
        tier: AdmissionTier,
        unverified: Vec<String>,
    }

    /// `team_spawn` 的最小合法入参。
    fn spawn_args(agent_id: &str, name: &str) -> serde_json::Value {
        json!({"agent_id": agent_id, "name": name, "workspace": {"kind": "shared"}})
    }

    /// 队长 spawn 成功，并把 `MemberCreated` 摊平。
    fn spawn_ok(
        manager: &TeamManager,
        principal: &TeamPrincipal,
        args: &serde_json::Value,
    ) -> Spawned {
        match call(manager, principal, "team_spawn", args) {
            Ok(ToolReply::MemberCreated {
                member_id,
                tier,
                unverified,
            }) => Spawned {
                member_id,
                tier,
                unverified,
            },
            other => panic!("team_spawn 必须返回 MemberCreated，实际 {other:?}"),
        }
    }

    /// Lead spawn 一个 A 档成员：成员落库、状态 `Spawned`、库里只有 hash。
    ///
    /// 保护的不变量（design §5.1 的两相位）：`team_spawn` 只**决定**（准入 + 落库），
    /// **不**起进程 —— 所以返回的是 `MemberCreated`（成员已落库、待执行层起进程），
    /// 成员此刻是 `Spawned` 而不是 `Running`。若这里直接写 `Running`，2.5b 的 PTY 失败
    /// 就会留下一个“看起来在跑”但没有进程的成员。
    #[test]
    fn lead_spawns_a_worker_and_the_member_lands_like_a_decision() {
        let manager = seeded();
        let mut args = spawn_args("claude-code", " w9 ");
        args["model"] = json!("opus");
        let spawned = spawn_ok(&manager, &lead(), &args);

        // id 形如 `{name}@{team}` —— 名字首尾空白被 trim。
        assert_eq!(spawned.member_id, "w9@tm_1");

        let member = manager
            .member("w9@tm_1")
            .expect("成员必须落库（内存 + store）");
        assert_eq!(member.team_id, TEAM);
        assert_eq!(member.name, "w9");
        // 本步只允许 spawn worker：队长是已有会话，不是 spawn 出来的。
        assert_eq!(member.role, MemberRole::Worker);
        assert_eq!(member.agent_id, "claude-code");
        assert_eq!(member.model.as_deref(), Some("opus"));
        assert_eq!(member.state, MemberState::Spawned);
        assert_eq!(member.tier, AdmissionTier::A);
        assert_eq!(member.channel, WorkerChannel::CLI_MEMBER);
        assert_eq!(member.result_channel, ResultChannel::Mcp);
        assert_eq!(member.mcp_injection, McpInjection::Argv);
        // 默认审批策略是 Queue（design §6.1：不冒泡进队长对话）。
        assert_eq!(member.approval_policy, ApprovalPolicy::Queue);
        assert_eq!(member.last_seq, 0);
        // 进程尚未起：没有 terminal 关联。
        assert_eq!(member.terminal_id, None);
        assert_eq!(member.workspace, Workspace::Shared);
        // 凭证尚未签发：空 hash ⇒ 不可认证。明文由执行层取一次，不经过模型上下文。
        assert!(
            member.token_hash.is_empty(),
            "spawn 不得顺带签发凭证（否则明文会进 tools/call 的返回，进而进会话历史）"
        );

        // 回复只带「队长能行动的信息」：没有 env、没有凭证、没有执行参数。
        // `unverified` 是准入表那一列的**原样搬运**（不是空列表）：本行的诚实面现在
        // 包含「preamble argv 只验到参数解析」，它会原封不动地交给队长。
        assert_eq!(spawned.tier, AdmissionTier::A);
        let expected: Vec<String> = admission_for("claude-code")
            .expect("admitted")
            .unverified
            .iter()
            .map(|note| (*note).to_owned())
            .collect();
        assert_eq!(spawned.unverified, expected, "{spawned:?}");
        assert!(
            !spawned.unverified.is_empty(),
            "本行有一条未验证事实（preamble 只验了参数解析），必须回给队长"
        );
    }

    /// **执行层的输入全部可从成员行重新推导**（所以它们不必随工具返回走）。
    ///
    /// 保护的不变量：`ToolReply::MemberCreated` 只带 `member_id` / `tier` / `unverified`，
    /// 而 2.5b 装配 PTY 需要的一切（env、MCP 注入方式、传输、旁路参数）都必须能从
    /// **已落库的那一行** 算回来。本用例把四个推导入口各走一遍：
    ///
    /// | 执行层需要 | 推导式 |
    /// | --- | --- |
    /// | env | `identity::member_env(team_id, member_id)` |
    /// | 注入方式 / 传输 | `admission_for(member.agent_id)` |
    /// | 旁路参数 | 上一行 + `member.approval_policy` |
    ///
    /// 反证形式：只要哪天有人把某个字段从 `TeamMember` 上删了（或成需求时忘了落库），
    /// 这里就红 —— 而不是等到 2.5b 在运行时发现“推不出来”。
    #[test]
    fn member_row_carries_everything_the_executor_needs() {
        let manager = seeded();
        let mut args = spawn_args("claude-code", "w9");
        args["approval_policy"] = json!("bypass");
        let spawned = spawn_ok(&manager, &lead(), &args);
        let member = manager.member(&spawned.member_id).expect("member");

        // ① env：只由两个 id 决定（不依赖任何请求态）。
        let env = identity::member_env(&member.team_id, &member.id);
        let keys: Vec<&str> = env.iter().map(|(key, _)| key.as_str()).collect();
        assert!(keys.contains(&identity::TEAM_ID_ENV), "{env:?}");
        assert!(keys.contains(&identity::TEAM_MEMBER_ID_ENV), "{env:?}");

        // ② + ③ 注入方式 / 传输 / 旁路参数：全部从准入表 + 成员行算出。
        let admission = admission_for(&member.agent_id).expect("member.agent_id 必须在准入表里");
        assert_eq!(member.mcp_injection, admission.mcp_injection);
        // 入站通道不是表的事实（一律 PTY）；表只提供注入方式 / 传输 / 旁路参数。
        assert_eq!(member.channel, WorkerChannel::CLI_MEMBER);
        assert_eq!(admission.result_channel(), member.result_channel);
        assert_eq!(spawned.tier, tier_of(admission));
        assert_eq!(
            admission.bypass_args(member.approval_policy),
            vec!["--dangerously-skip-permissions".to_owned()],
            "Bypass 策略 + claude-code 那一行 = 它自己的旁路开关"
        );
    }

    /// 执行层签发的**明文 token** 与库里那份 hash 必须对得上（否则成员是个哑巴）。
    ///
    /// 保护的不变量：design §3.1「落库只存 sha256，明文只下发一次」；且**下发点在执行层**
    /// 而不是工具返回（工具返回会进模型上下文）。如果签发时把明文当成 hash 存了、或者
    /// 两者用的是不同摘要，这里会失败；而不是等到成员首次调用工具才得到 401。
    #[test]
    fn the_issued_token_resolves_through_the_stored_hash() {
        let manager = seeded();
        let spawned = spawn_ok(&manager, &lead(), &spawn_args("claude-code", "w9"));

        // 执行层取凭证：明文**只在这一行出现**，随即被用掉。
        let token = manager
            .issue_token(&spawned.member_id, 1_500)
            .expect("issue");

        let member = manager
            .store()
            .list_members(TEAM)
            .expect("读库")
            .into_iter()
            .find(|row| row.id == spawned.member_id)
            .expect("落库的成员行");
        // 主体表由**库里的 hash** 作 key（与 2.5b 的 `principals` 同形状）。
        // env 的值也从两个 id 推导（`member_env` 是唯一实现处，不靠回复传），
        let env: std::collections::HashMap<String, String> =
            identity::member_env(&member.team_id, &member.id)
                .into_iter()
                .collect();
        let expected = TeamPrincipal {
            team_id: env
                .get(identity::TEAM_ID_ENV)
                .expect("env 里必须有 team id")
                .clone(),
            member_id: env
                .get(identity::TEAM_MEMBER_ID_ENV)
                .expect("env 里必须有 member id")
                .clone(),
            role: MemberRole::Worker,
            channel: member.channel,
            tier: member.tier,
        };
        let principals =
            std::collections::HashMap::from([(member.token_hash.clone(), expected.clone())]);

        assert_eq!(
            identity::resolve_principal(&principals, &token),
            Some(&expected),
            "签发的明文 token 必须能命中库里的 hash"
        );
        assert!(identity::resolve_principal(&principals, "wrong").is_none());
    }

    /// 授权格：worker 调 `team_spawn` → `Conflict`（design §3.2）。
    ///
    /// 保护的不变量：**成员不能建成员** —— 否则任意成员都能无限扇出，绕过队长的
    /// 工作量控制；这条判定在 `authorize`（纯函数），所以拒绝时一个成员都不会落库。
    #[test]
    fn worker_cannot_spawn_members() {
        let manager = seeded();
        let err = call(
            &manager,
            &worker(W1),
            "team_spawn",
            &spawn_args("claude-code", "w9"),
        )
        .unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
        // 拒绝必须发生在落库之前（授权先行）。
        assert!(manager.member("w9@tm_1").is_none());
    }

    /// 未知 agent / `dsh` → `NotFound`，且 message 含准入表的已知 id 清单。
    ///
    /// 保护的不变量：错误是写给队长模型的提示。`dsh` 特别重要（它 hook 能上报，
    /// 很容易被当成可用成员），所以它的拒绝理由必须点名「没有 `AgentConfig`」。
    #[test]
    fn unknown_agent_is_not_found_and_the_refusal_lists_spawnable_ids() {
        let manager = seeded();
        for (agent_id, expected) in [
            ("no-such-agent", "spawnable agent ids"),
            ("dsh", "no `AgentConfig`"),
        ] {
            let err =
                call(&manager, &lead(), "team_spawn", &spawn_args(agent_id, "w9")).unwrap_err();
            let AppError::NotFound(message) = err else {
                panic!("{agent_id} 必须是 NotFound，实际 {err:?}");
            };
            assert!(message.contains(expected), "{agent_id}: {message}");
            for admission in crate::agent::team::admission::ADMISSIONS {
                assert!(
                    message.contains(admission.agent_id),
                    "{agent_id} 的拒绝信息漏了 {}：{message}",
                    admission.agent_id
                );
            }
            assert!(manager.member("w9@tm_1").is_none(), "拒绝时不得落库");
        }
    }

    /// 成员名在**入口**就 sanitize：`@` / 控制字符 / 超长全部 `InvalidInput`。
    ///
    /// 三条判据各挡一个具体坏结果（见 [`member_name`] 的表）：
    ///
    /// - `@`：`{name}@{team}` 解析错位 = 身份可伪造（`evil@w1@tm_1` 与 `evil` 前缀混淆）；
    /// - `\0`：2.5b 的 `Command::env` 会 **panic**（OS 层 env 不允许 NUL）；
    /// - `\n`：日志行与 sentinel 行被劈成两行；
    /// - 超长：花名册与每次 `tools/call` 的载荷被一个随手写的长串撑大。
    ///
    /// 全部拒绝而非清洗：id 是标识符，静默改写会让队长拿到的 id 与它请求的名字不一致，
    /// 而它下一步还要用这个 id 派活。
    #[test]
    fn member_name_is_sanitised_at_the_boundary() {
        let manager = seeded();
        let roster_before = manager
            .store()
            .list_members(TEAM)
            .expect("seeded roster")
            .len();
        let too_long = "w".repeat(65);
        for (name, expected) in [
            ("evil@w1", "@"),
            ("w\u{0}1", "control characters"),
            ("w\n1", "control characters"),
            (too_long.as_str(), "the limit is 64"),
        ] {
            let err = call(
                &manager,
                &lead(),
                "team_spawn",
                &spawn_args("claude-code", name),
            )
            .unwrap_err();
            let AppError::InvalidInput(message) = err else {
                panic!("{name:?} 必须是 InvalidInput，实际 {err:?}");
            };
            assert!(message.contains(expected), "{name:?}: {message}");
        }
        // 一条都没落库（拒绝发生在 `add_member` 之前）。
        assert_eq!(
            manager.store().list_members(TEAM).expect("roster").len(),
            roster_before
        );

        // 正例对照：恰好到上限的名字可以建（否则上面的拒绝可能是「永远拒」）。
        let at_limit = "w".repeat(64);
        let spawned = spawn_ok(&manager, &lead(), &spawn_args("claude-code", &at_limit));
        assert_eq!(spawned.member_id, format!("{at_limit}@{TEAM}"));
    }

    /// `model` / `workspace.path` 与 `name` 共用**同一条**控制字符判据。
    ///
    /// 保护的不变量：三个字段最终都会离开 JSON 世界（env / argv / 文件系统），
    /// 而 `\0` 在那三处都不可表示 —— 2.5b 会在 `Command::env` / `Command::arg` 上 panic。
    /// 一处漏判 = 一个只在 spawn 时爆的远距离故障，所以判据只有一个实现（`reject_control_chars`）。
    #[test]
    fn control_characters_are_rejected_on_every_injected_field() {
        let manager = seeded();
        let mut args = spawn_args("claude-code", "w9");
        args["model"] = json!("opus\n--dangerously-skip-permissions");
        let err = call(&manager, &lead(), "team_spawn", &args).unwrap_err();
        assert!(
            matches!(&err, AppError::InvalidInput(m) if m.contains("control characters")),
            "{err:?}"
        );

        // 第二形态：路径里的 NUL（绝对路径由 manifest 目录拼出 —— 红线 13；NUL 由 `format!`
        // 追加，所以这里**没有**手写平台绝对路径字面量）。
        let nul_path = format!("{}/w9\u{0}", env!("CARGO_MANIFEST_DIR"));
        let err = call(
            &manager,
            &lead(),
            "team_spawn",
            &json!({
                "agent_id": "claude-code",
                "name": "w9",
                "workspace": {"kind": "worktree", "path": nul_path}
            }),
        )
        .unwrap_err();
        assert!(
            matches!(&err, AppError::InvalidInput(m) if m.contains("control characters")),
            "{err:?}"
        );
        assert!(manager.member("w9@tm_1").is_none(), "拒绝时不得落库");
    }

    /// 重名 → `Conflict`（`manager.add_member` 的既有判定，本层只负责让它报）。
    ///
    /// 保护的不变量：成员 id 唯一性由**一个**地方裁决；dispatch 另写一份预检会让
    /// 「内存已插入但落库失败」这类半截状态重新变成可能。
    #[test]
    fn a_duplicate_member_name_is_a_conflict() {
        let manager = seeded();
        let err = call(
            &manager,
            &lead(),
            "team_spawn",
            &spawn_args("claude-code", "w1"),
        )
        .unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
        // 原成员未被覆盖（token_hash 仍是夹具里的值）。
        assert_eq!(manager.member(W1).unwrap().token_hash, "deadbeef");
    }

    /// `workspace.kind = "worktree"` 的 path 规则：**必填且必须绝对**。
    ///
    /// 保护的不变量：
    /// - 缺 path 时**不能**静默降级成 `Shared` —— 那是「以为在做隔离的活，实际和别的
    ///   成员共用同一个 cwd」，而共享 cwd 下的 hook 归因只能靠 env（design §5.4）；
    /// - 相对路径也不能收：本层不触盘，而 2.5b 的 `git worktree` / PTY 会按**进程 cwd**
    ///   解析它 —— 那是一条已定的错误，只是失败点被推到很远的地方。
    #[test]
    fn worktree_workspace_requires_an_absolute_path() {
        let manager = seeded();
        for (workspace, expected) in [
            (json!({"kind": "worktree"}), "workspace.path"),
            (
                json!({"kind": "worktree", "path": "wt/w9"}),
                "must be absolute",
            ),
            (json!({"kind": "pathless"}), "workspace.kind"),
        ] {
            let err = call(
                &manager,
                &lead(),
                "team_spawn",
                &json!({"agent_id": "claude-code", "name": "w9", "workspace": workspace}),
            )
            .unwrap_err();
            let AppError::InvalidInput(message) = err else {
                panic!("{workspace} 必须是 InvalidInput，实际 {err:?}");
            };
            assert!(message.contains(expected), "{workspace}: {message}");
        }
        // 拒绝时不得落库（防止半截成员）。
        assert!(manager.member("w9@tm_1").is_none());

        // 正例对照：给了**绝对** path 就能建（否则上面的拒绝可能是「永远拒」）。
        // 起点由 manifest 目录推导（红线 13：不手写 POSIX 绝对路径）。
        let worktree = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("wt/w9");
        let spawn = spawn_ok(
            &manager,
            &lead(),
            &json!({
                "agent_id": "claude-code",
                "name": "w9",
                "workspace": {"kind": "worktree", "path": worktree}
            }),
        );
        assert_eq!(
            manager.member(&spawn.member_id).unwrap().workspace,
            Workspace::Worktree { path: worktree }
        );
    }

    /// B 档 agent（`omp`，无 MCP 表面）：没有工具面 ⇒ **建不出成员**；`result = Sentinel`。
    ///
    /// 保护的不变量（红线 14 声明即实现）：向一个没有 MCP 面的 CLI 声明「它有工具面」
    /// 会让它连 `task_claim` 都调不了（花名册里一个永远不动的名字）；而 `result_channel`
    /// 必须说真话 —— 它的结果只能从 sentinel 行里捞。
    ///
    /// 注意 `channel` 不在这条判据里：CLI 成员的入站通道一律 `Pty`（`WorkerChannel::CLI_MEMBER`），
    /// 「能不能用工具」由 `has_mcp()` 表达。
    #[test]
    fn tier_b_agent_is_refused_before_a_member_row_exists() {
        let manager = seeded();
        // 档位与通道仍是**表的事实**（B 档：能报不能收）—— 测试直接从准入表读，
        // 因为 `team_spawn` 已经不再允许建出这样一个成员（C5）。
        let admission = admission_for("omp").expect("omp 在准入表里");
        assert!(!admission.has_mcp(), "无工具面 ⇒ 收不到任务");
        assert_eq!(admission.result_channel(), ResultChannel::Sentinel);
        assert_eq!(admission.mcp_injection, McpInjection::None);
        assert_eq!(admission.transport, None, "没有已实现的 MCP 通道");
        assert!(!admission.unverified.is_empty(), "能力缺口必须诚实列出");

        // 早拒，且理由可读（AC7b）：`team_spawn` 说清楚为什么现在不能建它。
        let err = spawn(&manager, &lead(), &spawn_args("omp", "w9"))
            .expect_err("无 MCP 面的 CLI 必须被早期拒绝");
        assert!(matches!(err, AppError::Unsupported(_)), "{err:?}");
        assert!(err.to_string().contains("no MCP surface"), "{err}");
        // 关键：拒绝路径上**没有**留下成员行（否则花名册里会多一个永远不动的名字）。
        assert!(manager.member("w9@tm_1").is_none());
    }

    /// C 档 agent（`grok`，无 hook **但**有 MCP 工具面）：`result = Sentinel`。
    ///
    /// **这条专门防「按档位一刀切」**：把 C 档一律映射成 `channel=None` 会白白丢掉
    /// grok 可用的 MCP 面（research/admission-matrix.md §3.4 的反例：能收不能报）。
    /// 两个通道是**两个维度**，不是档位的两个别名。
    #[test]
    fn tier_c_agent_with_mcp_is_still_refused_until_its_injection_lands() {
        let manager = seeded();
        // **档位与注入方式是两列，不能互相推**：grok 是 C 档（无 hook）但**有** MCP 面 ——
        // 把 C 档一律映射成 `channel=None` 会白白丢掉它能收消息的那一面。
        let admission = admission_for("grok").expect("grok 在准入表里");
        assert_eq!(tier_of(admission), AdmissionTier::C);
        assert!(admission.has_mcp(), "有 MCP 面（能用工具）");
        assert_eq!(
            admission.result_channel(),
            ResultChannel::Sentinel,
            "但它报不上来（无 hook）"
        );
        assert_eq!(admission.mcp_injection, McpInjection::Subcommand);
        assert_eq!(
            admission.transport,
            Some(crate::agent::team::admission::McpTransport::Http)
        );

        // 但 v1 **建不出来**：注入方式是子命令（`grok mcp add`），执行层只会启动参数注入。
        // 建出来再失败更糟 —— 成员起得来、tool 面静默不可见（红线 14）。
        let err = spawn(&manager, &lead(), &spawn_args("grok", "w9"))
            .expect_err("注入档未实现的 CLI 必须被早期拒绝");
        assert!(matches!(err, AppError::Unsupported(_)), "{err:?}");
        assert!(err.to_string().contains("Subcommand"), "{err}");
        assert!(manager.member("w9@tm_1").is_none());
    }

    /// `approval_policy = "bypass"` → 启动参数等于**该 agent 表里**那一行。
    ///
    /// 保护的不变量（红线 15）：旁路开关是 per-CLI 数据。断言的是「取值来自准入表」
    /// 而不是某个字面量分支 —— 换成 `codebuddy` 必须拿到它自己的两段参数。
    ///
    /// 同时钉住「执行层不需要额外通道」：两个输入（准入表行 + 成员行的
    /// `approval_policy`）都已在库/表里，所以返回里没有任何 veto 参数无关字段。
    #[test]
    fn bypass_policy_forwards_the_pinned_cli_args() {
        let manager = seeded();
        for (agent_id, expected) in [
            ("claude-code", vec!["--dangerously-skip-permissions"]),
            ("codebuddy", vec!["-y", "--dangerously-skip-permissions"]),
        ] {
            // 每行一个不同的成员名（成员 id 是 `{name}@{team}`，重名会 `Conflict`）。
            let mut args = spawn_args(agent_id, &format!("w-{agent_id}"));
            args["approval_policy"] = json!("bypass");
            let spawned = spawn_ok(&manager, &lead(), &args);

            let member = manager.member(&spawned.member_id).unwrap();
            assert_eq!(member.approval_policy, ApprovalPolicy::Bypass);
            let expected: Vec<String> = expected.iter().map(|arg| (*arg).to_owned()).collect();
            let admission = admission_for(&member.agent_id).expect("admitted");
            assert_eq!(
                admission.bypass_args(member.approval_policy),
                expected,
                "{agent_id} 的旁路参数"
            );
        }
        // 默认（不给 approval_policy）= Queue ⇒ 一个参数都不追加。
        let spawned = spawn_ok(&manager, &lead(), &spawn_args("claude-code", "w8"));
        let member = manager.member(&spawned.member_id).unwrap();
        assert_eq!(member.approval_policy, ApprovalPolicy::Queue);
        assert!(
            admission_for("claude-code")
                .unwrap()
                .bypass_args(member.approval_policy)
                .is_empty(),
            "非 Bypass 策略不得追加任何参数"
        );
    }

    /// `approval_policy` 闭集：未知值 / 非字符串 → `InvalidInput`（不静默降级）。
    ///
    /// 保护的不变量：把 `"bypass "` 静默当成默认 Queue 的后果是「队长以为已经旁路，
    /// 成员却卡在审批上」—— 失败点离家很远。
    #[test]
    fn unknown_approval_policy_is_rejected() {
        let manager = seeded();
        for policy in [json!("yolo"), json!(3)] {
            let mut args = spawn_args("claude-code", "w9");
            args["approval_policy"] = policy.clone();
            let err = call(&manager, &lead(), "team_spawn", &args).unwrap_err();
            assert!(
                matches!(err, AppError::InvalidInput(_)),
                "{policy}: {err:?}"
            );
        }
        assert!(manager.member("w9@tm_1").is_none());
    }
}
