import type { ProjectId } from '@/shared/utils/workspaceRef';

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

/**
 * 团队状态机：`Open → Closing → Sealed`（单向，不可回退）。
 *
 * 三个词各自只说一件事，**不要**读成进程状态：
 *
 * | 值 | 含义 | 进程 |
 * | --- | --- | --- |
 * | `open` | 可派活、可恢复 | 可能有、可能一个都没有（进程跨不过重启）|
 * | `closing` | 用户要求关，收尾进行中 | 正在逐个关 |
 * | `sealed` | 用户封存（只读，不可恢复）| 一个都不在 |
 *
 * 旧名 `active` / `closed` 把「有没有进程」混进了团队意图里：`closed` 同时被读成
 * 「进程都关了」（可重启）与「用户关掉了」（不可重启）—— 这两件事在恢复动作上相反。
 */
export type TeamState = 'open' | 'closing' | 'sealed';

/** 成员角色。决定授权矩阵（队长可 spawn / close / create / force_done）。 */
export type MemberRole = 'lead' | 'worker';

/**
 * 成员状态（六态徽标契约，`prototype-agent-team.html` 视图 ②）—— **一个都不能合并**。
 *
 * 注意 `idle` 只说「它这一轮说完了」，**不等于**「它做完了」（design §6 硬规则 1）：
 * 要区分「空闲但没声明」必须再看 [`MemberStatusView.verification`]。
 *
 * `offline` 是**纯运行态**（进程不在：从未起过 / 已退出 / 重启后归位）。它**不**说明
 * 用户关掉了这个成员 —— 那是 [`MemberStatusView.sealed`]，两者维度不同、可同时为真。
 */
export type MemberState =
  | 'spawned'
  | 'running'
  | 'awaiting'
  | 'idle'
  | 'done'
  | 'failed'
  | 'offline'
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
  /** 队长的 agent id（`AgentConfig.id`）。 */
  leadAgentId: string;
  /** 团队根工作区（后端**已规范化**的绝对路径）。 */
  projectPath: string;
  /**
   * 拥有这个团队**执行环境**的项目 id（`types.rs::Team::project_id`）。
   *
   * 与 `projectPath` 是**两个事实**，不要互相顶替：路径是工作区根（可以是落在项目目录
   * 之外的 worktree），id 是环境归属。消费侧最典型的一处是「打开成员终端」—— 终端 tab
   * 按 `(projectId, 工作区)` 落键，用**激活项目**顶替会让用户切项目后把 tab 登记到另一棵
   * 树下面（进程接得上，登记错位）。
   *
   * **空串 = v16 之前建的行**（那时环境只能靠路径前缀猜），不是「没有项目」：
   * 写入路径对空 id 直接拒绝，所以空只可能来自旧库。
   *
   * 类型是 `ProjectId`（与 `shared/types/project.ts` 同一口径）：后端给的 id 到了 IPC 边界
   * 就是项目身份，消费侧不该再拿裸 `string` 去和激活项目比较 —— 裸串能赋给任何字段，
   * 「用激活项目顶替团队自己的项目」这类错误在类型层面就没有摩擦力。
   */
  projectId: ProjectId;
  /**
   * 团队所在工作区的**工作树维度**（`(projectId, workspaceWorktree)` 合成工作区身份）。
   *
   * `null` = **主 checkout**（项目根本身），不是「未知」。v23 之前建的行也没有这一维 ——
   * 那些行只能退回 `projectPath` 当工作区根。
   *
   * 与 `projectPath` 的关系：后者是身份在宿主机上的**落地路径**（已规范化），前者是身份本身。
   * 两个分量叉开（根指向工作树、身份写主仓）会让团队的 `session_cursors.workspace_key`
   * 落到另一棵树下 —— 侧栅分组与「历史归属」正是靠它们精确相等。
   */
  workspaceWorktree: string | null;
  createdAt: number;
  /**
   * 用户封存时刻（epoch 毫秒）；`null` = 未封存（可恢复）。
   *
   * 与 [`state`] 是同一件事的两个面：`state` 是机器判据，这里是可展示的时刻。
   * 旧名 `closedAt`（`closed` 同时被读成「进程关了」）。
   */
  sealedAt: number | null;
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
  /** 缺省角色名（`null` = 无人设；存在性由 spawn 时的后端判 —— 角色库可编辑）。 */
  defaultPersona: string | null;
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
  /** 缺省角色名（必须是角色库里已有的名字；省略 = 无人设）。 */
  defaultPersona?: string | null;
  /**
   * 成员位的角色预设（面板池位下拉）：agent_id → persona 名。
   *
   * 后端解析链：队长显式参数 > **roleHints** > `defaultPersona` > 无人设 ——
   * 面板给每个池位挑好角色，队长 spawn 时一字不提，后端也按预设注入人设。
   */
  roleHints?: AgentRoleHint[];
  /** 成员上限（不含队长），`1..=8`。 */
  maxMembers?: number;
}

