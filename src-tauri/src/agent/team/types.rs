//! 团队域值类型 —— **纯数据，无行为**（design.md §2 逐条落地）。
//!
//! 三条结构性约束：
//!
//! 1. 本文件只放数据。状态迁移在 [`crate::agent::team::completion`]，租约计算在
//!    [`crate::agent::team::lease`] —— 两者都是纯函数，才能做到 100% 分支覆盖。
//! 2. `channel` 与 `result_channel` **必须分开**（design §4.4）：grok 就是「能收不能报」的
//!    反例；合成一个字段会逼着实现按 CLI 名分支，违反红线 15。
//! 3. 时间戳一律 `i64` epoch 毫秒（与既有 store 的口径一致）。
//!
//! 序列化口径：结构体 `camelCase`（IPC 面向），枚举 `snake_case`（与
//! `StreamEvent` / `NotificationClass` 一致）。枚举的变体名同时也是落库的 TEXT 值
//! （见 `store::text_of`），所以**改名即迁移**，不要随手改。

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// 一个团队：一名队长 + N 名成员 + 一块共享任务板。
///
/// `project_path` 与 `project_id` 是**两个不同的事实**，不要互相顶替：
///
/// | 字段 | 是什么 |
/// | --- | --- |
/// | `project_path` | 团队根的**工作区根**（可以是工作树，落在项目目录之外）|
/// | `project_id` | 拥有这个团队执行环境的**项目 id**（环境的权威是项目）|
///
/// 为什么两者不能合并见 [`super::execution::environment_source`]：路径前缀反查对
/// Neeko 自己的工作树（`~/.neeko/worktrees/<name>`）永远匹配不上。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Team {
    /// 团队 id，形如 `tm_{nanos_hex}`。
    pub id: String,
    /// 用户可读名字；缺省时由调用方派生（本层不派生）。
    pub name: String,
    /// 队长的会话 id（PTY 会话）。
    pub lead_session_id: String,
    /// 队长的 agent id（`AgentConfig.id`）。
    pub lead_agent_id: String,
    /// 团队根工作区（归一化后的绝对路径）。
    pub project_path: PathBuf,
    /// 拥有这个团队**执行环境**的项目 id。
    ///
    /// 与 `project_path` 不是同一件事：路径是工作区根（可以是工作树，按设计落在项目
    /// 目录之外），id 是环境归属。执行层按 id 精确查表，不再拿路径去反查项目。
    ///
    /// **空串 = v16 之前建的行**（那时环境只能靠路径前缀猜），**不是**「没有项目」：
    /// 写入路径（`bootstrap::plan_team`）对空 id 直接拒绝，所以空只可能来自旧库。
    #[serde(default)]
    pub project_id: String,
    /// 建队时间（epoch 毫秒）。
    pub created_at: i64,
    /// 关闭时间；`None` = 未关闭。
    pub closed_at: Option<i64>,
    /// 团队状态。
    pub state: TeamState,
    /// 允许被 `team_spawn` 选中的 CLI（`agent_id`）。**空 = 不限制**。
    ///
    /// 空池的语义刻意是「不限制」而不是「一个都不许」：建队是一次性入场动作，
    /// 不该强迫用户在开第一个会话之前先勾选成员；而**限制**是显式动作。
    /// 读那一侧必须把空池**解析**成「当前全部可启动 CLI」再展示
    /// （[`crate::agent::team::options::options_for`]），否则队长会看到空池并以为不能 spawn。
    #[serde(default)]
    pub allowed_agent_ids: Vec<String>,
    /// 成员 `team_spawn` 未传 `model` 时的缺省；`None` = 让该 CLI 用自己配置里的默认。
    #[serde(default)]
    pub default_model: Option<String>,
    /// 成员未传 `workspace` 时的缺省（缺省 = 团队根共享）。
    #[serde(default)]
    pub default_workspace: Workspace,
    /// 成员未传 `approval_policy` 时的缺省（缺省 = 进待批队列，R0b.3）。
    #[serde(default)]
    pub default_approval_policy: ApprovalPolicy,
    /// 成员 `team_spawn` 未传 `persona` 时的缺省角色名；`None` = 无人设。
    ///
    /// 存**名字**而不是快照：角色库是可编辑的，spawn 那一刻才把名字解析成
    /// `Persona` 快照落到成员行上（「成员行携带执行所需的一切」，
    /// `team-domain.md` §2.2）。这里只表达团队的**意图**。
    #[serde(default)]
    pub default_persona: Option<String>,
    /// 成员位的角色预设（面板池位下拉；agent_id → persona 名）。
    ///
    /// 解析链（`mcp::dispatch::spawn`）：显式参数 > **role_hint** > `default_persona` >
    /// 无人设。面板给每个池位挑好角色，队长 spawn 时即使一字不提，后端也按预设
    /// 注入人设 —— 「预设」由用户决定，不由模型自觉。
    #[serde(default)]
    pub role_hints: Vec<AgentRoleHint>,
    /// 成员上限（**不含队长**）。缺省 [`DEFAULT_MAX_MEMBERS`]，合法区间 [`1`, [`MAX_MEMBERS_LIMIT`]]。
    #[serde(default = "default_max_members")]
    pub max_members: u32,
}

