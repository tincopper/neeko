import React from 'react';

import { cn } from '@/lib/utils';

export type HoverGroup = 'session' | 'proj' | 'plain';

/** 默认信息（时间 / 计数）在 hover 时淡出的命名组变体。 */
export const META_FADE_GROUP_CLASSES: Record<HoverGroup, string> = {
  session: 'group-hover/session:opacity-0',
  proj: 'group-hover/proj:opacity-0',
  plain: 'group-hover:opacity-0',
};

/** 动作槽显示的命名组变体；Tailwind 需要字面量才能生成这些类。 */
const HOVER_ACTION_GROUP_CLASSES: Record<HoverGroup, string> = {
  session: 'group-hover/session:opacity-100 group-hover/session:pointer-events-auto',
  proj: 'group-hover/proj:opacity-100 group-hover/proj:pointer-events-auto',
  plain: 'group-hover:opacity-100 group-hover:pointer-events-auto',
};

const HOVER_ACTION_BASE_CLASS =
  'absolute top-1/2 flex -translate-y-1/2 items-center bg-bg-hover transition-opacity';

interface HoverActionSlotProps {
  children: React.ReactNode;
  testId: string;
  group: HoverGroup;
  forceShow?: boolean;
  rightClassName?: string;
  className?: string;
  onFocus?: React.FocusEventHandler<HTMLDivElement>;
  onBlur?: React.FocusEventHandler<HTMLDivElement>;
}

/**
 * 侧栏行的统一 hover 动作覆盖槽：
 * 绝对定位、不占 flex 宽度、与行 hover 同色实底覆盖下方内容、默认隐藏、点击不冒泡。
 * 差异只有命名 group / 右侧偏移 / 强制显示来源，全部由 props 注入。
 */
const HoverActionSlot: React.FC<HoverActionSlotProps> = ({
  children,
  testId,
  group,
  forceShow = false,
  rightClassName = 'right-1.5',
  className,
  onFocus,
  onBlur,
}) => (
  <div
    data-no-drag
    role="presentation"
    data-testid={testId}
    className={cn(
      HOVER_ACTION_BASE_CLASS,
      rightClassName,
      className,
      forceShow
        ? 'opacity-100 pointer-events-auto'
        : cn(
            'opacity-0 pointer-events-none focus-within:opacity-100 focus-within:pointer-events-auto',
            HOVER_ACTION_GROUP_CLASSES[group],
          ),
    )}
    onFocus={onFocus}
    onBlur={onBlur}
    onClick={(e) => e.stopPropagation()}
  >
    {children}
  </div>
);

export default React.memo(HoverActionSlot);
