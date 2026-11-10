import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import { AGENT_TEAM_EVENT } from '@/shared/events';
import type {
  ClosedReply,
  LaunchableAgent,
  MemberDetail,
  RoleList,
  RolePreset,
  TaskDetail,
  TeamConfig,
  TeamList,
  TeamOptions,
  TeamPulse,
  TeamSession,
  TeamSnapshot,
} from '@/shared/types/team';

/**
 * Agent Team 域的 Tauri 命令 wrapper。
 *
 * 命令的**真相源**是 `src-tauri/src/agent/team/commands.rs`（入参名、返回形状）；
 * 两条读命令的区别是红线 4 的结构性落点：
 *
 * | wrapper | 命令 | 载荷 |
 * | --- | --- | --- |
 * | [`fetchTeamList`] | `team_list` | **这台机器上**的团队行（有界 + `truncated`；无花名册/任务行）|
 * | [`fetchLaunchableAgents`] | `team_launchable_agents` | 每个 CLI 一条 `{ agentId, refusal }`（面板置灰依据）|
 * | [`fetchTeamOptions`] | `team_options` | 这个队允许谁当成员 / 上限 / 三个缺省值 |
 * | [`fetchTeamSnapshot`] | `team_snapshot` | 团队 + 花名册 + 任务板列（**无 task body**）|
 * | [`fetchTaskDetail`] | `team_task_detail` | 列视图 + 派活正文（**点开才拉**）|
 * | [`fetchMemberDetail`] | `team_member_detail` | 成员行 + 它的任务 + 待批队列 + 最近 50 条事件（**点开才拉**）|
 * | [`closeTeam`] | `team_close` | 本次真关掉了谁 + 诚实面 `notes` |
 * | [`deleteTeam`] | `team_delete` | **无载荷**（只接受 `closed`；成功就是「行不在了」）|
 *
 * 两条快照不在同一条命令里：「顺手把 body 一起拉回来」会让每次脉冲刷新都搬一遍全部派活正文，
 * 而脉冲是高频的（一个动作可能连发多条）。
 *
 * `team_launchable_agents` 与 `team_options` 也**不许合并**：前者是「这台机器上谁能当成员」
 * （`admission.rs` 的准入事实），后者是「这个队允许谁 + 上限 + 缺省」（`team` 行经准入解析后
 * 的结果）。它们的失败方式不同（一个是改配置、一个是换 CLI），合并会把两件事压成一个字段。
 *
 * `team_list` 与 `team_snapshot` 同理**不许合并**：前者回答「这台机器上有哪些队」（每个都带
 * 一行的代价），后者回答「这一个队长什么样」（一次一个队）。把列表做成「每队一份快照」
 * 会让面板打开时搬 N 份花名册与任务板 —— 而用户只想看一眼能重开哪个队。
 */

/** `start_team_session` 的入参。 */
export interface StartTeamSessionParams {
  /**
   * 拥有这个团队**执行环境**的项目 id。
   *
   * **必须**是 `useProjectStore` 的 `activeProjectId`（用户选中的那个项目），
   * **不是**从路径猜出来的：环境归属是项目的事实，而 `projectPath` 可能是落在项目目录
   * 之外的工作树（`~/.neeko/worktrees/<name>`）。后端按 id 精确查表；未知 id 在写库前拒绝。
   */
  projectId: string;
  /** 队长用哪个 CLI（后端会在写库前做准入校验，起不来即拒绝）。 */
  agentId: string;
  /** 团队根：**必须是既有派生点给出的工作区根**，不要自己拼。 */
  projectPath: string;
  /** 团队显示名；`null` / 省略 = 后端取项目目录名。 */
  name?: string | null;
  /**
   * 团队组成配置；`null` / 省略 = 全默认。
   *
   * 只放**真的改过**的字段（见 `hooks/useTeamConfigDraft` 的投影）：把一个完整的
   * `TeamDefaults` 填进来，等于把后端的默认值抄成前端常量。
   */
  config?: TeamConfig | null;
}

/** 以队长身份开一个会话（建队 + 起队长 PTY）。失败时拒绝原因是 `AppError` 的可读字符串。 */
export function startTeamSession(params: StartTeamSessionParams): Promise<TeamSession> {
  return invoke<TeamSession>('start_team_session', {
    // 项目 id 与工作区根是**两个**入参：后者可以是项目目录之外的工作树。
    projectId: params.projectId,
    agentId: params.agentId,
    projectPath: params.projectPath,
    name: params.name ?? null,
    // 显式 `null`（不是省略键）：`Option<TeamConfig>` 的「没给」由后端一步判定，
    // 少一个键与 `null` 在 Tauri 的入参反序列化上不是同一件事。
    config: params.config ?? null,
  });
}