/** 一条成员位角色预设（`types.rs::AgentRoleHint`，v20）。 */
export interface AgentRoleHint {
  /** 哪个 CLI（`AgentConfig.id`）。 */
  agentId: string;
  /** 用哪个角色（角色库 `RolePreset.name`）。 */
  persona: string;
}

/**
 * 怎么**发**消息给一个成员（`types.rs::WorkerChannel`）。
 *
 * CLI 成员恒为 `pty`（design §4.4）：MCP over HTTP 是客户端发起的，我们**没有**反向推送
 * 通道，所以「能调 MCP 工具」≠「能往它嘴里推消息」。`none` = 只能一次性派活。
 */
export type WorkerChannel = 'mcp' | 'pty' | 'none';

/**
 * 准入档位（`types.rs::AdmissionTier`）—— 能力缺口的唯一出处（红线 14）。
 *
 * | 档 | 有 hook | 有 MCP | 卡住可见 | UI 必须写 |
 * | --- | --- | --- | --- | --- |
 * | `a` | ✅ | ✅ | ✅ | 无额外约束 |
 * | `b` | ✅ | ❌ | ✅ | 结果靠 sentinel 补 |
 * | `c` | ❌ | ❌ | ❌ | 「sentinel only」+「可能等待输入」|
 */
export type AdmissionTier = 'a' | 'b' | 'c';

/**
 * 一名成员**此刻**的运行态（`view.rs::LiveSession`）。
 *
 * 由后端向 `live_sessions` 注册表查一次得到，**不落库** —— 所以它不可能是「陈旧的句柄」：
 * 没有进程就是 `live: false`，而不是一个点下去会失败的 id。
 */
export interface MemberSessionView {
  /** 此刻真的有进程。 */
  live: boolean;
  /** 活着的 PTY 会话 id（`live === false` 时恒为 `null`）。 */
  terminalId: string | null;
}

/**
 * 花名册一行：**身份 + 状态 + 它能被打开的那个终端** —— 不含任何正文。
 *
 * 五个附加字段回答面板的三件事（`view.rs::MemberStatusView`）：「这是谁」
 * （`agentId` / `tier`）、「它在哪干活」（`workspace`）、「我怎么看它」
 * （`session` / `channel`）、「它还能不能被叫起来」（`sealed`）。缺了 `session`，
 * 成员进程虽然在跑、用户却只能看见队长 —— 那正是「看着一队 agent 干活」的反面。
 */
