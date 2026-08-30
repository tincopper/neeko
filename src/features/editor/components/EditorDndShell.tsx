import { DndContext, DragOverlay, MeasuringStrategy } from '@dnd-kit/core';
import React from 'react';

import type { Tab } from '@/shared/types';

import { shouldShowPinDropZone } from '../dragDrop';
import { useEditorDnd } from '../hooks/useEditorDnd';

import PinDropZone from './PinDropZone';
import TabDragPreview from './TabDragPreview';

// 拖拽中持续测量 droppable rect：PinDropZone 在拖拽中途才挂载，
// 默认 WhileDragging 仅在 dragStart 测量一次，中途注册的 rect 为 null
// 会让 pointerWithin 永远不命中。模块级常量避免每次渲染重建引用。
const DND_MEASURING = { droppable: { strategy: MeasuringStrategy.Always } } as const;

interface EditorDndShellProps {
  tabKey: string;
  leftTabs: Tab[];
  rightTabs: Tab[];
  pinnedTabs: Tab[];
  hasPinned: boolean;
  children: React.ReactNode;
}

/**
 * 编辑器共享 DndContext 装配壳：统一承载拖拽事件接线、DragOverlay 跟手预览
 * 与动态 pin drop zone，让 EditorGroupLayout 只保留布局骨架。
 */
function EditorDndShell({
  tabKey,
  leftTabs,
  rightTabs,
  pinnedTabs,
  hasPinned,
  children,
}: EditorDndShellProps) {
  const {
    sensors,
    collisionDetection,
    handleDragStart,
    handleDragCancel,
    handleDragEnd,
    dragActiveTab,
  } = useEditorDnd({ tabKey, leftTabs, rightTabs, pinnedTabs });

  // 无 pinned 面板时，拖非 pinned tab 期间显示动态 pin drop zone（拖入即创建 pinned 面板）
  const showPinDropZone = shouldShowPinDropZone({
    hasPinned,
    dragActiveTabId: dragActiveTab?.id ?? null,
    pinnedIds: pinnedTabs.map((t) => t.id),
  });

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
      measuring={DND_MEASURING}
    >
      <div className="flex-1 flex min-w-0">
        {showPinDropZone && <PinDropZone tabKey={tabKey} />}
        {children}
      </div>
      <DragOverlay>{dragActiveTab ? <TabDragPreview tab={dragActiveTab} /> : null}</DragOverlay>
    </DndContext>
  );
}

EditorDndShell.displayName = 'EditorDndShell';

export default React.memo(EditorDndShell);