/**
 * 面板的**能力面**：每个可选 CLI 一条 `{ agentId, refusal }`。
 *
 * 真相源是 `src-tauri/src/agent/team/admission.rs` 的 `launchable_agents()`（准入表 ×
 * `launch_refusal`），与 `team_spawn` / `start_team_session` 的拒绝**同一份判据**。
 * 因此队长入口的候选**只能**来自这个返回值 —— 前端自己筛一遍（`enabled` + 有 `command`）
 * 就是第二套判据，后端判据一变，面板还在按老规则放行。
 */
export function fetchLaunchableAgents(role: 'lead' | 'worker'): Promise<LaunchableAgent[]> {
  return invoke<LaunchableAgent[]>('team_launchable_agents', { role });
}

/**
 * 团队配置面：这个队允许谁当成员 / 还能加几个 / 三个缺省值是什么。
 *
 * 两个出口同一个函数（后端也是同一个 `resolve`）：
 *
 * - `teamId` 省略 / `null` → **建队前**的目录（池子 = 全部可启动、缺省值 = 全局默认）；
 * - `teamId` 是某个团队 → 该队的实际配置。
 *
 * 面板的默认值**只能**来自这里。在前端写死「4 / shared / queue」是第二份默认值，而后端
 * 改默认值时前端不会红 —— 面板会安静地继续提交一套过时的缺省。
 *
 * 失败时不要用一份前端默认值兜底：不知道缺省值就不该建队（`TeamLaunchPanel` 会在这种情况下
 * 禁用主按钮）。
 */
export function fetchTeamOptions(teamId?: string | null): Promise<TeamOptions> {
  return invoke<TeamOptions>('team_options', { teamId: teamId ?? null });
}

/**
 * 这台机器上的团队清单（`team_list`）—— **重启后重开自己的队**的入口。
 *
 * 真相源是 `src-tauri/src/agent/team/view.rs::list_teams`（与 MCP 工具 `team_list` **同一个**
 * 推导）。载荷有界：至多 [`TeamList.teams`] 50 行 + `truncated`，理由与 `MAX_BOARD_TASKS`
 * 同一条红线 4 纪律 —— 历史团队只增不减，所以「列出所有队」必须有一个明确的截断点。
 *
 * 它只读 `TeamManager` 的内存镜像（app 启动时 hydrate），因此**不会**因为某个团队已经
 * 关掉而没有行：已关闭的队照样列出来（面板照 `state` 决定「能重开」还是「只读」）。
 */
export function fetchTeamList(projectId?: string | null): Promise<TeamList> {
  return invoke<TeamList>('team_list', { projectId: projectId ?? null });
}

/**
 * 关闭团队（**本机用户**的面板入口；与队长经 MCP 调 `team_close` 是同一条执行路径）。
 *
 * # 语义全部在后端（前端不要重新判断）
 *
 * - `memberId` 缺省 = **整队关闭**：`Active → Closing →`（全部成功）`Closed`；
 * - 有成员关不掉 ⇒ **整次调用 `Err`**，团队停在 `closing`，错误文本已逐个点名。
 *   所以调用方在失败时**不清任何本地状态**：能查询的 `closing` 比一个假装干净的界面诚实。
 * - 需要团队端点已启动（`team_surface`）；端点没起来时返回可读错误 —— 原样显示，不翻译。
 *
 * `graceful` **不传**：省略 ⇒ 后端取 `true`，而 `true` 在 `notes` 里已声明未兑现（PTY 没有
 * 可发的关机协议）。前端在这里传一个值只会制造「我们协商过关机」的错觉。
 */
export function closeTeam(teamId: string, memberId?: string | null): Promise<ClosedReply> {
  return invoke<ClosedReply>('team_close', { teamId, memberId: memberId ?? null });
}

/** 拉一次团队快照（面板的唯一数据源；无 task body）。 */
export function fetchTeamSnapshot(teamId: string): Promise<TeamSnapshot> {
  return invoke<TeamSnapshot>('team_snapshot', { teamId });
}

