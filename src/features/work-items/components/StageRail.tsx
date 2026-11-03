import React, { useCallback } from 'react';

import { cn } from '@/lib/utils';

import type { StagePlan } from '../types';
import { stageNodes, type StageNodeStatus } from '../utils/stageRail';

/**
 * 阶段轨（design §11.5）：实心 = 当前 stage、空心可点 = 可直接流转、灰 = 需先经过中间阶段。
 *
 * # 三态来自 `stageNodes`，本组件**不判**可达性
 *
 * `reachable` 的判据与后端 `StagePlan::can_transition` 必须是同一条规则（相邻才可流转），
 * 而那条规则住在 [`../utils/stageRail.ts`](../utils/stageRail.ts) 并被单测钉住。这里若再写一个
 * 「隔一个也可点」的近似判断，症状是「UI 画成可点、后端拒绝」—— 两次判据分叉，用户看到的是
 * 一个点了没反应的圆。
 *
 * # 三种「画不出来」的情形都不猜位置
 *
 * | 情形 | 呈现 | 为什么不能猜 |
 * | --- | --- | --- |
 * | `plan === null`（还没拉到 / 后端没给）| 整块不渲染 | 画一条假的五列轨，用户会以为自己在 Backlog |
 * | 当前 stage 不在 `plan.stages` 里（后端改了阶段集）| 全部 `locked`，没有 `current` | 猜一个「最像的」位置等于谎报进度 |
 * | 当前 stage 就是唯一节点 | 只有它一个实心节点 | — |
 *
 * # 为什么 current / locked 也是 `button`
 *
 * 用 `<span>` 代替会让「一排节点」在键盘上只剩可流转那几个，读屏里也看不出「当前在哪」。
 * 所以三种都留在 tab 序外的同一种元素里（`disabled` 把 current / locked 排除在可交互面之外），
 * 状态则靠 `data-status` + `aria-current` 暴露给测试与读屏。
 */
const STATUS_CLASS: Record<StageNodeStatus, string> = {
  // current：实底（accent 底上的前景色必须走 `--text-on-accent`，见设计令牌文档判据 5）。
  current: 'bg-accent-blue text-text-on-accent',
  reachable: 'border border-border text-text-secondary hover:bg-bg-hover',
  locked: 'border border-transparent text-text-muted',
};

const DOT_CLASS: Record<StageNodeStatus, string> = {
  current: 'bg-text-on-accent',
  reachable: 'border border-current bg-transparent',
  locked: 'bg-border',
};

interface RailNodeProps {
  stage: string;
  status: StageNodeStatus;
  onMove: (stage: string) => void;
}

const RailNode: React.FC<RailNodeProps> = React.memo(({ stage, status, onMove }) => {
  const handleClick = useCallback(() => onMove(stage), [onMove, stage]);

  return (
    <button
      type="button"
      data-stage={stage}
      data-status={status}
      // 只有 current 带 `aria-current`：读屏据此说「当前步骤」，reachable 与 locked 都不是。
      aria-current={status === 'current' ? 'step' : undefined}
      // current / locked 不可点：`disabled` 同时挡住鼠标与键盘，且不触发 `onMove`。
      disabled={status !== 'reachable'}
      onClick={handleClick}
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-micro whitespace-nowrap',
        'transition-colors',
        STATUS_CLASS[status],
        'focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none',
        status === 'reachable' ? 'cursor-pointer' : 'cursor-default',
      )}
    >
      <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', DOT_CLASS[status])} />
      {stage}
    </button>
  );
});
RailNode.displayName = 'RailNode';

interface StageRailProps {
  /** `null` = 阶段轨还没拿到（后端没给或请求失败）——整块不渲染。 */
  plan: StagePlan | null;
  /** 当前 stage（来自工作项自身，可能不在 `plan.stages` 里）。 */
  current: string;
  /** 点中一个 `reachable` 节点：交给宿主去做 `transition`（本组件不发 IPC）。 */
  onMove: (stage: string) => void;
}

const StageRail: React.FC<StageRailProps> = React.memo(({ plan, current, onMove }) => {
  // 没有阶段轨就没有轨道可画（`stageNodes` 需要 plan）；不渲染任何「占位轨道」。
  if (plan === null) return null;

  const nodes = stageNodes(plan, current);

  return (
    <div
      role="group"
      aria-label="阶段轨道"
      className="flex flex-wrap items-center gap-1"
      data-current-stage={current}
    >
      {nodes.map((node) => (
        <RailNode key={node.stage} stage={node.stage} status={node.status} onMove={onMove} />
      ))}
    </div>
  );
});
StageRail.displayName = 'StageRail';

export default StageRail;
