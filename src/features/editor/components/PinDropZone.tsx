import { useDroppable } from '@dnd-kit/core';
import React from 'react';

import { cn } from '@/lib/utils';
import { Pin } from '@/shared/components/icons';

import { PINNED_DROP_PREFIX } from '../dragDrop';

interface PinDropZoneProps {
  tabKey: string;
}

/**
 * 动态 pin drop zone：pinned 面板不存在时，拖拽期间出现在工作区最左侧，
 * 拖到此处松手即 pinTab 创建 pinned 面板。
 *
 * 复用 pinned 面板的 droppable id（`${PINNED_DROP_PREFIX}:${tabKey}:pinned`），
 * 判定零改动走既有 `resolveDropAction` 的 pin 分支。仅在拖拽中挂载
 * （shouldShowPinDropZone 门控），因此 DndContext 必须使用
 * `MeasuringStrategy.Always` 让中途注册的 droppable rect 被测量。
 */
function PinDropZone({ tabKey }: PinDropZoneProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `${PINNED_DROP_PREFIX}:${tabKey}:pinned`,
  });

  return (
    <div
      ref={setNodeRef}
      data-testid="pin-drop-zone"
      className={cn(
        'w-14 shrink-0 self-stretch my-0.5 rounded-lg border border-dashed',
        'flex flex-col items-center justify-center gap-1 select-none',
        'transition-colors',
        isOver
          ? 'border-accent bg-accent/10 ring-2 ring-accent/70 text-text-primary'
          : 'border-[var(--border-color)]/50 bg-bg-secondary text-text-secondary',
      )}
    >
      <Pin size={14} />
      <span className="text-[10px] leading-none">Pin</span>
    </div>
  );
}

PinDropZone.displayName = 'PinDropZone';

export default React.memo(PinDropZone);