/**
 * **永久删除**一个已关闭的团队（`team_delete`）。
 *
 * # 与 `closeTeam` 的区别不是「另一个动作」，而是**不可逆**
 *
 * 关闭是可重试的：有成员关不掉时后端整次 `Err`，团队停在 `closing`，再调一次就是同一目标集
 * 重走一遍。删除把行连同成员 / 任务 / 审计一起抹掉，`team_list` 再也看不到它 —— 所以后端
 * **只接受 `closed`**，`active` / `closing` 一律 `Conflict`（错误文本点名状态与下一步）。
 *
 * 前端的判据因此也只有一条：**列表行按 `state === 'closed'` 决定要不要渲染这个入口**
 * （见 [`TeamListRow`](../../components/TeamListRow.tsx)）。不要在按钮点击处再判一次 ——
 * 两处一旦漂移，症状是「按钮能点但后端永远拒」。
 *
 * 返回 `()`：删除成功时已经没有可返回的事实了（行不存在就是成功本身）。
 */
export function deleteTeam(teamId: string): Promise<void> {
  return invoke<void>('team_delete', { teamId });
}

/**
 * 拉单个任务的详情（含正文）。**只在用户点开卡片时调用**。
 *
 * # 两个参数都必填
 *
 * 任务 id 是**队内**标识符（每个队的板都从 `t1` 开始），所以 `taskId` 单独一个不构成
 * 寻址。后端的 `team_task_detail(team_id, task_id)` 也把两者都声明成必填 —— 只传 id
 * 的那种调用在 TS 层就编不过，而不是等到运行时静默看到别队的正文。
 *
 * `teamId` 由卡片自己带着（`TaskCard.teamId`），调用点不需要知道「当前在哪个队」。
 */
export function fetchTaskDetail(teamId: string, taskId: string): Promise<TaskDetail> {
  return invoke<TaskDetail>('team_task_detail', { teamId, taskId });
}

/**
 * 拉单个**成员**的详情（花名册行 + 任务 + 待批队列 + 最近事件）。
 *
 * **只在用户点开一个成员时调用**（与 `fetchTaskDetail` 同一条原则）：花名册每行是恒定
 * 小字段，而这里带任务行与 50 条事件 —— 放进快照就是「每次脉冲刷新都搬一遍全部事件」。
 *
 * 三个上界全在后端（`view.rs::member_detail`）：`tasks` ≤ `MAX_BOARD_TASKS`、
 * `awaitingApproval` 是它的子集、`events` ≤ `MAX_MEMBER_EVENTS`（SQL 侧 `LIMIT`）。
 * 前端**不要**再截一刀：两个上界各自漂移时，抽屉会说出一个后端并没用过的数字。
 */
export function fetchMemberDetail(memberId: string): Promise<MemberDetail> {
  return invoke<MemberDetail>('team_member_detail', { memberId });
}

/**
 * 角色库（`team_role` 表；v19）：persona 预设的**全局**清单。
 *
 * 角色库不隶属任何团队，也不是团队状态 —— 它**不发脉冲**（脉冲只在团队的写路径上发），
 * 所以消费侧（[`../hooks/useTeamRoles.ts`]) 自己管理刷新：挂载拉一次、save/delete 成功后
 * 本地重取，不借脉冲。
 */
export function fetchTeamRoles(): Promise<RoleList> {
  return invoke<RoleList>('team_role_list');
}

/**
 * 保存（新增或**同名编辑**）一条预设。
 *
 * 校验（非空 / 长度 / 控制字符）在后端 `TeamManager::save_role`；persona 正文会进成员的
 * 启动 argv，所以超长是**拒绝**而不是截断。前端只做「别把一眼就非法的输入发出去」的
 * 预检（非空），判据不在这边。
 */
export function saveTeamRole(role: RolePreset): Promise<void> {
  return invoke<void>('team_role_save', { role });
}

/**
 * 删除一条预设；未知名字 → 后端 `NotFound`。
 *
 * 已 spawn 的成员**不受影响**：它们的人设是成员行上的快照（`MemberStatusView.persona`），
 * 不是这条库行的引用。
 */
export function deleteTeamRole(name: string): Promise<void> {
  return invoke<void>('team_role_delete', { name });
}

/**
 * 订阅团队变更脉冲。
 *
 * 事件名只能来自 `src/shared/events.ts` 的 [`AGENT_TEAM_EVENT`]（红线 5：双端同源，
 * 漂移由 `check_event_constants` 在 commit 门禁上判失败）。**禁止**在这里写事件字符串字面量。
 *
 * 载荷是**失效脉冲**（只有 `rev`）：它不描述「变了什么」，收到就重取快照 ——
 * 所以本函数的消费侧只做「要不要再拉一次」的判断（见 `store/teamStore.applyPulse`）。
 */
export function subscribeTeamPulse(handler: (rev: number) => void): Promise<UnlistenFn> {
  return listen<TeamPulse>(AGENT_TEAM_EVENT, (event) => {
    handler(event.payload.rev);
  });
}
