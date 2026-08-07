import type { EditorGroupId } from '@/shared/types/editorGroup';

/** 前缀用于标识 pinned 面板区域的 droppable id。完整 id 形如 `pinned-drop:{tabKey}`。 */
export const PINNED_DROP_PREFIX = 'pinned-drop';

export type DropAction =
  | { type: 'pin'; tabId: string }
  | { type: 'reorder'; tabId: string; overId: string; groupId: EditorGroupId }
  | { type: 'none' };

export interface ResolveDropActionArgs {
  activeId: string;
  overId: string | null;
  pinnedDropId: string;
  leftIds: string[];
  rightIds: string[];
}

/**
 * 根据拖拽结束时的 active/over 判定动作：
 * - over 命中 pinned 面板 droppable → pin
 * - active 与 over 同属 left/right 组 → reorder
 * - 其余（跨组、pinned 自身、无 over）→ none
 */
export function resolveDropAction({
  activeId,
  overId,
  pinnedDropId,
  leftIds,
  rightIds,
}: ResolveDropActionArgs): DropAction {
  if (!overId) return { type: 'none' };

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

/** 碰撞检测结果的轻量抽象，便于单测。id 需兼容 dnd-kit 的 UniqueIdentifier。 */
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
