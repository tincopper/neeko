import {
  closestCenter,
  pointerWithin,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useCallback } from 'react';

import { useEditorStore } from '@/shared/store';
import type { Tab } from '@/shared/types/tab';

import { PINNED_DROP_PREFIX, resolveCollision, resolveDropAction } from '../dragDrop';

export interface UseEditorDndOptions {
  tabKey: string;
  leftTabs: Tab[];
  rightTabs: Tab[];
}

/**
 * 编辑布局共享 DndContext 的配置 hook（multi-container 模式）。
 *
 * left/right/pinned 三个面板的 TabBar 共享同一个 DndContext，
 * 使拖拽 over 检测可跨面板生效（否则无法命中 pinned 面板区域）。
 * 集中 sensors / pinned droppable id / 碰撞检测 / dragEnd 分发，
 * 保持 EditorGroupLayout 组件薄；拖拽判定纯逻辑在 dragDrop.ts，可独立单测。
 */
export function useEditorDnd({ tabKey, leftTabs, rightTabs }: UseEditorDndOptions) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

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
      if (!over || active.id === over.id) return;
      const action = resolveDropAction({
        activeId: String(active.id),
        overId: String(over.id),
        pinnedDropId,
        leftIds: leftTabs.map((t) => t.id),
        rightIds: rightTabs.map((t) => t.id),
      });
      if (action.type === 'pin') {
        useEditorStore.getState().pinTab(tabKey, action.tabId);
      } else if (action.type === 'reorder') {
        useEditorStore.getState().reorderTab(tabKey, action.groupId, action.tabId, action.overId);
      }
    },
    [pinnedDropId, leftTabs, rightTabs, tabKey],
  );

  return { sensors, collisionDetection, handleDragEnd };
}
