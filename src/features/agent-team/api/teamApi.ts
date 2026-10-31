import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import { AGENT_TEAM_EVENT } from '@/shared/events';
import type {
  LaunchableAgent,
  TaskDetail,
  TeamPulse,
  TeamSession,
  TeamSnapshot,
} from '@/shared/types/team';

/**
 * Agent Team 域的 Tauri 命令 wrapper。
 *
 * 四条命令的**真相源**是 `src-tauri/src/agent/team/commands.rs`（入参名、返回形状）；
 * 两条读命令的区别是红线 4 的结构性落点：
 *
 * | wrapper | 命令 | 载荷 |
 * | --- | --- | --- |
 * | [`fetchLaunchableAgents`] | `team_launchable_agents` | 每个 CLI 一条 `{ agentId, refusal }`（面板置灰依据）|
 * | [`fetchTeamSnapshot`] | `team_snapshot` | 团队 + 花名册 + 任务板列（**无 task body**）|
 * | [`fetchTaskDetail`] | `team_task_detail` | 列视图 + 派活正文（**点开才拉**）|
 *
 * 这两条**不许合并成一条**：「顺手把 body 一起拉回来」会让每次脉冲刷新都搬一遍全部派活正文，
 * 而脉冲是高频的（一个动作可能连发多条）。
 */

/** `start_team_session` 的入参。 */
export interface StartTeamSessionParams {
  /** 队长用哪个 CLI（后端会在写库前做准入校验，起不来即拒绝）。 */
  agentId: string;
  /** 团队根：**必须是既有派生点给出的工作区根**，不要自己拼。 */
  projectPath: string;
  /** 团队显示名；`null` / 省略 = 后端取项目目录名。 */
  name?: string | null;
}

/** 以队长身份开一个会话（建队 + 起队长 PTY）。失败时拒绝原因是 `AppError` 的可读字符串。 */
export function startTeamSession(params: StartTeamSessionParams): Promise<TeamSession> {
  return invoke<TeamSession>('start_team_session', {
    agentId: params.agentId,
    projectPath: params.projectPath,
    name: params.name ?? null,
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
export function fetchLaunchableAgents(): Promise<LaunchableAgent[]> {
  return invoke<LaunchableAgent[]>('team_launchable_agents');
}

/** 拉一次团队快照（面板的唯一数据源；无 task body）。 */
export function fetchTeamSnapshot(teamId: string): Promise<TeamSnapshot> {
  return invoke<TeamSnapshot>('team_snapshot', { teamId });
}

/** 拉单个任务的详情（含正文）。**只在用户点开卡片时调用**。 */
export function fetchTaskDetail(taskId: string): Promise<TaskDetail> {
  return invoke<TaskDetail>('team_task_detail', { taskId });
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
