import React from 'react';

import { cn } from '@/lib/utils';

import type { MemberChipTone } from '../utils/memberChips';

/**
 * 一枚 chip（花名册与任务卡片共用的小标签）。
 *
 * 四个语义色只走项目 token（`bg-bg-tertiary` / `text-accent-yellow` 一类）—— 硬编码色值在
 * 亮色主题下不跟随切换，样式 token 护栏会拦。
 *
 * `warn` 是**描边**而不是实底：C 档「sentinel only」这类警告靠「与其它 chip 不同形」才在
 * 灰度与色觉障碍下仍然可辨（同 `MemberStateBadge` 的 `unverified` 口径）。
 */
const TONE_CLASS: Record<MemberChipTone, string> = {
  default: 'bg-bg-tertiary text-text-secondary',
  outline: 'border border-border text-text-muted',
  accent: 'bg-bg-tertiary text-accent-blue',
  warn: 'border border-accent-yellow text-accent-yellow',
};

interface ChipProps {
  tone: MemberChipTone;
  /** 完整理由（视觉文案太短）。 */
  title?: string;
  children: React.ReactNode;
}

const Chip: React.FC<ChipProps> = React.memo(({ tone, title, children }) => (
  <span
    title={title}
    className={cn(
      'inline-flex shrink-0 items-center rounded px-1 py-0.5 text-micro whitespace-nowrap',
      TONE_CLASS[tone],
    )}
  >
    {children}
  </span>
));
Chip.displayName = 'Chip';

export default Chip;
