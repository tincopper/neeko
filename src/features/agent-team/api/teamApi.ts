import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import { AGENT_TEAM_EVENT } from '@/shared/events';
import type {
  LaunchableAgent,
  TaskDetail,
  TeamConfig,
  TeamOptions,
  TeamPulse,
  TeamSession,
  TeamSnapshot,
} from '@/shared/types/team';

/**
 * Agent Team 域的 Tauri 命令 wrapper。
 *
 * 五条命令的**真相源**是 `src-tauri/src/agent/team/commands.rs`（入参名、返回形状）；
 * 两条读命令的区别是红线 4 的结构性落点：
 *
 * | wrapper | 命令 | 载荷 |
 * | --- | --- | --- |
 * | [`fetchLaunchableAgents`] | `team_launchable_agents` | 每个 CLI 一条 `{ agentId, refusal }`（面板置灰依据）|
 * | [`fetchTeamOptions`] | `team_options` | 这个队允许谁当成员 / 上限 / 三个缺省值 |
 * | [`fetchTeamSnapshot`] | `team_snapshot` | 团队 + 花名册 + 任务板列（**无 task body**）|
 * | [`fetchTaskDetail`] | `team_task_detail` | 列视图 + 派活正文（**点开才拉**）|
 *
 * 两条快照不在同一条命令里：「顺手把 body 一起拉回来」会让每次脉冲刷新都搬一遍全部派活正文，
 * 而脉冲是高频的（一个动作可能连发多条）。
 *
 * `team_launchable_agents` 与 `team_options` 也**不许合并**：前者是「这台机器上谁能当成员」
 * （`admission.rs` 的准入事实），后者是「这个队允许谁 + 上限 + 缺省」（`team` 行经准入解析后
 * 的结果）。它们的失败方式不同（一个是改配置、一个是换 CLI），合并会把两件事压成一个字段。
 */

/** `start_team_session` 的入参。 */
export interface StartTeamSessionParams {
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
