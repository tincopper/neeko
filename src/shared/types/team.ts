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

/** 团队行（`TeamSnapshot.team`）。 */
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