export interface MemberStatusView {
  memberId: string;
  name: string;
  role: MemberRole;
  state: MemberState;
  /** 取证水位线（见 [`DoneVerification`]）。 */
  verification: DoneVerification;
  /** 在飞任务的租约剩余秒：`null` = 无在飞任务；`0` = 已超时（尚未回收）。 */
  leaseRemainingSecs: number | null;
  /** 它跑的是哪个 CLI（`AgentConfig.id`）—— 花名册上的第一枚 chip。 */
  agentId: string;
  /**
   * 它**此刻**的运行态（活会话 + 会话 id）。**这是「打开成员终端」的唯一凭据。**
   *
   * 与 `sealed` 正交：`session.live` 回答「现在有没有进程」，`sealed` 回答「用户关掉过没有」。
   * 收尾窗口里两者会短暂同时为真（用户点了关闭，进程还没退干净），那不是矛盾。
   *
   * 成员是 Neeko 起的 PTY，会话 id 只在团队域里，前端推不出来（红线 12）。
   * `live === false` 时按钮必须置灰并写出理由，不能点下去再报错。
   */
  session: MemberSessionView;
  /** 用户封存过这个成员（落库的用户意图，跨重启有效）。 */
  sealed: boolean;
  /**
   * 这个成员**还回不回来**：有原生会话 id，且它的 CLI 有原生续接形态。
   *
   * **后端派生的事实**（`view.rs::MemberStatusView::resumable`），不是前端能算出来的：
   * 「哪个 CLI 支持哪种续接语法」住在会话域的适配器表里，前端没有也不该有那张表。
   *
   * 三条容易读错的地方：
   *
   * 1. **它不是 `!live`**。进程活着的时候它照样可能是 `true` —— 两个事实回答两个问题
   *    （「现在能不能接管」vs「进程没了还接不接得回来」）。
   * 2. **它与 `sealed` 正交**。`sealed` 是用户意图（关掉过没有），`resumable` 是能力；
   *    封存的成员照样有原生 id、照样可看历史，但**不许**被恢复（恢复等于撤销用户的决定，
   *    后端也会拒绝）。
   * 3. `true` ⇒ [`MemberStatusView.agentSessionId`] 非空（有 id 才谈得上续接）；反过来不成立：
   *    有 id 但 CLI 没有续接形态（qoder / gemini）是 `false`，那时只能看记录。
   *
   * 判据的**唯一**落点是 `utils/memberTerminal.ts::openTerminalAction` —— 组件不得自己
   * 拿 `resumable && !live` 重算一遍（那会造出第二个判据点）。
   */
  resumable: boolean;
  /** 它在哪个工作区干活（共享团队根 / 独立 worktree / 只读）。 */
  workspace: Workspace;
  /**
   * CLI 的**原生会话 id**（`conversation` 域拼 `agentId:nativeId` 用）。
   *
   * 与 `session.terminalId` 是两件事：后者是**活的 PTY**（进程一没就不是活会话），
   * `agentSessionId` 是磁盘上的**会话记录**（进程没了仍在）—— 「已退出」的成员
   * 因此仍能打开历史 transcript，`team_resume` 也靠它把对话接上。
   *
   * `null` = 这个成员还没上报过任何 hook 事件（它是唯一的登记口）。
   */
  agentSessionId: string | null;
  /**
   * 人设名（spawn 时刻从角色库快照到成员行上的；`null` = 无人设）。
   *
   * 只有名字：正文已经进了那个成员的启动 argv，前端不需要也不该再读它。
   */
  persona: string | null;
  /** 怎么给它发消息（CLI 成员恒为 `pty`）。 */
  channel: WorkerChannel;
  /** 准入档位（`c` 档必须带可见的「sentinel only」警告）。 */
  tier: AdmissionTier;
}

/**
 * 角色库里的一条预设（`types.rs::RolePreset`，`team_role` 表；v19）。
 *
 * `approvalPolicy` / `defaultWorkspace` 是 spawn 时刻的**缺省覆盖**（显式参数 >
 * persona > 团队缺省）；`cliPreference` 只是建议，不是判据 —— 准入判据只在后端
 * 准入表里。persona 与授权（`MemberRole` 的 lead/worker）严格无关。
 */
