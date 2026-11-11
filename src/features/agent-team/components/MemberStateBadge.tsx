import React from 'react';

import { cn } from '@/lib/utils';
import type { MemberStatusView } from '@/shared/types/team';

import { memberBadge, type MemberBadgeTone } from '../utils/memberBadge';

/**
 * 六态徽标（视觉契约见 `prototype-agent-team.html` 视图 ②）。
 *
 * 语义色只走项目 token（`text-accent-blue` / `bg-accent-blue/10` 一类）—— 硬编码色值在
 * 亮色主题下不跟随切换，样式 token 护栏会拦。
 *
 * `unverified` 刻意是**虚线边框 + 透明底**（与实底的 `idle` 不同形），而不只是换个颜色：
 * 色觉障碍用户与灰度截图里，形状是唯一还成立的区别。
 */
const TONE_CLASS: Record<MemberBadgeTone, string> = {
  running: 'text-accent-blue bg-accent-blue/10',
  idle: 'text-text-muted bg-bg-tertiary',
  awaiting: 'text-accent-yellow bg-accent-yellow/10',
  done: 'text-accent-green bg-accent-green/10',
  failed: 'text-accent-red bg-accent-red/10',
  dead: 'text-accent-red bg-accent-red/10',
  stalled: 'text-accent-orange bg-accent-orange/10',
  unverified: 'text-accent-yellow border border-dashed border-accent-yellow bg-transparent',
};

interface MemberStateBadgeProps {
  member: Pick<MemberStatusView, 'state' | 'verification'>;
}

const MemberStateBadge: React.FC<MemberStateBadgeProps> = React.memo(({ member }) => {
  const badge = memberBadge(member);
  return (
    <span
      // `data-tone` 是给测试与将来做筛选用的稳定钩子：文案会随语言变，tone 不会。
      data-tone={badge.tone}
      // 视觉文案太短，把「为什么」放进 title + aria-label（AC2 的判据落在两者上）。
      title={badge.ariaLabel}
      aria-label={badge.ariaLabel}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-micro font-semibold whitespace-nowrap',
        TONE_CLASS[badge.tone],
      )}
    >
      {badge.text}
    </span>
  );
});
MemberStateBadge.displayName = 'MemberStateBadge';

export default MemberStateBadge;
