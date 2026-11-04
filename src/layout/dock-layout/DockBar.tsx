import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import React, { useMemo } from 'react';

import { cn } from '@/lib/utils';
import type { DockSlot, ViewKey } from '@/shared/dock';
import { TooltipProvider } from '@/ui/Tooltip';

import { barDropId } from './DockBarDnd';

/**
 * 工具栏条目：视图身份 + 已渲染的按钮。
 * 拖动与排序都需要**身份**（不只是 DOM），所以入口是结构而不是裸 ReactNode。
 */
export interface DockBarEntry {
  view: ViewKey;
  node: React.ReactNode;
}

interface DockBarProps {
  side: DockSlot;
  items: DockBarEntry[];
}

interface SortableDockBarItemProps {
  view: ViewKey;
  children: React.ReactNode;
}

/**
 * 单条图标的排序包装。
 *
 * 指针监听挂在包装层，按钮保留原生语义：刻意**不**展开 `useSortable` 的 `attributes`
 * （它会给包装 div 加 `role="button"` + `tabIndex`），否则每条图标多出一个 tab 停靠点，
 * 而键盘等价操作已经由按钮自身的 Alt+←/→ 提供。
 */
const SortableDockBarItem: React.FC<SortableDockBarItemProps> = React.memo(({ view, children }) => {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: view });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition ?? undefined,
      }}
      className={cn('w-11', isDragging && 'opacity-40')}
      {...listeners}
    >
      {children}
    </div>
  );
});
SortableDockBarItem.displayName = 'SortableDockBarItem';

const DockBar: React.FC<DockBarProps> = ({ side, items }) => {
  // 空栏同样是落点：容器自身 droppable（拖到空白处 = 追加到末尾），
  // 否则「把图标拖到另一侧」在那一侧还没有图标时无处可落。
  const { setNodeRef, isOver } = useDroppable({ id: barDropId(side) });
  const views = useMemo(() => items.map((item) => item.view), [items]);

  return (
    <TooltipProvider delayDuration={300}>
      <div
        ref={setNodeRef}
        className={cn('flex w-11 shrink-0 flex-col items-center py-2', isOver && 'bg-bg-hover')}
        role="toolbar"
        aria-label={`${side} toolbar`}
      >
        <SortableContext items={views} strategy={verticalListSortingStrategy}>
          {items.map((item) => (
            <SortableDockBarItem key={item.view} view={item.view}>
              {item.node}
            </SortableDockBarItem>
          ))}
        </SortableContext>
      </div>
    </TooltipProvider>
  );
};

export default React.memo(DockBar);