/// 成员的缺省上限（不含队长）。
///
/// 取 4 而不是「越大越好」：一个队长同时协调的可观测上限很低（`team_status` 的每行、
/// 每次 `team_wait` 的目标集都要人读），而它同时也是并发 PTY 的数量。
/// 真要走更大的队，用户显式改这一列。
pub const DEFAULT_MAX_MEMBERS: u32 = 4;

/// 成员上限的**硬上界**（`max_members` 的合法区间是 `1..=MAX_MEMBERS_LIMIT`）。
///
/// 上界存在的理由与 [`DEFAULT_MAX_MEMBERS`] 同源：每个成员是一个真进程 + 一份隔离配置
/// 目录 + 一条 PTY 缓冲。给一个「想要 200 个成员」的输入一个安静的截断，比拒绝更糟 ——
/// 用户以为配上了。
pub const MAX_MEMBERS_LIMIT: u32 = 8;

/// serde 缺省：`max_members` 缺失时取 [`DEFAULT_MAX_MEMBERS`]。
///
/// 单独成函数是因为 `#[serde(default)]` 对 `u32` 会给出 `0` —— 而 `0` 是一个被
/// [`MAX_MEMBERS_LIMIT`] 区间**拒绝**的值。用默认值表达「没给」，用区间表达「给错了」。
const fn default_max_members() -> u32 {
    DEFAULT_MAX_MEMBERS
}

/// 建队时的团队配置入参（`start_team_session` 的 `config`，也用于 `team_options` 的解析）。
///
/// 与 [`Team`] 的五个配置列**同名同义**：一份数据，两个用途（写入口 / 读出来的解析）。
/// 分成两个类型而不是复用 `Team`，是因为建队时其余字段（id / 会话 / 路径 / 状态）由
/// 后端决定，调用方不该有机会传它们。
///
/// 每个字段都带 serde 缺省，所以面板可以只传它真的改过的那几项（`None` 整个不传 = 全默认）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamConfig {
    /// 允许被 `team_spawn` 选中的 CLI（空 = 不限制）。
    #[serde(default)]
    pub allowed_agent_ids: Vec<String>,
    /// 成员未传 `model` 时的缺省。
    #[serde(default)]
    pub default_model: Option<String>,
    /// 成员未传 `workspace` 时的缺省。
    #[serde(default)]
    pub default_workspace: Workspace,
    /// 成员未传 `approval_policy` 时的缺省。
    #[serde(default)]
    pub default_approval_policy: ApprovalPolicy,
    /// 成员未传 `persona` 时的缺省角色名（必须在角色库里；`None` = 无人设）。
    #[serde(default)]
    pub default_persona: Option<String>,
    /// 成员位的角色预设（池位下拉；与 `Team::role_hints` 同名同义）。
    #[serde(default)]
    pub role_hints: Vec<AgentRoleHint>,
    /// 成员上限（不含队长）。
    #[serde(default = "default_max_members")]
    pub max_members: u32,
}

impl Default for TeamConfig {
    fn default() -> Self {
        Self {
            allowed_agent_ids: Vec::new(),
            default_model: None,
            default_workspace: Workspace::default(),
            default_approval_policy: ApprovalPolicy::default(),
            default_persona: None,
            role_hints: Vec::new(),
            max_members: DEFAULT_MAX_MEMBERS,
        }
    }
}

/// 团队状态机：`Active → Closing → Closed`（单向，不可回退）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TeamState {
    /// 运行中。
    Active,
    /// 正在协商关闭（成员被要求收尾，进程尚未全退）。
    Closing,
    /// 已关闭；此状态后不再接受任何写操作。
    Closed,
}

