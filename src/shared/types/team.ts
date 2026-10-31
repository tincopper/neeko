/**
 * Agent Team 域的**类型镜像**（IPC 载荷）。
 *
 * **真相源是 `src-tauri/src/agent/team/{types,view}.rs`，改 Rust 必须同步这里。**
 * 结构体字段是 camelCase（Rust 侧 `#[serde(rename_all = "camelCase")]`），
 * 枚举是 snake_case 字面量联合（Rust 侧 `#[serde(rename_all = "snake_case")]`）。
 *
 * 三条约束：
 *
 * 1. **只镜像 Rust 里真实存在的字段** —— 多一个字段就是前端凭空造事实，后端永远不会填它，
 *    而它会被当成「有值 = 已发生」使用。少一个字段会在消费侧退化成 `any`。
 * 2. **这里没有 `TeamMember`**：快照的成员行是 `MemberStatusView`（`view.rs`），
 *    `TeamMember`（`types.rs`）只在 MCP/执行层内部流转，它的 `channel` / `tier` /
 *    `token_hash` 不会过 IPC。镜像一个用不上的类型会诱使面板「顺手展示一下」。
 * 3. **`TeamTask.body` 不在这里的列类型上**：列路径是 `TaskCard`（无正文），正文只在
 *    [`TaskDetail`] 上（点开才拉，红线 4）。类型层面就断了「顺手把 body 塞进列」的路。
 */

/** 团队状态机：`Active → Closing → Closed`（单向，不可回退）。 */
export type TeamState = 'active' | 'closing' | 'closed';

/** 成员角色。决定授权矩阵（队长可 spawn / close / create / force_done）。 */
export type MemberRole = 'lead' | 'worker';

/**
 * 成员状态（六态徽标契约，`prototype-agent-team.html` 视图 ②）—— **一个都不能合并**。
 *
 * 注意 `idle` 只说「它这一轮说完了」，**不等于**「它做完了」（design §6 硬规则 1）：
 * 要区分「空闲但没声明」必须再看 [`MemberStatusView.verification`]。
 */
export type MemberState =
  | 'spawned'
  | 'running'
  | 'awaiting'
  | 'idle'
  | 'done'
  | 'failed'
  | 'dead'
  | 'stalled';

/**
 * 取证水位线（AC2 的判据）：
 * - `verified`：有 L2 显式声明（`task_update(state=done)`）背书；
 * - `unverified`：只有 L1 回合信号，任务仍是进行中 ⇒ 徽标必须是「空闲 ⚠ 未声明」。
 */
export type DoneVerification = 'verified' | 'unverified';

/**
 * 任务状态。**`done` 的唯一权威是这张板**，不是成员状态（design §6 硬规则 3）。
 *
 * 与 [`MemberState`] 的差异是有意的：`in_progress` 只存在于任务侧（成员侧叫 `running`），
 * `blocked` / `proposed` 亦然。
 */
export type TeamTaskState =
  | 'pending'
  | 'claimed'
  | 'in_progress'
  | 'awaiting_approval'
  | 'done'
  | 'failed'
  | 'blocked'
  | 'proposed';

/** 产物引用的类别（只存定位信息，不存内容）。 */
export type ArtifactKind = 'path' | 'commit' | 'pull_request';

/** 产物引用（路径 / commit / PR）。 */
export interface Artifact {
  kind: ArtifactKind;
  value: string;
}

/**
 * 工作区。Rust 侧是带数据的枚举（externally tagged）：
 * - 单元变体 → 字符串 `'shared'` / `'read_only'`；
 * - `Worktree { path }` → `{ worktree: { path } }`。
 */
export type Workspace = 'shared' | 'read_only' | { worktree: { path: string } };

/**
 * 成员的审批策略（`types.rs::ApprovalPolicy`）。
 *
 * - `queue`：审批请求进待批队列（**默认**，不冒泡进队长对话 —— design §6.1）；
 * - `bypass`：旁路审批（显式放弃确认，红线 15 的开关）。
 */
export type ApprovalPolicy = 'interactive' | 'queue' | 'bypass';

