import {
  closestCenter,
  pointerWithin,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useCallback, useMemo, useState } from 'react';

import { useEditorStore } from '@/shared/store/editorStore';
import type { Tab } from '@/shared/types/tab';

import {
  PINNED_DROP_PREFIX,
  resolveCollision,
  resolveDragTab,
  resolveDropAction,
} from '../dragDrop';

export interface UseEditorDndOptions {
  tabKey: string;
  leftTabs: Tab[];
  rightTabs: Tab[];
  /** pinned 面板的 tab（可作为拖拽源拖出 unpin） */
  pinnedTabs: Tab[];
}

/**
 * 编辑布局共享 DndContext 的配置 hook（multi-container 模式）。
 *
 * left/right/pinned 三个面板的 TabBar 共享同一个 DndContext，
 * 使拖拽 over 检测可跨面板生效（否则无法命中 pinned 面板区域）。
 * 集中 sensors / pinned droppable id / 碰撞检测 / dragEnd 分发，
 * 保持 EditorGroupLayout 组件薄；拖拽判定纯逻辑在 dragDrop.ts，可独立单测。
 *
 * 另维护 DragOverlay 的内容源（dragActiveTab）：被拖的原始 tab 元素受
 * TabBar `overflow-x-auto` 裁剪，跨面板拖拽中离开源 tab 栏即不可见，
 * 必须由 overlay 副本跟手（EditorGroupLayout 渲染）。
 */
export function useEditorDnd({ tabKey, leftTabs, rightTabs, pinnedTabs }: UseEditorDndOptions) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  // DragOverlay 内容源：dragStart 记录被拖 tab id，dragEnd/cancel 无条件清空
  const [dragActiveId, setDragActiveId] = useState<string | null>(null);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDragActiveId(String(event.active.id));
  }, []);

  const handleDragCancel = useCallback(() => {
    setDragActiveId(null);
  }, []);

  // pinned 面板区域的 droppable id，与 EditorGroupPane 中的 useDroppable 对应。
  // 格式必须与 pane 侧 `${PINNED_DROP_PREFIX}:${tabKey}:pinned` 一致。
  const pinnedDropId = `${PINNED_DROP_PREFIX}:${tabKey}:pinned`;

  // 碰撞检测：指针位于 pinned 面板 droppable 内时优先命中（面板整块区域可 pin）；
  // 其余场景沿用最近中心判定，但排除 pinnedDropId（指针未进入面板时不得误触 pin），
  // 保持 left/right 组内排序不回归。
  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      const pointerCollisions = pointerWithin(args);
      const fallback = closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter((c) => c.id !== pinnedDropId),
      });
      return resolveCollision(pointerCollisions, pinnedDropId, fallback);
    },
    [pinnedDropId],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      // 先清空 overlay 状态再判定动作：over 为 null / 同 id 提前 return 的路径也要清
      setDragActiveId(null);
      if (!over || active.id === over.id) return;
      const action = resolveDropAction({
        activeId: String(active.id),
        overId: String(over.id),
        pinnedDropId,
        leftIds: leftTabs.map((t) => t.id),
        rightIds: rightTabs.map((t) => t.id),
        pinnedIds: pinnedTabs.map((t) => t.id),
      });
      if (action.type === 'pin') {
        useEditorStore.getState().pinTab(tabKey, action.tabId);
      } else if (action.type === 'unpin') {
        useEditorStore.getState().unpinTabTo(tabKey, action.tabId, action.groupId, action.overId);
      } else if (action.type === 'reorder') {
        useEditorStore.getState().reorderTab(tabKey, action.groupId, action.tabId, action.overId);
      }
    },
    [pinnedDropId, leftTabs, rightTabs, pinnedTabs, tabKey],
  );

  const dragActiveTab = useMemo(
    () => (dragActiveId ? resolveDragTab(dragActiveId, leftTabs, rightTabs, pinnedTabs) : null),
    [dragActiveId, leftTabs, rightTabs, pinnedTabs],
  );

  return {
    sensors,
    collisionDetection,
    handleDragStart,
    handleDragCancel,
    handleDragEnd,
    dragActiveTab,
  };
}
