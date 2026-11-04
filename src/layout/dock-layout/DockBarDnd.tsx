import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import React, { useCallback, useMemo } from 'react';

import { DOCK_SLOTS, type DockSlot, type ViewKey } from '@/shared/dock';

import type { DockBarEntry } from './DockBar';

/** 栏容器 droppable 的 id：落到它上面 = 追加到该栏末尾。 */
export const barDropId = (slot: DockSlot): string => `bar:${slot}`;

export type MoveViewHandler = (view: ViewKey, slot: DockSlot, index?: number) => void;

/**
 * 解析拖拽落点：栏容器 → 追加；某条图标 → 该图标所在栏 + 它的槽内下标。
 *
 * 纯函数（无 store / 无声明表）：拖拽只负责把 id 翻译成「目标槽 + 下标」，
 * 落位算法在 `dockStore.moveView`。id 里**不编码**槽位 —— 槽位是落位表的事实，
 * 编码进 id 就是同一事实的第二份表示（图标换边后还可能读到过期的编码）。
 */
export function resolveDropTarget(
  overId: string,
  slotViews: Readonly<Record<DockSlot, readonly ViewKey[]>>,
): { slot: DockSlot; index?: number } | null {
  for (const slot of DOCK_SLOTS) {
    if (barDropId(slot) === overId) return { slot };
  }
  for (const slot of DOCK_SLOTS) {
    const index = slotViews[slot].indexOf(overId as ViewKey);
    if (index >= 0) return { slot, index };
  }
  return null;
}

interface DockBarDndProps {
  leftBarItems: DockBarEntry[];
  rightBarItems: DockBarEntry[];
  onMoveView?: MoveViewHandler;
  children: React.ReactNode;
}

/**
 * 左右两条 DockBar **共用**的单一 DndContext。
 *
 * 与 `interaction-patterns.md` §4「每个独立排序区域一个 DndContext」的偏差是有意的：
 * 跨栏移动使左右两栏构成**同一个**排序语义区域，而 dnd-kit 不支持跨 context 拖拽 ——
 * 拆成两个 context 的话「把图标从左侧拖到右侧」在构造上不可能。
 */
function DockBarDnd({ leftBarItems, rightBarItems, onMoveView, children }: DockBarDndProps) {
  // 只接指针：按钮的键盘约定是 Alt+←/→ 换边（见 DockBarButton）。dnd-kit 的
  // KeyboardSensor 用 Space/Enter 激活拖拽，与按钮自身的键盘语义叠在同一节点上
  // 就说不清「按空格到底是激活面板还是开始拖动」。
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const slotViews = useMemo<Record<DockSlot, readonly ViewKey[]>>(
    () => ({
      left: leftBarItems.map((item) => item.view),
      right: rightBarItems.map((item) => item.view),
    }),
    [leftBarItems, rightBarItems],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || !onMoveView) return;
      const target = resolveDropTarget(String(over.id), slotViews);
      if (!target) return;
      onMoveView(String(active.id) as ViewKey, target.slot, target.index);
    },
    [onMoveView, slotViews],
  );

  return (
    // pointerWithin（而非 closestCenter）：两条栏相距很远，「最近的 droppable」会让
    // 「拖起来又改主意、在中间松手」也把图标挪到最近的那栏末尾（含把它自己在栏内追加到末尾）。
    // 指针不在任何 droppable 里 ⇒ over 为 null ⇒ 压根不算一次移动。
    // 同时它按「到四角平均距离」排序，小的图标 rect 永远赢过整条栏容器 rect，
    // 于是「落在某条图标上 = 插到它的下标」「落在栏空白处 = 追加到末尾」都成立。
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={handleDragEnd}>
      {children}
    </DndContext>
  );
}

DockBarDnd.displayName = 'DockBarDnd';

export default React.memo(DockBarDnd);