/// 一名团队成员。
///
/// `id` 形如 `{name}@{team}`：团队内唯一，**落库前已 sanitize**（本层不 sanitize，
/// 它是写入方的责任 —— 见 `manager`）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamMember {
    /// 成员 id（`{name}@{team}`）。
    pub id: String,
    /// 所属团队。
    pub team_id: String,
    /// 用户可读名字。
    pub name: String,
    /// 队长 / 成员（决定授权矩阵，design §3.2）。
    pub role: MemberRole,
    /// 复用的 `AgentConfig.id`。
    pub agent_id: String,
    /// 模型覆盖；`None` = 用该 agent 的默认。
    pub model: Option<String>,
    /// 预留：接 Chat 成员时才用（design §7.4）。本期恒 `None`。
    pub session_id: Option<String>,
    /// CLI 的**原生会话 id**（hook 上报的 `agent_session_id`）。
    ///
    /// 用途只有一个：成员退出后还能按它打开**历史 transcript**（`conversation` 域的
    /// `agent_id:native_id`）—— 「已退出的成员」没有活的 PTY，但它的会话记录还在磁盘上。
    /// 由观察者从 hook 事件里记录（第一次见到就写，之后不变：同一成员的 native id 稳定）。
    #[serde(default)]
    pub agent_session_id: Option<String>,
    /// 本期唯一：关联的 PTY 会话 id（CLI 成员）。
    pub terminal_id: Option<String>,
    /// 成员的 cwd（`Shared` = 团队根，`Worktree{path}` = 独立 worktree）。
    pub workspace: Workspace,
    /// 怎么**发**消息给它。
    pub channel: WorkerChannel,
    /// 它怎么**报**结果 —— 与 `channel` 刻意分开（design §4.4）。
    pub result_channel: ResultChannel,
    /// 准入档位，由 `team_spawn` 依实测能力推导，**调用方不可声明**（design §4.4）。
    pub tier: AdmissionTier,
    /// 审批策略。
    pub approval_policy: ApprovalPolicy,
    /// MCP 配置的注入方式（P0 实测得出，design §5.5）。
    pub mcp_injection: McpInjection,
    /// 上报单调性水位线（design §7.2 的 `seq` 去重；消费在 P1.5）。
    pub last_seq: u64,
    /// 成员状态。
    pub state: MemberState,
    /// token 的 sha256；**只存 hash，不存明文**（design §3.1）。
    pub token_hash: String,
    /// 入队时间（epoch 毫秒）。
    pub joined_at: i64,
    /// 人设快照（spawn 那一刻从角色库解析并落行；`None` = 无人设）。
    ///
    /// 快照而不是引用：preamble 文本在 spawn 时进 argv，之后角色库怎么改都不影响
    /// 这个成员「是带着什么文本被拉起来的」——那是可复现的事实。名字用于花名册
    /// 展示与审计；正文由执行层拼进角色 preamble（`identity::with_persona`）。
    #[serde(default)]
    pub persona: Option<Persona>,
}

/// 成员的人设快照（[`TeamMember::persona`]）。
///
/// 与 [`MemberRole`] 严格分开：`MemberRole(Lead | Worker)` 是**授权矩阵**的唯一输入
/// 维度（design §3.2），persona 是「这个成员怎么干活」的文本包 —— 它永远不能改变
/// 授权判定，所以它是成员行上的**数据**，不是一个角色变体。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Persona {
    /// 角色名（角色库 [`RolePreset::name`] 在 spawn 时刻的快照）。
    pub name: String,
    /// 人设正文（进 argv 的那段文本；长度上限 = [`crate::agent::team::identity::preamble::MAX_PERSONA_CHARS`]）。
    pub preamble: String,
}

/// 角色库里的一条预设（`team_role` 表，全局共享，不隶属任何队）。
///
/// `approval_policy` / `default_workspace` 是 spawn 时刻的**缺省覆盖**：显式参数 >
/// persona > 团队缺省（三层，见 `mcp::dispatch::spawn`）。`cli_preference` 只是
/// **建议**（面板预选 / 队长读 `team_options` 时参考），不是判据 —— 准入判据仍然
/// 只在 `admission` 表里（红线 15：persona 是数据，不是代码分支）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRoleHint {
    /// 哪个 CLI（`AgentConfig.id`）。
    pub agent_id: String,
    /// 用哪个角色（角色库 [`RolePreset::name`]）。
    pub persona: String,
}

/// 角色库里的一条预设（`team_role` 表，全局共享，不隶属任何队）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RolePreset {
    /// 角色名（主键；spawn 传这个名字，成员行快照这个名字）。
    pub name: String,
    /// 人设正文（进成员 argv 的那段；**英文**，与角色 preamble 同一读者）。
    pub preamble: String,
    /// 建议用哪个 CLI 当这个角色（`AgentConfig.id`；`None` = 不建议）。
    pub cli_preference: Option<String>,
    /// spawn 时未显式传 `approval_policy` 时的覆盖；`None` = 落回团队缺省。
    pub approval_policy: Option<ApprovalPolicy>,
    /// spawn 时未显式传 `workspace` 时的覆盖；`None` = 落回团队缺省。
    pub default_workspace: Option<Workspace>,
    /// 创建时间（epoch 毫秒；排序用）。
    pub created_at: i64,
}

/// 成员角色。决定授权矩阵（design §3.2）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemberRole {
    /// 队长：可 spawn / close / create / force_done。
    Lead,
    /// 成员：只能 claim / update 自有任务 / propose。
    Worker,
}

/// 一名已认证的调用主体 —— token 解析的产物（design §3.1）。
///
/// 与 [`TeamMember`] 的区别：这是**认证结果**，不是持久化实体。它只带授权判定需要的
/// 五列（谁 / 哪个队 / 角色 / 怎么发 / 准入档），刻意**不含** `token_hash` ——
/// 把 hash 带进调用链只会给「顺手比较一下」制造机会，而比对的唯一落点是
/// `server/gate.rs`（进程内 `ct_eq` 调用点 = 1）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamPrincipal {
    /// 所属团队。
    pub team_id: String,
    /// 成员 id（`{name}@{team}`）。
    pub member_id: String,
    /// 角色 —— 授权矩阵的唯一输入维度。
    pub role: MemberRole,
    /// 怎么给它**发**消息（copy 自 `TeamMember.channel`，签发时取自权威行）。
    pub channel: WorkerChannel,
    /// 准入档位（copy 自 `TeamMember.tier`）。
    pub tier: AdmissionTier,
}

