import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import React, { useCallback } from 'react';

import { cn } from '@/lib/utils';
import { Pin } from '@/shared/components/icons';
import type { SessionView } from '@/shared/types/liveSessions';
import type { TabLike } from '@/shared/types/tab';

import { resolveTabTitle } from '../utils/tabTitle';

export interface TabItemProps<T extends TabLike> {
  tab: T;
  /**
   * 该 tab 的 live session（注册表快照里的那一条）；`null` = 尚未注册。
   *
   * 标题由 `resolveTabTitle` 派生（注册表 > tab 兜底）—— 本组件不读 store，
   * 也不把派生结果写回，于是「谁是最新标题」只有一个答案。
   */
  session?: SessionView | null;
  isActive: boolean;
  isPinned?: boolean;
  reorderable?: boolean;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onContextMenu?: (tabId: string, e: React.MouseEvent) => void;
  /** Render leading content (icon / status dots) before the title. */
  renderLeading?: (tab: T) => React.ReactNode;
}

function TabItem<T extends TabLike>({
  tab,
  session = null,
  isActive,
  isPinned = false,
  reorderable = false,
  onActivate,
  onClose,
  onContextMenu,
  renderLeading,
}: TabItemProps<T>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
    disabled: !reorderable,
  });

  const title = resolveTabTitle(tab, session);

  const handleClick = useCallback(() => {
    onActivate(tab.id);
  }, [tab.id, onActivate]);

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClose(tab.id);
    },
    [tab.id, onClose],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      onContextMenu?.(tab.id, e);
    },
    [tab.id, onContextMenu],
  );

  const handleAuxClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        // Pinned tabs cannot be closed via middle-click
        if (!isPinned) {
          onClose(tab.id);
        }
      }
    },
    [tab.id, isPinned, onClose],
  );

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
  };

  return (
    <div
      ref={reorderable ? setNodeRef : undefined}
      style={reorderable ? style : undefined}
      {...(reorderable ? attributes : {})}
      role="tab"
      tabIndex={isActive ? 0 : -1}
      aria-selected={isActive}
      className={cn(
        'flex items-center gap-1 h-6 px-2 rounded-md min-w-0 max-w-[10rem] transition-colors',
        isActive
          ? 'bg-bg-selected text-text-primary'
          : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
        isDragging && 'opacity-50 shadow-lg shadow-black/20 z-50',
      )}
      onClick={handleClick}
      onAuxClick={handleAuxClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      onContextMenu={handleContextMenu}
      {...(reorderable ? listeners : {})}
      title={title}
    >
      {renderLeading?.(tab)}

      {isPinned && <Pin size={10} className="shrink-0 opacity-50" />}

      <span className="truncate cursor-pointer" style={{ fontSize: 'var(--terminal-font-size)' }}>
        {title}
      </span>

      {!isPinned && (
        <button
          className="tb-icon-btn w-4 h-4 rounded text-inherit hover:bg-bg-hover transition-colors flex items-center justify-center shrink-0 leading-none"
          style={{ fontSize: 'var(--terminal-font-size)' }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handleClose}
          title="Close tab"
        >
          ×
        </button>
      )}
    </div>
  );
}

TabItem.displayName = 'TabItem';

export default React.memo(TabItem) as unknown as typeof TabItem;
