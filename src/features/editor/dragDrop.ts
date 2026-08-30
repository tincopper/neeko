import type { EditorGroupId } from '@/shared/types/editorGroup';

/** 前缀用于标识 pinned 面板区域的 droppable id。完整 id 形如 `pinned-drop:{tabKey}`。 */
export const PINNED_DROP_PREFIX = 'pinned-drop';

export type DropAction =
  | { type: 'pin'; tabId: string }
  | { type: 'unpin'; tabId: string; groupId: EditorGroupId; overId: string }
  | { type: 'reorder'; tabId: string; overId: string; groupId: EditorGroupId }
  | { type: 'none' };

export interface ResolveDropActionArgs {
  activeId: string;
  overId: string | null;
  pinnedDropId: string;
  leftIds: string[];
  rightIds: string[];
  /** 已 pin 的 tab id。pinned tab 可拖出 unpin；pinned 内部不支持排序。 */
  pinnedIds?: string[];
}

/**
 * 根据拖拽结束时的 active/over 判定动作：
 * - active 是 pinned tab → 拖到 left/right 组的 tab 上触发 unpin 移动；
 *   拖回 pinned 区域或落到组外 → none（pinned 内部不支持排序）
 * - over 命中 pinned 面板 droppable → pin
 * - active 与 over 同属 left/right 组 → reorder
 * - 其余（跨组、无 over）→ none
 */
export function resolveDropAction({
  activeId,
  overId,
  pinnedDropId,
  leftIds,
  rightIds,
  pinnedIds = [],
}: ResolveDropActionArgs): DropAction {
  if (!overId) return { type: 'none' };

  if (pinnedIds.includes(activeId)) {
    if (leftIds.includes(overId)) {
      return { type: 'unpin', tabId: activeId, groupId: 'left', overId };
    }
    if (rightIds.includes(overId)) {
      return { type: 'unpin', tabId: activeId, groupId: 'right', overId };
    }
    return { type: 'none' };
  }

  if (overId === pinnedDropId) {
    return { type: 'pin', tabId: activeId };
  }

  const inLeft = leftIds.includes(activeId);
  const inRight = rightIds.includes(activeId);
  if (inLeft && leftIds.includes(overId)) {
    return { type: 'reorder', tabId: activeId, overId, groupId: 'left' };
  }
  if (inRight && rightIds.includes(overId)) {
    return { type: 'reorder', tabId: activeId, overId, groupId: 'right' };
  }

  return { type: 'none' };
}

/**
 * 碰撞检测结果的轻量抽象，便于单测。id 需兼容 dnd-kit 的 UniqueIdentifier。
 */
export interface CollisionLike {
  id: string | number;
}

/**
 * 组合碰撞检测：指针位于 pinned 面板 droppable 内时优先命中（面板整块区域可 pin）；
 * 否则回退到最近中心判定（fallback 已由调用方排除 pinnedDropId，避免指针未进入面板时误触 pin）。
 * 返回可变数组以兼容 dnd-kit 的 CollisionDetection 签名。
 */
export function resolveCollision<T extends CollisionLike>(
  pointerCollisions: readonly T[],
  pinnedDropId: string,
  fallback: readonly T[],
): T[] {
  if (pointerCollisions.some((c) => c.id === pinnedDropId)) {
    return [...pointerCollisions];
  }
  return [...fallback];
}

/**
 * 从 left/right/pinned 组中查找被拖 tab，作为 DragOverlay 的内容源。
 * pinned tab 可作为拖拽源（拖出 unpin），故同样在查找范围；未命中返回 null。
 */
export function resolveDragTab<T extends { id: string }>(
  activeId: string,
  leftTabs: readonly T[],
  rightTabs: readonly T[],
  pinnedTabs: readonly T[] = [],
): T | null {
  return (
    leftTabs.find((t) => t.id === activeId) ??
    rightTabs.find((t) => t.id === activeId) ??
    pinnedTabs.find((t) => t.id === activeId) ??
    null
  );
}

/**
 * EditorGroupPane 根容器样式：基础布局骨架 + 激活组 focus ring + pinned drop 高亮。
 *
 * - pinned 区域被拖拽 over 时显示 accent drop 高亮，**替换**默认 focus ring
 *   （ring-1 与 ring-2 同属性叠加时胜者取决于样式表顺序，显式互斥更稳）。
 * - 非 pinned 组永不出现 drop 高亮（其 droppable 本身 disabled，此为双保险）。
 */
export function editorPaneRegionClass({
  groupId,
  activeGroupId,
  isOverDropTarget,
}: {
  groupId: EditorGroupId | 'pinned';
  activeGroupId?: string | null;
  isOverDropTarget: boolean;
}): string {
  const base = 'flex-1 flex flex-col overflow-hidden min-h-0';
  if (groupId === 'pinned' && isOverDropTarget) {
    return `${base} ring-2 ring-accent/70 bg-accent/5`;
  }
  const focusRing = activeGroupId === groupId ? ' ring-1 ring-[var(--border-color)]/30' : '';
  return `${base}${focusRing}`;
}

/**
 * 无 pinned 面板时是否显示动态 pin drop zone：
 * 仅在「pinned 面板不存在 + 拖拽中 + 被拖的是非 pinned tab」时出现，
 * 拖到该 zone 松手即 pinTab 创建 pinned 面板（复用既有 pinnedDropId 判定）。
 */
export function shouldShowPinDropZone({
  hasPinned,
  dragActiveTabId,
  pinnedIds,
}: {
  hasPinned: boolean;
  dragActiveTabId: string | null;
  pinnedIds: readonly string[];
}): boolean {
  return !hasPinned && dragActiveTabId !== null && !pinnedIds.includes(dragActiveTabId);
}
