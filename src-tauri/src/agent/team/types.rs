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
/// `project_path` 是**归一化根**，刻意不复用 `project_id` —— design §7.4 把
/// `AgentContext.project_id → project_path` 的改名划给 chat 域的债；PTY 侧成员
/// 只需要一个 cwd。
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
    /// 建队时间（epoch 毫秒）。
    pub created_at: i64,
    /// 关闭时间；`None` = 未关闭。
    pub closed_at: Option<i64>,
    /// 团队状态。
    pub state: TeamState,
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

/// MCP 配置怎么塞给这个 CLI —— P0 实测得出，属插件数据（红线 15）。
///
/// # 三档的区别是**什么时候**生效，不是“哪种更方便”
///
/// | 档 | 生效时机 | 典型 CLI |
/// | --- | --- | --- |
/// | [`McpInjection::Argv`] | **本次启动**（`--mcp-config <json>`） | claude-code / codebuddy / qoder |
/// | [`McpInjection::Subcommand`] | **一次性的 `mcp add` 子命令**，写进它自己的配置 | grok / opencode / pi |
/// | [`McpInjection::ConfigFile`] | 直接改它的配置文件（`DeploySpec.mcp_config`） | codex（TOML）/ gemini / reasonix |
///
/// 把「子命令写配置」归到 `Argv` 会让执行层给 CLI 传一个它不认的启动参数：**成员起得来，
/// MCP 面却静默不可见**（那就是本轮复审从 `research/admission-matrix.md` 里纠出来的错）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum McpInjection {
    /// 启动参数注入（含 MCP 配置的 JSON，**本次启动**生效）。
    Argv,
    /// 用该 CLI 自己的 `mcp add` 子命令写配置（**下一次启动**生效）。
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
}