/**
 * 团队行（`TeamSnapshot.team`）。
 *
 * 后五个字段是**团队组成配置**（`types.rs::Team` 的五个配置列，判据见
 * `team_serialises_its_configuration_as_camel_case_keys`）。建队时由 `TeamConfig` 写入，
 * 之后由 `team_options` 读回来 —— 面板展示的永远是解析后的形态（[`TeamDefaults`]）。
 */
export interface Team {
  id: string;
  name: string;
  /** 队长的会话 id（PTY 会话）。 */
  leadSessionId: string;
  /** 队长的 agent id（`AgentConfig.id`）。 */
  leadAgentId: string;
  /** 团队根工作区（后端**已规范化**的绝对路径）。 */
  projectPath: string;
  createdAt: number;
  closedAt: number | null;
  state: TeamState;
  /**
   * 允许被 `team_spawn` 选中的 CLI（`agentId`）。**空 = 不限制**，不是「一个都不许」
   * （读侧必须解析成实际池子，见 [`TeamDefaults.allowedAgentIds`]）。
   */
  allowedAgentIds: string[];
  /** 成员未传 `model` 时的缺省；`null` = 用该 CLI 自己的默认。 */
  defaultModel: string | null;
  /** 成员未传 `workspace` 时的缺省。 */
  defaultWorkspace: Workspace;
  /** 成员未传 `approvalPolicy` 时的缺省。 */
  defaultApprovalPolicy: ApprovalPolicy;
  /** 成员上限（**不含队长**），合法区间 `1..=8`。 */
  maxMembers: number;
}

/**
 * 团队配置的**解析结果**（`team_options` 载荷的一半，真相源 `options.rs::TeamDefaults`）。
 *
 * 与 [`TeamConfig`] 的差别只有一个但很关键：这里的 `allowedAgentIds` **永远是解析后的实际
 * 池子**（空池已展开成本机全部可启动 CLI），而 `TeamConfig` 里的空数组是「不限制」这个
 * **配置意图**。把两者混用，读侧就会把「没限制」读成「一个都不许」。
 */
export interface TeamDefaults {
  /** 解析后的实际池子（按 `agentId` 排序、去重；空池已展开）。 */
  allowedAgentIds: string[];
  /** 缺省模型；`null` = 该 CLI 自己的默认。 */
  defaultModel: string | null;
  /** 缺省工作区。 */
  defaultWorkspace: Workspace;
  /** 缺省审批策略。 */
  defaultApprovalPolicy: ApprovalPolicy;
  /** 成员上限（不含队长）。 */
  maxMembers: number;
  /** 当前成员数（**不含队长**）。 */
  memberCount: number;
}

/**
 * 团队配置面（`team_options` 的载荷，真相源 `options.rs::TeamOptions`）。
 *
 * 两个出口同形：`teamId = null` → 建队前的「本机目录」，`teamId = Some(id)` → 该队的
 * 实际配置。面板的默认值**只能**来自这里 —— 在前端写死 4 / `shared` / `queue` 就是第二份
 * 默认值，后端一改就漂移（且漂移是静默的）。
 */
export interface TeamOptions {
  /**
   * 实际可用的成员 CLI（已按池子过滤）。行类型与 `team_launchable_agents` 同一个 wire
   * 形状；`refusal` 恒为 `null`（能启动是这个列表的定义），保留那一列是为了让面板对两处
   * 候选**只写一份**渲染逻辑。
   */
  members: LaunchableAgent[];
  /** 该队配置**解析后**的形态（空池已展开、默认值已就位）。 */
  defaults: TeamDefaults;
}

/**
 * 建队时的团队配置**入参**（`start_team_session` 的 `config`，真相源 `types.rs::TeamConfig`）。
 *
 * 字段全部可选且与 [`Team`] 的五个配置列同名同义：**缺省即后端默认**。所以面板只该传
 * 它真的改过的那几项 —— 把 `TeamDefaults` 原样回传就等于把后端默认值抄成前端常量。
 */
export interface TeamConfig {
  /** 允许被 `team_spawn` 选中的 CLI（**空/省略 = 不限制**）。 */
  allowedAgentIds?: string[];
  /** 缺省模型（省略 = 用各 CLI 自己的默认）。 */
  defaultModel?: string | null;
  /** 缺省工作区。 */
  defaultWorkspace?: Workspace;
  /** 缺省审批策略。 */
  defaultApprovalPolicy?: ApprovalPolicy;
  /** 成员上限（不含队长），`1..=8`。 */
  maxMembers?: number;
}