export interface RolePreset {
  /** 角色名（主键；`team_spawn` 传这个名字，成员行快照这个名字）。 */
  name: string;
  /** 人设正文（进成员启动参数的英文文本）。 */
  preamble: string;
  /** 建议用哪个 CLI 当这个角色；`null` = 不建议。 */
  cliPreference: string | null;
  /** spawn 时未显式传审批策略时的覆盖；`null` = 落回团队缺省。 */
  approvalPolicy: ApprovalPolicy | null;
  /** spawn 时未显式传工作区时的覆盖；`null` = 落回团队缺省。 */
  defaultWorkspace: Workspace | null;
  /** 创建时间（epoch 毫秒；排序用）。 */
  createdAt: number;
}

/**
 * 角色库列表（`view.rs::RoleList`，`team_role_list` 的载荷）。
 *
 * 行数有界（`MAX_LISTED_ROLES`）：单行有界不等于载荷有界 —— 角色库只增不减，与
 * `TeamList` 同一条红线 4 纪律。`truncated` 必须被 UI 说出来（否则看起来像「就只有这些」）。
 */
export interface RoleList {
  roles: RolePreset[];
  /** 是否还有更多预设没被列出。 */
  truncated: boolean;
}

/**
 * 任务板上的一行 —— **没有 `body`**（红线 4：派活正文长度无上限，列载荷里不可能出现）。
 *
 * `summary` 是另一件事：后端落库时已硬截到 4 KiB，并置 `summaryTruncated`。
 */
