import React from 'react';

import { cn } from '@/lib/utils';
import type { TeamState } from '@/shared/types/team';

import { teamStateBadge, type TeamStateTone } from '../utils/teamList';

/**
 * 团队状态徽标（`active` / `closing` / `closed`）。
 *
 * # 三态不许合并
 *
 * `closing` 是**关到一半**：有成员关不掉，后端整次 `team_close` 以 `Err` 结束，团队停在
 * 这里可查询、可重试。把它并进 `active`（或并进 `closed`）都会让人对「成员进程还在不在」
 * 得出相反结论 —— 而那是这个徽标唯一要回答的问题。
 *
 * # 文案与颜色都来自唯一映射点
 *
 * [`teamStateBadge`](../utils/teamList.ts) 一处产出文案 / 语义色 / 可访问文本；本组件只把
 * tone 映射成 token class。语义色只走项目 token —— 硬编码色值在亮色主题下不跟随切换。
 *
 * `data-state` 是给测试与将来做筛选用稳定钩子：文案会随语言变，枚举值不会。
 */
const TONE_CLASS: Record<TeamStateTone, string> = {
  active: 'text-accent-blue bg-accent-blue/10',
  closing: 'text-accent-orange bg-accent-orange/10',
  closed: 'text-text-muted bg-bg-tertiary',
};

interface TeamStateBadgeProps {
  state: TeamState;
}

const TeamStateBadge: React.FC<TeamStateBadgeProps> = React.memo(({ state }) => {
  const badge = teamStateBadge(state);
  return (
    <span
      data-state={state}
      // 视觉文案太短，把「这意味着什么」放进 title + aria-label（读屏与悬停同一句）。
      title={badge.ariaLabel}
      aria-label={badge.ariaLabel}
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-micro font-semibold whitespace-nowrap',
        TONE_CLASS[badge.tone],
      )}
    >
      {badge.text}
    </span>
  );
});
TeamStateBadge.displayName = 'TeamStateBadge';

export default TeamStateBadge;