/** 花名册一行。**只有 id / 名字 / 角色 / 状态 / 取证 / 租约剩余秒** —— 不含任何正文。 */
export interface MemberStatusView {
  memberId: string;
  name: string;
  role: MemberRole;
  state: MemberState;
  /** 取证水位线（见 [`DoneVerification`]）。 */
  verification: DoneVerification;
  /** 在飞任务的租约剩余秒：`null` = 无在飞任务；`0` = 已超时（尚未回收）。 */
  leaseRemainingSecs: number | null;
}

/**
 * 任务板上的一行 —— **没有 `body`**（红线 4：派活正文长度无上限，列载荷里不可能出现）。
 *
 * `summary` 是另一件事：后端落库时已硬截到 4 KiB，并置 `summaryTruncated`。
 */
export interface TaskCard {
  id: string;
  title: string;
  state: TeamTaskState;
  /** 持有者 member id。 */
  owner: string | null;
  workspace: Workspace;
  dependsOn: string[];
  claimedAt: number | null;
  leaseTtl: number;
  summary: string | null;
  summaryTruncated: boolean;
  artifacts: Artifact[];
  /** 被回收次数（> 0 意味着「反复失败」）。 */
  reclaimCount: number;
}

/** 任务详情（`team_task_detail`，**点开才拉**）：列视图 + 派活正文（线上是平铺的）。 */
export interface TaskDetail extends TaskCard {
  /** 派活正文（长度无上限 —— 这就是它不在列路径里的原因）。 */
  body: string;
}

/** 面板快照（`team_snapshot`）—— 面板渲染的**唯一**数据源。 */
export interface TeamSnapshot {
  team: Team;
  members: MemberStatusView[];
  /** 任务板列（后端至多 `view::MAX_BOARD_TASKS` = 200 行）。 */
  tasks: TaskCard[];
  /** 任务行是否被上界截断（面板据此显示「只显示前 N 条」）。 */
  tasksTruncated: boolean;
}

/**
 * 一个 CLI 的**启动可行性**（`team_launchable_agents`，真相源是
 * `src-tauri/src/agent/team/admission.rs` 的 `LaunchableAgent` / `launch_refusal`）。
 *
 * 为什么它是数据而不是 UI 的判断：
 *
 * - 「能不能起来」是三个输入的函数（技能面 / MCP 注入档 / 凭证路），其中两个今天还在变；
 * - 它与 `team_spawn` / `start_team_session` 的拒绝**同一份判据**。前端另写一份
 *   （哪怕是「`enabled` 且有 `command`」这种看起来最无害的筛法）必然漂移，
 *   而漂移的表现是「用户点到必然失败的按钮」或「明明能跑的成员被置灰」。
 *
 * 覆盖准入表里的**每个** CLI，包括不在表里的（`dsh` / 用户自定义）—— 后者也有
 * `refusal`，内容是「不在准入表，已准入的是哪些」。
 */
export interface LaunchableAgent {
  /** `AgentConfig.id`。 */
  agentId: string;
  /** `null` = 现在能拉起队长/成员；`Some(理由)` = 置灰理由（人读，已含注入方式 / 缺什么）。 */
  refusal: string | null;
}

/** 团队变更事件（`AGENT_TEAM_EVENT`）的载荷：**失效脉冲，只有代数**。 */
export interface TeamPulse {
  /** 写之后的团队代数（单调递增）。它不含团队 id —— 触发器里不放语义。 */
  rev: number;
}

/** `start_team_session` 的返回：队长能行动的三样（队 / 成员 / 落脚的终端）。 */
export interface TeamSession {
  teamId: string;
  /** 队长成员 id（`lead@{team}`）。 */
  memberId: string;
  /** 队长 PTY 的会话 id；前端据此接管那个终端（`existingSessionId`）。 */
  terminalId: string | null;
  /** 队员 MCP 配置里要连的端点（与执行层同源，便于排查）。 */
  endpointUrl: string;
}
