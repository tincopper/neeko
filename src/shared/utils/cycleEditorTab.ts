/**
 * Pure helper: next/prev tab id within an editor group (IDEA Alt+Left/Right).
 */

export interface CycleTabLayoutSlice {
  activeGroupId?: "left" | "right";
  pinnedTabId?: string | null;
  groups?: {
    left?: { tabIds?: string[]; activeTabId?: string | null };
    right?: { tabIds?: string[]; activeTabId?: string | null };
  };
}

export function resolveNextTabId(opts: {
  tabIds: string[];
  activeTabId: string | null;
  layout?: CycleTabLayoutSlice | null;
  direction: 1 | -1;
}): string | null {
  const { tabIds, activeTabId, layout, direction } = opts;
  if (tabIds.length === 0) return null;

  const existingIds = new Set(tabIds);
  const activeGroupId = layout?.activeGroupId ?? "left";
  const group = layout?.groups?.[activeGroupId];

  let orderedIds: string[] =
    group?.tabIds && group.tabIds.length > 0
      ? group.tabIds.filter((id) => existingIds.has(id))
      : [...tabIds];

  if (layout?.groups) {
    const assigned = new Set([
      ...(layout.groups.left?.tabIds ?? []),
      ...(layout.groups.right?.tabIds ?? []),
      ...(layout.pinnedTabId ? [layout.pinnedTabId] : []),
    ]);
    for (const id of tabIds) {
      if (!assigned.has(id) && !orderedIds.includes(id)) {
        orderedIds.push(id);
      }
    }
  }

  if (orderedIds.length === 0) return null;

  const groupActive = group?.activeTabId ?? null;
  const currentActive =
    (groupActive && orderedIds.includes(groupActive) ? groupActive : null) ??
    (activeTabId && orderedIds.includes(activeTabId) ? activeTabId : null) ??
    orderedIds[0];

  const currentIndex = orderedIds.indexOf(currentActive);
  if (currentIndex < 0) return null;

  const targetIndex =
    (currentIndex + direction + orderedIds.length) % orderedIds.length;
  return orderedIds[targetIndex] ?? null;
}