/// 成员状态。**六态徽标契约**（`prototype-agent-team.html` 视图 ②）—— 一个都不能合并。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemberState {
    /// 已建、进程尚未跑起来。
    Spawned,
    /// 正在干活（收到过 TurnStart）。
    Running,
    /// 在等人（审批 / 输入）。审批门的家（design §6.1）。
    Awaiting,
    /// 空闲 —— 「它说完了」，**不等于**「它做完了」（design §6 硬规则 1）。
    Idle,
    /// 成员自己的任务被显式声明为 done。
    Done,
    /// 本回合失败。
    Failed,
    /// 进程退出（L4）。
    Dead,
    /// 静默超阈值 / 租约到期（L3）。
    Stalled,
}

/// 任务的**唯一寻址形式**：`(team_id, id)`。
///
/// 单独一个 `id` 在全仓**不再是任务的标识符** —— `t1` 在每个队都存在（每个队从 `t1`
/// 开始编号）。把这个事实做成一个类型，而不是让每个调用点自己拼两个字符串：拼错了
/// （少传 / 传错队）的症状是「静默读到别队的任务」，比任何报错都难查（红线 12 的同一
/// 条纪律：身份不从字符串拼）。
///
/// # 两个入口分别怎么拿到 `team_id`（语义分界，不要互相借用）
///
/// | 入口 | 线上形状 | `team_id` 从哪来 |
/// | --- | --- | --- |
/// | MCP 工具（`task_claim` / `task_update` / `task_list` / `team_wait` …） | 仍然只有 `task_id` | `principal.team_id`（既有的 [`crate::agent::team::mcp`] `task_of_team` 是唯一的构造点） |
/// | 本地 IPC（面板） | `team_task_detail(team_id, task_id)` | 调用方显式给（本地入口没有 principal，两个参数都必填） |
///
/// MCP 侧不让模型自己传 `team_id` 是刻意的：token 已经声明了它是哪个队，再让它传一个
/// 队 id 就等于给它一个伪造（或写错）的机会。
///
/// [`TeamTask::key`] 是**从任务行回到它的键**的唯一方式（不要在外层重复拼）。
#[derive(Clone, Debug, PartialEq, Eq, Hash, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRef {
    /// 所属团队 id。
    pub team_id: String,
    /// 队内任务 id（形如 `t{seq}`）。
    pub id: String,
}

impl TaskRef {
    /// 拼一个寻址键。取 `impl Into<String>` 是为了让 `&str` / `String` 调用点都能直写。
    #[must_use]
    pub fn new(team_id: impl Into<String>, id: impl Into<String>) -> Self {
        Self {
            team_id: team_id.into(),
            id: id.into(),
        }
    }
}

/// `{team_id}/{id}` —— **只给错误信息与日志用**。
///
/// 它不是第二个序列化口径（线上是 `{teamId, id}` 对象），所以没有 `Deserialize`：
/// 让人用字符串解析回 `TaskRef` 就是重新引入「拼字符串找身份」的老毛病（红线 12）。
impl std::fmt::Display for TaskRef {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}/{}", self.team_id, self.id)
    }
}

/// 任务板上的一个任务。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamTask {
    /// 任务 id，形如 `t{seq}`。
    pub id: String,
    /// 所属团队。
    pub team_id: String,
    /// 标题（板上一行显示）。
    pub title: String,
    /// 派活正文（可为较长 prompt）。
    pub body: String,
    /// 任务状态。
    pub state: TeamTaskState,
    /// 持有者 member id；`claimed` / `in_progress` 时**有且只有一个**（不变量 1）。
    pub owner: Option<String>,
    /// 任务的工作区。`state != Pending` 后**不可变**（不变量 5）。
    pub workspace: Workspace,
    /// 依赖的任务 id；未全部 `done` 时不可 claim（不变量 3）。
    pub depends_on: Vec<String>,
    /// 起租时间（epoch 毫秒）；`lease_expired` 的输入。
    pub claimed_at: Option<i64>,
    /// 租约时长（秒），默认 1800，可按任务覆盖。
    pub lease_ttl: i64,
    /// 结果摘要，**硬上限 4 KiB**（红线 4）。落库时由 `store::upsert_task` 截断。
    pub summary: Option<String>,
    /// 摘要是否被截断 —— 截断后 UI 必须能区分「短」和「被砍」。
    ///
    /// design §2 的 `TeamTask` 没有这个字段，但 §7.3 明写「`summary` 硬上限 4KB
    /// （`store` 层截断 + **记 `truncated`**）」—— 没有字段就无处可记。
    #[serde(default)]
    pub summary_truncated: bool,
    /// 产物**引用**（路径 / commit / PR），不是内容。
    pub artifacts: Vec<Artifact>,
    /// 被回收次数，用于板上标「反复失败」（不变量 4 的输入）。
    pub reclaim_count: u32,
}

impl TeamTask {
    /// 这个任务的**唯一寻址形式**（`team_id` + `id`）。
    ///
    /// 内存镜像与库都以它为键：单独一个 `id` 只在队内唯一（每个队的板都从 `t1` 开始），
    /// 拿 `id` 去查必然存在「读到别队的 `t1`」这个可能。
    #[must_use]
    pub fn key(&self) -> TaskRef {
        TaskRef::new(self.team_id.clone(), self.id.clone())
    }
}

