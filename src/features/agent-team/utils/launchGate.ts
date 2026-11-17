import type { LaunchableAgent } from '@/shared/types/team';

/**
 * 队长入口的**提交判定**（唯一产出点）：能不能开团队 / 不能开时那句话是什么。
 *
 * # 为什么单独成纯函数
 *
 * 面板里有四件**互相独立**的否决来源，任何一件单独成立都让主按钮失效：
 *
 * | 否决来源 | 为什么它单独成立就够 |
 * | --- | --- |
 * | 没有激活项目 | 团队的执行环境是**项目**的（v16 起按 `projectId` 查表），没有项目就没有环境 |
 * | 没有工作区根 | 团队根是成员的 cwd 与 `starts_with` 判据的来源（红线 8）|
 * | 没有可启动的 CLI | 清单里每一行都被拒 ⇒ 没有能当队长的候选 |
 * | 配置草稿不可提交 | 成员池空 / 上限越界 / 缺省值未到 —— 后端都会拒绝 |
 *
 * 混在 JSX 里的后果是这四条会**互相遮蔽**：一处 `&&` 少了，按钮在一个必然失败的状态下仍是
 * 蓝色的，而用户点下去才在后端吃到拒绝（prd R0.4 的反面）。抽出来之后每一条都能被直测，
 * 也顺手把「灰按钮为什么灰」收敛成一个返回值（见 [`launchGate`] 的 `blockedReason`）。
 *
 * # 项目 id 与团队根是**两个**入参
 *
 * `hasActiveProject` 与 `hasWorkspaceRoot` 不能合并：路径可以是落在项目目录**之外**的工作树
 * （`~/.neeko/worktrees/<name>`），所以「有根」不代表「有项目」。后者才是执行环境的归属。
 */

export interface LaunchGateInput {
  /** 有激活项目（`useProjectStore` 的 `activeProjectId !== null`）。 */
  hasActiveProject: boolean;
  /** 有激活单元的工作区根（`useActiveWorkspaceRoot` 的结果非 `null`）。 */
  hasWorkspaceRoot: boolean;
  /** `team_launchable_agents` 的清单；`null` = 还没拿到。 */
  launchable: LaunchableAgent[] | null;
  /** 当前选中的 agent id。 */
  agentId: string | null;
  /** 配置草稿是否可提交（`useTeamConfigDraft` 的 `valid`）。 */
  draftValid: boolean;
  /** 正在提交（重入防护）。 */
  busy: boolean;
}

export interface LaunchGate {
  /** 现在**可启动**的 agent id（顺序即后端给的行序 —— 后端已排序，这里不再排）。 */
  startableIds: string[];
  /** 主按钮可点。 */
  canStart: boolean;
  /**
   * 主按钮不可用时的**可见理由**（`null` = 不需要解释）。
   *
   * 必须是可见文字而不是 `title`：禁用的按钮不可聚焦，触屏也没有悬停。
   */
  blockedReason: string | null;
}

/** 行内「能不能起」的收敛点：**只有** `refusal === null` 才算能起。 */
export function isLaunchable(row: LaunchableAgent): boolean {
  return row.refusal === null;
}

/** 可启动的 agent id。 */
export function startableAgentIds(rows: LaunchableAgent[] | null): string[] {
  if (rows === null) return [];
  return rows.filter(isLaunchable).map((row) => row.agentId);
}

/**
 * 选择收敛：已选且**仍可启动**就保持，否则落到第一个可启动的（一个都没有 = `null`）。
 *
 * # 为什么是纯函数 + 渲染期派生，而不是 `useEffect` 里 `setAgentId`
 *
 * 用 effect 收敛会多出一帧：那一帧里 `agentId` 还是旧值（或 `null`），主按钮因此显示为
 * 「不可启动」，而用户看到的是一个假的灰按钮 —— 面板刚打开、清单刚到的那一帧正好是它的
 * 第一印象。派生版的渲染结果只由（用户上次的选择，当前可启动清单）决定，没有中间态。
 *
 * 判据与 `canStart` 里的 `startableIds.includes(agentId)` **同源**（都调
 * [`startableAgentIds`]）：清单刷新后某个 CLI 变成被拒时，这里和那里会同时放手。
 */
export function convergeAgentId(
  selected: string | null,
  startableIds: readonly string[],
): string | null {
  if (selected !== null && startableIds.includes(selected)) return selected;
  return startableIds[0] ?? null;
}

/**
 * 判定是否可以开团队，以及不能开时的理由。
 *
 * 理由的**优先级**即调用方的读序：项目 → 工作区根 → 清单 → 候选。加载中 / 空清单两种状态
 * 已经在选择器上方说过，这里不重复（同一句话出现两次会让人以为遇到两个不同故障）。
 */
export function launchGate(input: LaunchGateInput): LaunchGate {
  const startableIds = startableAgentIds(input.launchable);

  // 只判 `agentId !== null` 会在「清单刷新后这个 CLI 变成被拒」的那一帧留下一个可点但必然
  // 被拒绝的按钮 ⇒ 判据是 `startableIds.includes(agentId)`。
  const canStart =
    input.hasActiveProject &&
    input.agentId !== null &&
    startableIds.includes(input.agentId) &&
    input.hasWorkspaceRoot &&
    input.draftValid &&
    !input.busy;

  return { startableIds, canStart, blockedReason: blockedReasonOf(input, startableIds) };
}

function blockedReasonOf(input: LaunchGateInput, startableIds: string[]): string | null {
  if (!input.hasActiveProject) {
    // 项目是执行环境的归属：没有它，后端会在**写库之前**拒绝（v16）。
    return 'No active project (select one first): a team runs inside a project — without one no team can start.';
  }
  if (!input.hasWorkspaceRoot) {
    // 这句话说的是**真正缺的东西**：项目已经有了（上一条已挡掉没有项目的情形），
    // 缺的是「这个项目当前单元的工作区根」—— 团队根的来源。
    // 两条 blocked 理由必须互不相同：复制粘贴成同一句时，用户看到「没有活动项目」
    // 而事实上项目就在那里，于是他去改一个已经满足的条件（见 `launchGate.test.ts`）。
    return "The current project has no usable workspace root (switch to a loaded workspace / unit): the team root is the members' cwd — without it no team can start.";
  }
  if (input.launchable === null || input.launchable.length === 0) return null;
  if (startableIds.length === 0) {
    return 'None of the listed CLIs can launch right now (see the reason on each row above), so a team cannot start yet.';
  }
  return null;
}
