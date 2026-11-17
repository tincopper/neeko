import React from 'react';

import { cn } from '@/lib/utils';
import type { TaskCard, TeamTaskState } from '@/shared/types/team';

import { TEXT_META_STYLE, TEXT_TITLE_STYLE, truncate } from '../utils/svgText';

/**
 * 分配图上的**任务节点**（一个 `<g>`：边框 + 标题 + 两行互不覆盖的事实）。
 *
 * # 为什么从 `TeamFlowGraph` 抽出来
 *
 * 节点是这张图里**唯一有交互契约**的元素（可点 → 打开任务详情），也是唯一需要
 * 「状态色 × 截断 × 两行副标题」同时正确的地方。抽取只迁移 JSX 与依赖，行为零漂移。
 *
 * # 第 2 轮：两行各自独立推导（本轮 #1 的根因）
 *
 * 第 1 轮把 `assignee`（计划事实：谁该做）和 `owner`（执行事实：谁在做）压成
 * `assignee ?? owner` 一行 —— 有人认领时 `owner` 被 `??` 吃掉，图上只看得到被指派者。
 * 现在两者各占一行：**名字绝不互相回落**（`assignee=A, owner=B` 时两行分别是 A / B），
 * 文案见 design §8 的四行表。两行的空值只是「这一列没有值」，不是另一列的名字。
 */
export const NODE_W = 132;
export const NODE_H = 52;

/** 节点标题的截断长度（超出加省略号，避免溢出节点框）。 */
const TASK_TITLE_MAX_CHARS = 12;

/** 状态 → 节点描边色（语义与任务板的列一致；封闭映射，新状态编不过）。 */
const STATE_STROKE: Record<TeamTaskState, string> = {
  pending: 'stroke-border',
  claimed: 'stroke-accent-blue',
  in_progress: 'stroke-accent-blue',
  awaiting_approval: 'stroke-accent-yellow',
  done: 'stroke-accent-green',
  failed: 'stroke-accent-red',
  blocked: 'stroke-accent-red',
  proposed: 'stroke-accent-blue',
};

/**
 * `memberId → 名字` 的**唯一截短点**（成员 id 形如 `name@team_id`）。
 * `null` / `undefined`（老后端不发这个字段）都表示「这一列没有值」。
 */
function shortId(memberId: string | null | undefined): string | null {
  if (!memberId) return null;
  return memberId.split('@')[0] ?? '';
}

/** 第一行：计划事实（谁该做）。名字只来自 `assignee`，绝不回落到 `owner`。 */
export function assignmentMeta(task: TaskCard): string {
  const name = shortId(task.assignee);
  if (name !== null) return `${task.id} · assigned to ${name}`;
  // 空指派槽：完全没人碰过写「未指派」；有人认领时写 `—`，强调「没有指定的人、
  // 但第二行有人在做」。只是空值文案的区分，名字依旧不跨列。
  return task.owner === null ? `${task.id} · unassigned` : `${task.id} · assigned —`;
}

/** 第二行：执行事实（谁在做）。名字只来自 `owner`，绝不回落到 `assignee`。 */
export function claimMeta(task: TaskCard): string {
  const name = shortId(task.owner);
  return name === null ? 'Unclaimed' : `Claimed by ${name}`;
}

interface FlowTaskNodeProps {
  task: TaskCard;
  /** 节点中心 x（viewBox 单位；父组件负责按层居中）。 */
  cx: number;
  /** 节点上边缘 y。 */
  y: number;
  /**
   * 打开任务详情。`undefined` = 宿主未注入导航 ⇒ **不宣称可点**
   * （不挂 role / tabIndex / cursor / aria-label）：承诺一个不存在的动作比没有按钮更糟。
   */
  onOpenTask?: (teamId: string, taskId: string, title: string) => void;
}

/** 一个任务节点（纯展示 + 可选的键盘/鼠标交互）。 */
const FlowTaskNode: React.FC<FlowTaskNodeProps> = React.memo(({ task, cx, y, onOpenTask }) => {
  const interactive =
    onOpenTask === undefined
      ? {}
      : {
          role: 'button',
          tabIndex: 0,
          'aria-label': `Open task ${task.id} details: ${task.title}`,
          onClick: () => onOpenTask(task.teamId, task.id, task.title),
          onKeyDown: (event: React.KeyboardEvent<SVGGElement>) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onOpenTask(task.teamId, task.id, task.title);
            }
          },
          className: 'cursor-pointer',
        };

  return (
    <g {...interactive}>
      <rect
        x={cx - NODE_W / 2}
        y={y}
        width={NODE_W}
        height={NODE_H}
        rx={7}
        className={cn('fill-bg-secondary', STATE_STROKE[task.state])}
        strokeWidth={1.2}
      />
      <text
        x={cx}
        y={y + 15}
        textAnchor="middle"
        className="fill-text-primary"
        style={TEXT_TITLE_STYLE}
      >
        {truncate(task.title, TASK_TITLE_MAX_CHARS)}
      </text>
      {/* 两行复用同一字号常量，靠类名区分来源（便于单测按行取确切文本）。 */}
      <text
        x={cx}
        y={y + 29}
        textAnchor="middle"
        className="fill-text-muted flow-meta-assignee"
        style={TEXT_META_STYLE}
      >
        {assignmentMeta(task)}
      </text>
      <text
        x={cx}
        y={y + 42}
        textAnchor="middle"
        className="fill-text-muted flow-meta-owner"
        style={TEXT_META_STYLE}
      >
        {claimMeta(task)}
      </text>
    </g>
  );
});
FlowTaskNode.displayName = 'FlowTaskNode';

export default FlowTaskNode;