/// 产物引用 —— 只存定位信息，绝不存内容（design §2、红线 4）。
///
/// design §2 用了 `Vec<Artifact>` 但没给 `Artifact` 定义；这里取最小闭集：
/// 进程内能验证、UI 能点开的三种引用。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    /// 引用类别。
    pub kind: ArtifactKind,
    /// 引用值（路径 / commit sha / PR 号）。
    pub value: String,
}

/// 产物引用的类别。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactKind {
    /// 文件系统中的路径（相对团队根或绝对路径）。
    Path,
    /// git commit sha。
    Commit,
    /// PR / MR 编号或 URL。
    PullRequest,
}

/// 工作区。任务与成员共用同一套语义。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Workspace {
    /// 团队根工作区（多成员共享 ⇒ 同 cwd，归因只能靠 env，见 design §5.4）。
    Shared,
    /// 独立 worktree + 分支（P4 隔离）。
    Worktree {
        /// worktree 路径。
        path: PathBuf,
    },
    /// 只读（成员不得写盘）。
    ReadOnly,
}

/// 缺省 = 团队根共享。
///
/// 它是**配置列**（`Team.default_workspace`）的缺省，也是 `Workspace` 作为数据在
/// 序列化缺省时的取值：隔离（`Worktree`）是显式动作，因为它的路径必须落在团队根内
/// 且由调用方给出。
impl Default for Workspace {
    fn default() -> Self {
        Self::Shared
    }
}

/// 怎么给成员**发**消息（能力声明，红线 14：声明即实现）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkerChannel {
    /// MCP 工具调用。**只有真能在对方那边落地时才能声明** —— 见 [`Self::CLI_MEMBER`]。
    Mcp,
    /// 写 PTY stdin，best effort（写入协议见 research/04：两次写 + ~150ms）。
    Pty,
    /// 只能一次性派活。
    None,
}

impl WorkerChannel {
    /// CLI 成员的唯一通道：**`Pty`**。
    ///
    /// # 为什么不是 `Mcp`（哪怕它能用 MCP 工具）
    ///
    /// 「有 MCP 面」与「能往它嘴里推消息」是**两件事**。MCP over HTTP 是客户端发起的：
    /// 成员调我们，我们**没有**反向推送通道，工具面里也没有收件箱。
    ///
    /// 所以按「有 MCP 面 ⇒ channel = Mcp」推导，会得到一条**不存在的通道**（红线 14）——
    /// 症状是 `team_send` 永远失败，队长以为派了活而成员从未收到。
    ///
    /// CLI 成员的进程本身就在 PTY 里，唯一能把字送进它回合的是 stdin。`Mcp` 因此留给
    /// 将来的 Chat 成员（`SessionRequest` 是真正的结构化下行通道），不是「有工具」的同义词。
    pub const CLI_MEMBER: Self = Self::Pty;
}

/// 成员怎么**报**结果。与 [`WorkerChannel`] 分开，因为二者可以不同。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResultChannel {
    /// MCP 工具调用（`task_update`）。
    Mcp,
    /// 打印 sentinel 行到 stdout（design §5.7）。
    Sentinel,
    /// 报不上来。
    None,
}

/// 准入档位 —— 由三项实测条件组合推出，**不允许调用方自行声明**（design §4.4）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AdmissionTier {
    /// hook + MCP：完成 / 结果 / 卡住 全可见。
    A,
    /// hook only：结果靠 sentinel 补，卡住仍可见。
    B,
    /// sentinel only：结果可用，**卡住永远不可知** ⇒ UI 必须写「可能等待输入」。
    C,
}

/// 审批策略。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalPolicy {
    /// 逐个交互式批准。
    Interactive,
    /// 进待批队列，由人攒着处理（design §6.1：不冒泡进队长对话）。
    Queue,
    /// 旁路（开关写法落插件数据，红线 15）。
    Bypass,
}

/// 缺省 = 进待批队列（R0b.3：审批不冒泡进队长对话）。
///
/// `Interactive` 会把审批提示写进成员自己的 PTY（队长看不见），`Bypass` 是显式放弃
/// 审批 —— 两者都不该是「没给」的落点。
impl Default for ApprovalPolicy {
    fn default() -> Self {
        Self::Queue
    }
}

