/**
 * Stage Rail 的纯函数：把「当前 stage + 阶段序」压成 UI 要的三个状态。
 *
 * 为什么不是组件里的 `if`：`reachable` 的判据与后端 `StagePlan::can_transition`
 * 必须是**同一条规则**（相邻才可流转）。放在这里就能被单测钉住，也不会出现
 * 「后端拒绝、UI 却画成可点」这种两处判据分叉。
 *
 * `transitions` 由后端下发（不是前端自己从 stages 推），所以这里只查表 ——
 * 将来后端允许「跳级」时前端不需要改一行。
 */
import type { StagePlan } from '../types';

/** 一个 stage 节点的可交互状态。`locked` = 需要先经过中间阶段。 */
export type StageNodeStatus = 'current' | 'reachable' | 'locked';

export interface StageNode {
  stage: string;
  status: StageNodeStatus;
}

/** 目标 stage 在当前 plan 下能否直接流转过去（同一 stage 不算流转）。 */
export function canMove(plan: StagePlan, from: string, to: string): boolean {
  if (from === to) return false;
  return plan.transitions.some((t) => t.from === from && t.to === to);
}

/**
 * 画出整条 rail：`current` 命中当前 stage，`reachable` 命中可直接流转的目标，
 * 其余 `locked`。plan 里没有的当前 stage（例如后端改了阶段集）一律 `locked`，
 * 不猜一个「最像的」位置 —— 猜错会让用户以为自己在 Backlog 列里。
 */
export function stageNodes(plan: StagePlan, current: string): StageNode[] {
  return plan.stages.map((stage) => {
    if (stage === current) return { stage, status: 'current' as const };
    return {
      stage,
      status: canMove(plan, current, stage) ? ('reachable' as const) : ('locked' as const),
    };
  });
}