export interface TaskCard {
  /**
   * 任务 id —— **只在 [`teamId`] 之内唯一**（每个队的板都从 `t1` 开始编号）。
   *
   * 两列必须一起用：详情请求是 `team_task_detail(teamId, taskId)`，只传 id 无法表达
   * 「点的是哪个队的 t1」。
   */
  id: string;
  /**
   * 所属团队（后端 `view.rs::TaskCard::team_id`）。
   *
   * 存在的唯一理由是**让面板不必猜父级**：卡片是详情请求的两个参数的唯一来源，
   * 缺了它调用点要么去取当前团队的 id（换队/多队并列时就错），要么从别处拼（红线 12）。
   */
  teamId: string;
  title: string;
  state: TeamTaskState;
  /** 持有者 member id。 */
  owner: string | null;
  /**
   * 被指派的成员 id（**计划事实**：谁该做；`owner` 是执行事实：谁在做）。
   *
   * `null` = 未指派（包括后端 v24 之前建的老行，以及老后端根本不发这个字段的
   * `undefined` —— 消费侧用 `?? owner` 兼容两种）。指派**不改**状态：`state` 仍是
   * `pending`、`owner` 仍为空。
   */
  assignee: string | null;
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

/**
 * 任务详情（`team_task_detail`，**点开才拉**）：列视图 + 派活正文（线上是平铺的）。
 *
 * 字段名以 `view.rs::TaskDetail` 的 serde 输出为唯一真相（`rename_all = "camelCase"`）：
 * 步骤轨迹叫 `events` / `eventsTruncated` —— 与 [`MemberDetail`] 同名字段是**同一个类型**
 * （`MemberEventView`），两个载荷不该给同一样东西取两个名字。曾经这里叫 `steps`，
 * 与后端不一致，于是用户点开任务时 `detail.steps.length` 直接抛 TypeError。
 */
export interface TaskDetail extends TaskCard {
  /** 派活正文（长度无上限 —— 这就是它不在列路径里的原因）。 */
  body: string;
  /**
   * 这个任务的**步骤轨迹**（subject = 任务 id 的审计行，最新在前）。
   *
   * 「开工文档」(`body`) 与「完成回报」(`summary`) 并存、互不覆盖；中间发生了什么
   * 看 events。上界 50（`MAX_TASK_EVENTS`），`eventsTruncated` = 还有更早的。
   */
  events: MemberEventView[];
  /** 还有更早的步骤没取回。 */
  eventsTruncated: boolean;
}

/**
 * 任务行本体 —— `team_task_retry` 的返回值（与 Rust `types::TeamTask` 的 serde 输出
 * 逐字一致，`rename_all = "camelCase"`）。
 *
 * 与 [`TaskDetail`] 的差别是**没有步骤轨迹**：重试只改状态与执行事实，面板刷新靠
 * 快照脉冲（`refresh`），不靠这个回包携带历史 —— 所以这里不发明第二个事件载荷。
 */
export interface TeamTask extends TaskCard {
  /** 派活正文（回包里带着；面板不渲染它 —— 详情仍走 `team_task_detail`，红线 4）。 */
  body: string;
}

/**
 * 一条审计记录的**成员详情视图**（真相源 `view.rs::MemberEventView`）。
 *
 * `kind` 是**开集字符串**（后端：新增事件类别不该要求一次迁移，也不要求一次 TS 改动）：
 * 未知类别必须原样显示，不得当成空字符串或丢行。
 */
export interface MemberEventView {
  /** 发生时间（epoch 毫秒）。 */
  at: number;
  /** 事件类别（`claim` / `update` / `signal` / `close_member` …）。 */
  kind: string;
  /** 触发者：成员 id 或 `system` / 队长 id。 */
  actor: string;
  /** 被操作对象（任务 id / 成员 id）。 */
  subject: string | null;
  /** 附加上下文（后端写的短文本）。 */
  detail: string | null;
}

/**
 * 成员详情（`team_member_detail`，**点开一个成员才拉**）。
 *
 * # 为什么它不在 `TeamSnapshot` 里
 *
 * 花名册每行是恒定小字段，而这里带任务行 + 最多 50 条事件：放进快照就是「每次脉冲刷新
 * 都搬一遍全部成员的全部事件」（红线 4 的时间维度）。抽屉关掉就不再有任何读请求。
 *
 * `awaitingApproval` 是 `tasks` 的**子集**（AC5 待批队列）：两字段由同一遍过滤产出，
 * 前端不得自己从 `tasks` 里筛 —— 那会在「当前任务」块被折叠/截断时让待批块静默消失。
 */
export interface MemberDetail {
  /** 花名册的**同一行**（后端复用同一个构造点，不是第二份推导）。 */
  member: MemberStatusView;
  /** 该成员在飞的任务 + 它最近完成的（至多 `MAX_BOARD_TASKS` = 200 行）。 */
  tasks: TaskCard[];
  /** `tasks` 是否被截断（抽屉据此说「只显示前 N 条」）。 */
  tasksTruncated: boolean;
  /** AC5 待批队列（`tasks` 里 `state === 'awaiting_approval'` 的那几行）。 */
  awaitingApproval: TaskCard[];
  /** 最近 `MAX_MEMBER_EVENTS` = 50 条审计（**最新在前**）。 */
  events: MemberEventView[];
  /** 是否还有更早的事件没被列出。 */
  eventsTruncated: boolean;
}

/** 面板快照（`team_snapshot`）—— 面板渲染的**唯一**数据源。 */
export interface TeamSnapshot {
  team: Team;
  /**
   * 成员数（**后端口径**：不含队长、含已退出的成员）。
   *
   * 与 `TeamSummary.memberCount` / `TeamStatusView.memberCount` **同一个访问器**
   * （`TeamManager::member_count`）：同一个队只有这一个成员数。曾经面板头数
   * `members.length`（含队长）、列表行用这个字段，于是列表写 3、点进去写 4。
   */
  memberCount: number;
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

/**
 * 团队列表的一条（`team_list` 的载荷，真相源 `view.rs::TeamSummary`）。
 *
 * # 为什么它**不是** [`Team`] 的裁剪版
 *
 * 这是**选队**用的行，不是「某一个队的视图」：它只有「够不够让我决定点开」的信息。
 * 花名册与任务行不在这里（要看内容用 `teamId` 去拉 `team_snapshot`）—— 那正是红线 4 的
 * 结构性落点：app 重启会把历史团队全部 hydrate 回来，列表每多一列就是给「重开自己的队」
 * 这件事多传一份用不上的数据。
 */
export interface TeamSummary {
  /** 团队 id（下一步的入口参数）。 */
  teamId: string;
  /** 用户可读名字。 */
  name: string;
  /** 团队状态：`open` 可派活可恢复 / `closing` 关到一半 / `sealed` 只读快照。 */
  state: TeamState;
  /** 团队根（后端**已规范化**的绝对路径）。 */
  projectPath: string;
  /** 队长用哪个 CLI。 */
  leadAgentId: string;
  /** 建队时间（epoch 毫秒）。 */
  createdAt: number;
  /** 用户封存时刻；`null` = 未封存（可恢复）。 */
  sealedAt: number | null;
  /**
   * 成员数（**不含队长、含已 `offline` 的成员**）。
   *
   * 与 `team_options` 的「还能加几个」同源：已关闭的成员仍占名额，所以这里刻意**不**改成
   * 「只数活着的」—— 那样同一个队会有两个成员数，而偏差只在「刚好卡在上限」时显形。
   */
  memberCount: number;
  /** 板上任务总数。 */
  taskTotal: number;
  /** 未终结的任务数（`pending`/`claimed`/`in_progress`/`awaiting_approval`/`proposed`）。 */
  taskOpen: number;
  /** 已完成的任务数。 */
  taskDone: number;
}

/**
 * 寻址**一个团队**所需的最小事实：id + 显示名。
 *
 * # 为什么这是一个具名类型，而不是各处写 `Pick<TeamSummary, 'teamId' | 'name'>`
 *
 * 「对一个队做一件事」（关闭 / 删除 / 二次确认）需要的正是这两样：id 用于寻址，名字**只**
 * 用于提示文案。这个形状被 5 个组件的 props 与 2 个纯函数的生产者共用，写 7 遍
 * `Pick<TeamSummary, …>` 的地方一旦有人加一个字段（比如带上 `state` 好让文案更准），
 * 就会只有一半的调用点跟着变 —— 而 TypeScript 不会报错（宽的结构可以赋给窄的）。
 *
 * 叫 `TeamRef` 而不是「关闭意图」那类名字：它描述的是**指代关系**，不是某一次动作。
 * 关闭与删除共用同一个指代；让类型名绑在某一个动作上，第二动作出现时就得改名或者造别名。
 */
export type TeamRef = Pick<TeamSummary, 'teamId' | 'name'>;

/**
 * 团队列表（`team_list` 的载荷，真相源 `view.rs::TeamList`）。
 *
 * `createdAt` 倒序（同毫秒按 id 升序 —— 排序在后端，前端**不重排**：面板每次重取都换一个
 * 顺序会让「上次那一行」找不回来）。
 */
export interface TeamList {
  /** 最近的团队（至多 `view::MAX_LISTED_TEAMS` = 50 行）。 */
  teams: TeamSummary[];
  /** 是否还有更早的团队没被列出（面板据此显示「只显示最近 50 个团队」）。 */
  truncated: boolean;
}

/**
 * `team_close` 的返回（真相源 `commands.rs::ClosedReply`）—— **扁平**，不背 MCP 的工具信封。
 *
 * # 失败面不在这个形状里
 *
 * 有成员关不掉时后端**整次调用以 `Err` 结束**（错误文本已逐个点名），团队停在 `closing`。
 * 所以成功路径上 [`ClosedReply.membersFailed`] 恒为空 —— 它保留在类型里是因为 MCP 侧的
 * `ToolReply::Closed` 有这一列，两面同一个形状便于排查，不是因为面板要读它。
 */
export interface ClosedReply {
  /** 被关闭的团队。 */
  teamId: string;
  /** 单成员关闭的目标；整队关闭为 `null`。 */
  memberId: string | null;
  /** **本次真的关掉的**成员。 */
  membersClosed: string[];
  /**
   * 关不掉的成员与原因。成功路径恒空（见上面的模块注释）。
   *
   * Rust 侧是 `Vec<(String, String)>` ⇒ JSON 是**二元数组** `[[memberId, reason], ...]`，
   * 不是 `{ memberId, reason }` 对象。写成对象就是前端凭空造了一个后端不存在的形状。
   */
  membersFailed: [string, string][];
  /** 执行后的真实团队状态（整队成功 = `closed`；有成员关不掉 = `closing`）。 */
  teamState: TeamState;
  /**
   * 诚实面（后端原文，英文）：`graceful` 未兑现、队长自身 PTY 不由本次关闭、
   * worktree 一律保留。**面板的确认文案必须与这里同口径** —— 前端不许自造承诺。
   */
  notes: string[];
}

/**
 * 一个成员只能「新开」的两个理由（`resume.rs::ColdReason`，wire 上是 `snake_case`）。
 *
 * 两个理由**各自的修法不同**，所以不许合并成一个「不能恢复」：
 *
 * | 值 | 含义 | 用户能做什么 |
 * | --- | --- | --- |
 * | `no_native_session` | 成员行上没有原生会话 id（从未跑出一个回合）| 只能新开一个会话 |
 * | `unsupported_cli` | 有 id，但该 CLI 没有续接语法（qoder / gemini）| 只能新开，或换一个 CLI |
 */
export type ColdReason = 'no_native_session' | 'unsupported_cli';

/** 一个「只能新开」的成员（`resume.rs::ColdMember`）。 */
export interface ColdMember {
  memberId: string;
  /** 为什么回不来（见 [`ColdReason`]）。 */
  reason: ColdReason;
}

/** 一个起不来的成员（`resume.rs::MemberFailure`）—— 逐成员失败**不吞**。 */
export interface MemberFailure {
  memberId: string;
  /** 后端原文（已带 `memberId` 的可读文本），面板不加工。 */
  error: string;
}

/**
 * `team_resume` 的返回（真相源 `resume.rs::TeamResumeReport`）—— 一次恢复的**完整账目**。
 *
 * # 四个桶互斥且不遗漏
 *
 * 每个候选成员恰好落进一个桶：真的起了新进程（[`resumed`]）、本来就有活进程因此跳过
 * （[`skippedAlreadyLive`]，幂等的证据）、只能新开（[`cold`]）、起不来（[`failed`]）。
 *
 * **四个桶都要能被说出来**，尤其 `cold`：静默地少恢复一个成员与「恢复了 0 个」在界面上
 * 长得一模一样，而那正是这次要消灭的缺陷类型（`utils/resumeReport` 把理由变成可见文案）。
 *
 * # `cold` 不是错误
 *
 * 「没有原生 id」是**这个成员的现状**（它还没说过话），不是一次失败：后端刻意**不**给它
 * 起一个裸 CLI（那会让用户以为对话续上了，其实是一个空会话）。
 */
export interface TeamResumeReport {
  /** 被恢复的团队。 */
  teamId: string;
  /** 真的起了新进程的成员（后端按 id 排序）。 */
  resumed: string[];
  /** 本来就有活进程、没动的成员（同一队再点一次恢复就是这种结果）。 */
  skippedAlreadyLive: string[];
  /** 只能新开的成员（理由见 [`ColdReason`]）。 */
  cold: ColdMember[];
  /** 起不来的成员与原因。 */
  failed: MemberFailure[];
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
  /**
   * 队长的 agent（`AgentConfig.id`）。
   *
   * **随建队响应一起回**（不从快照里找）：队长 tab 的图标不能依赖「快照先落地」这个
   * 时序 —— 否则第一帧永远是通用终端图标。
   */
  leadAgentId: string;
}