/// MCP 配置怎么塞给这个 CLI —— P0 实测得出，属插件数据（红线 15）。
///
/// # 四档的区别是**什么时候 / 往哪写**，不是“哪种更方便”
///
/// | 档 | 生效时机与写入位置 | 典型 CLI |
/// | --- | --- | --- |
/// | [`McpInjection::Argv`] | **本次启动**（`--mcp-config <json>` / `-c key=value`），不写任何文件 | claude-code / codebuddy / qoder / codex |
/// | [`McpInjection::ConfigDir`] | **重定向该 CLI 的配置目录**，再由它自己的 `mcp add` 写**隔离目录** | pi |
/// | [`McpInjection::Subcommand`] | 一次性的 `mcp add` 子命令，写进**用户的全局配置** | grok / opencode |
/// | [`McpInjection::ConfigFile`] | 直接改它的配置文件（`DeploySpec.mcp_config`） | gemini / reasonix |
///
/// 把「子命令写配置」归到 `Argv` 会让执行层给 CLI 传一个它不认的启动参数：**成员起得来，
/// MCP 面却静默不可见**（那就是本轮复审从 `research/admission-matrix.md` 里纠出来的错）。
///
/// # 为什么 `ConfigDir` 是**不带负载**的变体
///
/// 它需要的四个事实（重定向 env 名、目录内文件名、`mcp add` 命令、要镜像的条目）都是
/// **per-CLI 数据**，只允许挂在该 CLI 自己那一行上（`AgentAdmission::config_dir`，红线 15）。
/// 放进变体负载会有两个真实代价：① 本枚举要持久化（`team_member.mcp_injection` 列），
/// 负载会写进**每一个成员行**，于是同一条事实有了第二份拷贝，CLI 升级后旧行与新表会漂移；
/// ② 它会强制 owned 类型（`String` / `Vec`），而 `ADMISSIONS` 是 `static` 数据表 ——
/// 静态表里只能放 `&'static str`，那又过不了 `Deserialize`。所以：**档位是标签，事实在表里**。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum McpInjection {
    /// 启动参数注入（含 MCP 配置的 JSON / 覆盖项，**本次启动**生效，不写文件）。
    Argv,
    /// 重定向该 CLI 的配置目录，再由它自己的 `mcp add` 写出 MCP 配置。
    ///
    /// 与 [`McpInjection::Subcommand`] 的唯一差别是**写进哪里**：这里的目录是 Neeko 的
    /// 隔离目录（`~/.neeko/team/<team>/<member>/`），用户自己的配置文件零写入。
    ConfigDir,
    /// 用该 CLI 自己的 `mcp add` 子命令写**用户全局**配置（**下一次启动**生效）。
    Subcommand,
    /// 直接写它的配置文件（`Argv` / `Subcommand` 都不支持时的降级）。
    ConfigFile,
    /// 没有 MCP 表面。
    None,
}

/// 任务状态。**`done` 的唯一权威是这张板**，不是成员状态（design §6 硬规则 3）。
///
/// 注意与 [`MemberState`] 的区别：`InProgress` 只存在于任务侧（成员侧叫
/// `Running`）；`Blocked` / `Proposed` 也只存在于任务侧。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TeamTaskState {
    /// 待认领。
    Pending,
    /// 刚被认领（起租约），首轮 TurnStart 后才进 `InProgress`。
    Claimed,
    /// 执行中。
    InProgress,
    /// 等审批（审批门的家，design §6.1）。
    AwaitingApproval,
    /// 显式声明完成（L2）。
    Done,
    /// 显式声明失败，或队长判定失败。
    Failed,
    /// 反复回收次数超限，被冻结（不变量 4）。
    Blocked,
    /// 成员提出的任务，等队长 accept。
    Proposed,
}

/// 成员信号 —— design §5.6 里**本期唯一为 Chat 预留**的形状。
///
/// CLI 侧由 `HookEvent.event` 映射而来；将来 Chat 侧由 `StreamEvent` 映射而来。
/// 观察点因此不需要重写，只需多一个 mapper。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemberSignal {
    /// 一轮结束（hook `turn_completed` / `TurnEnd{Completed}`）—— L1。
    TurnCompleted,
    /// 请求批准（hook `approval_requested` / `RequestApproval`）。
    ApprovalRequested,
    /// 请求输入（hook `input_requested`）。
    InputRequested,
    /// 本回合失败（hook `session_failed` / `TurnEnd{Error}`）。
    Failed,
    /// 进程退出 / `SessionDone`。
    Exited,
}

impl MemberSignal {
    /// 这个信号是不是**活性证据**（成员还在干）—— 决定它续不续租约。
    ///
    /// 前三个都是「它刚刚做了什么」；`Failed` / `Exited` 恰好相反：拿它们续期会让
    /// 「成员已经死了」这件事再拖满一个 `lease_ttl` 才被回收，而 AC3 要的正是反方向
    /// （死了就尽快把任务放回板上）。
    #[must_use]
    pub const fn is_liveness(self) -> bool {
        matches!(
            self,
            Self::TurnCompleted | Self::ApprovalRequested | Self::InputRequested
        )
    }
}

