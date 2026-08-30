import React from 'react';

import type { TabLike } from '@/shared/types/tab';

interface TabDragPreviewProps {
  tab: TabLike;
}

/**
 * DragOverlay 内的跟手 tab 预览（纯展示）。
 *
 * 无 Overlay 时被拖的原始 tab 元素受 TabBar `overflow-x-auto` 裁剪，
 * 跨面板拖拽（left/right → pinned）中离开源 tab 栏即不可见。本组件作为
 * overlay 副本跟随指针，不受源容器裁剪。刻意不带交互语义（role=tab /
 * 关闭按钮 / listeners）——overlay 由 dnd-kit 移动，任何可交互子元素都会
 * 产生误触，且 agent leading 图标依赖 pane 层的 installed agents 状态，
 * 预览聚焦 tab 标识本身。
 */
function TabDragPreview({ tab }: TabDragPreviewProps) {
  return (
    <div
      data-testid="tab-drag-preview"
      className="flex items-center gap-1 h-6 px-2 rounded-md min-w-0 max-w-[10rem] bg-bg-selected text-text-primary shadow-lg shadow-black/20 cursor-grabbing"
    >
      <span className="truncate" style={{ fontSize: 'var(--terminal-font-size)' }}>
        {tab.title}
      </span>
    </div>
  );
}

TabDragPreview.displayName = 'TabDragPreview';

export default React.memo(TabDragPreview);
