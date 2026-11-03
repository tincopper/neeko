import React from 'react';

import { cn } from '@/lib/utils';

import type { WorkItemPriority } from '../types';

/**
 * 工作项的三种小标签（stage / 优先级 / 标签）：卡片、列表行、详情共用**同一份**实现。
 *
 * # 为什么不各自内联
 *
 * 同样的 `border border-border text-text-muted` 写在三处，漂移是静默的：卡片上 P0 是红的、
 * 列表行上还是灰的，没有任何测试会失败。语义色的 `Record` 也只能有一份 —— 新增优先级档位时
 * 缺一格要编译失败（`Record<WorkItemPriority, …>` 保证），三元链则会悄悄落到「默认灰」。
 *
 * 视觉层只走 token 类名：`text-accent-*` / `border-border` / `text-text-muted`。硬编码色值
 * 在亮色与 Claude 主题下不跟随切换，护栏 `check_ui_style_tokens` 会拦。
 */

/** 优先级的语义色：P0 最重（红），逐级降低，P3 与元数据同色。 */
const PRIORITY_CLASS: Record<WorkItemPriority, string> = {
  p0: 'border-accent-red text-accent-red',
  p1: 'border-accent-orange text-accent-orange',
  p2: 'border-accent-yellow text-accent-yellow',
  p3: 'border-border text-text-muted',
};

const PRIORITY_LABEL: Record<WorkItemPriority, string> = {
  p0: 'P0',
  p1: 'P1',
  p2: 'P2',
  p3: 'P3',
};

const CHIP_BASE = 'inline-flex shrink-0 items-center rounded px-1 py-0.5 text-micro';

interface StageChipProps {
  stage: string;
}

/** stage 是数据（后端下发），不是联合类型 —— 这里只渲染，不判断合法性。 */
export const StageChip: React.FC<StageChipProps> = React.memo(({ stage }) => (
  <span data-stage-chip={stage} className={cn(CHIP_BASE, 'bg-bg-tertiary text-text-secondary')}>
    {stage}
  </span>
));
StageChip.displayName = 'StageChip';

interface PriorityChipProps {
  /** `null` = 没设优先级（不是 P3，也不画一个「无」的 chip）。 */
  priority: WorkItemPriority | null;
}

export const PriorityChip: React.FC<PriorityChipProps> = React.memo(({ priority }) => {
  if (priority === null) return null;
  return (
    <span
      data-priority={priority}
      className={cn(CHIP_BASE, 'border font-semibold', PRIORITY_CLASS[priority])}
    >
      {PRIORITY_LABEL[priority]}
    </span>
  );
});
PriorityChip.displayName = 'PriorityChip';

interface LabelChipsProps {
  labels: string[];
}

/** 标签按原样渲染，**不截断**：标签是用户自己写的检索锚点，截断后就不认识了。 */
export const LabelChips: React.FC<LabelChipsProps> = React.memo(({ labels }) => {
  if (labels.length === 0) return null;
  return (
    <>
      {labels.map((label) => (
        <span
          key={label}
          data-label-chip={label}
          className={cn(CHIP_BASE, 'border border-border-subtle text-text-muted')}
        >
          {label}
        </span>
      ))}
    </>
  );
});
LabelChips.displayName = 'LabelChips';