/// 「看到回合结束了，但没看到 `task_update(done)`」的标记（design §6 硬规则 2）。
///
/// 只有 [`DoneVerification::Verified`] 代表 L2 显式声明到位；团队面板必须能区分二者
/// （徽标 + tooltip）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DoneVerification {
    /// 有 L2 显式声明（任务 `state == done`）背书。
    Verified,
    /// 只有 L1 回合信号，任务仍是进行中 —— 「空闲 ⚠ 未声明」（AC2）。
    Unverified,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 统一的 JSON 往返断言 —— 只在测试里存在，所以不需要宏。
    fn roundtrip<T>(value: T)
    where
        T: serde::Serialize + serde::de::DeserializeOwned + PartialEq + std::fmt::Debug,
    {
        let json = serde_json::to_string(&value).unwrap();
        let back: T = serde_json::from_str(&json).unwrap();
        assert_eq!(back, value, "roundtrip failed for {json}");
    }

    /// IPC 契约：每个枚举都必须能 JSON 往返，否则前端拿到的字面量与后端不一致
    /// （红线 5 的同族问题：双端只在常量层对齐）。
    #[test]
    fn every_unit_enum_roundtrips_through_json() {
        roundtrip(TeamState::Active);
        roundtrip(TeamState::Closing);
        roundtrip(TeamState::Closed);
        roundtrip(MemberRole::Lead);
        roundtrip(MemberRole::Worker);
        roundtrip(MemberState::Spawned);
        roundtrip(MemberState::Running);
        roundtrip(MemberState::Awaiting);
        roundtrip(MemberState::Idle);
        roundtrip(MemberState::Done);
        roundtrip(MemberState::Failed);
        roundtrip(MemberState::Dead);
        roundtrip(MemberState::Stalled);
        roundtrip(TeamTaskState::Pending);
        roundtrip(TeamTaskState::Claimed);
        roundtrip(TeamTaskState::InProgress);
        roundtrip(TeamTaskState::AwaitingApproval);
        roundtrip(TeamTaskState::Done);
        roundtrip(TeamTaskState::Failed);
        roundtrip(TeamTaskState::Blocked);
        roundtrip(TeamTaskState::Proposed);
        roundtrip(WorkerChannel::Mcp);
        roundtrip(WorkerChannel::Pty);
        roundtrip(WorkerChannel::None);
        roundtrip(ResultChannel::Mcp);
        roundtrip(ResultChannel::Sentinel);
        roundtrip(ResultChannel::None);
        roundtrip(AdmissionTier::A);
        roundtrip(AdmissionTier::B);
        roundtrip(AdmissionTier::C);
        roundtrip(ApprovalPolicy::Interactive);
        roundtrip(ApprovalPolicy::Queue);
        roundtrip(ApprovalPolicy::Bypass);
        roundtrip(McpInjection::Argv);
        roundtrip(McpInjection::ConfigDir);
        roundtrip(McpInjection::Subcommand);
        roundtrip(McpInjection::ConfigFile);
        roundtrip(McpInjection::None);
        roundtrip(MemberSignal::TurnCompleted);
        roundtrip(MemberSignal::ApprovalRequested);
        roundtrip(MemberSignal::InputRequested);
        roundtrip(MemberSignal::Failed);
        roundtrip(MemberSignal::Exited);
        roundtrip(DoneVerification::Verified);
        roundtrip(DoneVerification::Unverified);
        roundtrip(ArtifactKind::Path);
        roundtrip(ArtifactKind::Commit);
        roundtrip(ArtifactKind::PullRequest);
    }

    /// 枚举落库的 TEXT 值必须是 snake_case（`store::text_of` 依赖它）——
    /// 改名会静默把历史行读成「未知变体」，所以在这里钉一次字面量。
    #[test]
    fn enum_wire_names_are_the_documented_snake_case() {
        let pairs = [
            (
                serde_json::to_string(&TeamTaskState::InProgress).unwrap(),
                "\"in_progress\"",
            ),
            (
                serde_json::to_string(&MemberState::Awaiting).unwrap(),
                "\"awaiting\"",
            ),
            (serde_json::to_string(&AdmissionTier::A).unwrap(), "\"a\""),
            (
                serde_json::to_string(&MemberSignal::TurnCompleted).unwrap(),
                "\"turn_completed\"",
            ),
            (
                serde_json::to_string(&DoneVerification::Unverified).unwrap(),
                "\"unverified\"",
            ),
        ];
        for (actual, expected) in pairs {
            assert_eq!(actual, expected);
        }
    }

    /// 带数据的变体（`Workspace::Worktree`）也要能往返，且路径保持绝对语义。
    #[test]
    fn workspace_worktree_roundtrips_preserving_path() {
        let ws = Workspace::Worktree {
            path: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("wt"),
        };
        let json = serde_json::to_string(&ws).unwrap();
        let back: Workspace = serde_json::from_str(&json).unwrap();
        assert_eq!(back, ws);
    }

    /// 结构体走 camelCase（IPC 面向）：字段名一旦改成 snake_case，
    /// 前端 `invoke` 的入参会静默全丢。
    #[test]
    fn task_struct_serialises_fields_as_camel_case() {
        let task = TeamTask {
            id: "t1".into(),
            team_id: "tm_1".into(),
            title: "T".into(),
            body: "B".into(),
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
        };
        let json = serde_json::to_value(&task).unwrap();
        assert!(json.get("leaseTtl").is_some(), "{json}");
        assert!(json.get("summaryTruncated").is_some(), "{json}");
        assert!(json.get("dependsOn").is_some(), "{json}");
        assert!(json.get("lease_ttl").is_none(), "{json}");
    }

    /// `TaskRef` 是 `(team_id, id)` 的配对：`TeamTask::key()` 必须把**两列**都带上。
    ///
    /// 变异验证：把 `key()` 改成只带 `id` 时本用例变红 —— 而那个形状的症状（两个队的
    /// `t1` 互相覆盖）在单队测试里完全看不出来。
    #[test]
    fn a_task_key_carries_both_halves() {
        let task = TeamTask {
            id: "t1".into(),
            team_id: "tm_1".into(),
            title: "T".into(),
            body: "B".into(),
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
        };
        assert_eq!(
            task.key(),
            TaskRef::new("tm_1", "t1"),
            "键必须同时带 team_id 与 id"
        );
        // Display 只给错误信息 / 日志用（线上是 `{teamId, id}` 对象，不是这个字符串）。
        assert_eq!(task.key().to_string(), "tm_1/t1");
        // 同样的 id、不同的队 ⇒ 不同的键（Hash/Eq 是内存镜像的依赖）。
        assert_ne!(task.key(), TaskRef::new("tm_2", "t1"));
    }

    /// 旧行（没有 `summary_truncated` 列出现的版本）反序列化不能失败：
    /// 该字段带 `#[serde(default)]`，缺省即 `false`。
    #[test]
    fn missing_summary_truncated_defaults_to_false() {
        let json = r#"{
            "id":"t1","teamId":"tm_1","title":"T","body":"B","state":"pending",
            "owner":null,"workspace":"shared","dependsOn":[],"claimedAt":null,
            "leaseTtl":1800,"summary":null,"artifacts":[],"reclaimCount":0
        }"#;
        let task: TeamTask = serde_json::from_str(json).unwrap();
        assert!(!task.summary_truncated);
    }

    /// `Team` 的线上键集**逐字**钉住（camelCase）。
    ///
    /// 与 `TaskCard` / `TeamSession` 同一条规则：字段名对了不代表 wire 上名字对了，
    /// 而前端对 `Team` 有一个 TS 镜像（`src/shared/types/team.ts`）—— 那边读的是
    /// `allowedAgentIds` / `maxMembers` / `defaultApprovalPolicy` 这些键。
    /// 新增一个配置列而漏了这句断言，代价是前端拿到 `undefined` 而不报错。
    #[test]
    fn team_serialises_its_configuration_as_camel_case_keys() {
        let team = Team {
            id: "tm_1".into(),
            name: "T".into(),
            lead_session_id: "s".into(),
            lead_agent_id: "pi".into(),
            project_path: PathBuf::from("root"),
            // 线上键集的判据（下方）：`projectId` 与 `projectPath` 是**两个**不同的键 ——
            // 合并它们就等于把「环境归属」和「工作区根」搞成同一件事。
            project_id: "p1".into(),
            created_at: 1,
            closed_at: None,
            state: TeamState::Active,
            allowed_agent_ids: vec!["pi".into()],
            default_model: Some("m".into()),
            default_workspace: Workspace::Shared,
            default_approval_policy: ApprovalPolicy::Queue,
            default_persona: Some("研究员".into()),
            role_hints: Vec::new(),
            max_members: 2,
        };
        let json = serde_json::to_value(&team).unwrap();
        let mut keys: Vec<&str> = json
            .as_object()
            .expect("object")
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec![
                "allowedAgentIds",
                "closedAt",
                "createdAt",
                "defaultApprovalPolicy",
                "defaultModel",
                "defaultPersona",
                "defaultWorkspace",
                "id",
                "leadAgentId",
                "leadSessionId",
                "maxMembers",
                "name",
                "projectId",
                "projectPath",
                "roleHints",
                "state",
            ]
        );
        roundtrip(team);
    }

    /// 配置缺省：`max_members` 缺失 ≠ `0`（`0` 是一个被区间拒绝的值）。
    ///
    /// 这条区分就是「没给」与「给错了」的机器形式：`0` 必须是一个**可被判错的输入**，
    /// 不能被 serde 缺省悄悄吸收成 4。
    #[test]
    fn team_config_defaults_are_the_documented_ones() {
        let default = TeamConfig::default();
        assert!(default.allowed_agent_ids.is_empty(), "空池 = 不限制");
        assert_eq!(default.default_model, None, "None = 让 CLI 用自己的默认");
        assert_eq!(default.default_workspace, Workspace::Shared);
        assert_eq!(default.default_approval_policy, ApprovalPolicy::Queue);
        assert_eq!(default.max_members, DEFAULT_MAX_MEMBERS);

        // 整个字段缺失 = 缺省值。
        let empty: TeamConfig = serde_json::from_str("{}").unwrap();
        assert_eq!(empty, default);

        // 显式给 0 必须原样到达校验层（而不是被吸收成 4）。
        let zero: TeamConfig = serde_json::from_str(r#"{"maxMembers":0}"#).unwrap();
        assert_eq!(zero.max_members, 0);

        // 线上口径 = camelCase（面板传的就是这套键）。
        let json = serde_json::to_value(&default).unwrap();
        assert!(json.get("maxMembers").is_some(), "{json}");
        assert!(json.get("allowedAgentIds").is_some(), "{json}");
        assert!(json.get("max_members").is_none(), "{json}");
    }
}
