/**
 * Direct MRU tab cycle for Ctrl+Tab / Ctrl+Shift+Tab (方案 B: press-to-switch).
 *
 * Unlike the old hold-to-switch palette, each press immediately activates the
 * next tab in MRU (most-recently-used) order:
 *   - Ctrl+Tab        → next (more recent → less recent), wraps to active.
 *   - Ctrl+Shift+Tab  → previous (reverse of the above).
 * No overlay, no Enter/release confirmation.
 */
import { create } from 'zustand';

import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import { resolveTabKey } from '@/shared/utils/tabKey';

import { useMruTabsStore } from './mruTabsStore';

/** A cycle gesture resets after this idle window (in ms). */
export const TAB_CYCLE_TTL_MS = 2000;

export interface TabCycleSession {
  tabKey: string;
  /** Cycle order: [active, prev, prev2, ..., oldest] (MRU-recent-first). */
  order: string[];
  /** Index of the next target to activate (0 = active). */
  cursor: number;
  lastActivated: string | null;
  expiresAt: number;
}

interface TabCycleState {
  session: TabCycleSession | null;
  cycleTab: (direction: 1 | -1) => void;
}

function currentTabKey(projectId: string): string {
  const wt = useWorktreeStore.getState().activeWorktreePath;
  return resolveTabKey(projectId, wt);
}

/**
 * Build the MRU cycle order: active first, then the remaining tabs in
 * most-recently-used order (tabs missing from MRU are appended in tab order).
 * Returns null when there is nothing to cycle.
 */
export function buildTabCycleOrder(
  mruIds: string[],
  allTabIds: string[],
  activeId: string | null,
): string[] | null {
  if (!activeId || allTabIds.length < 2) return null;
  const idSet = new Set(allTabIds);
  const others: string[] = [];
  const seen = new Set<string>();
  for (const id of mruIds) {
    if (idSet.has(id) && id !== activeId && !seen.has(id)) {
      seen.add(id);
      others.push(id);
    }
  }
  for (const id of allTabIds) {
    if (id !== activeId && !others.includes(id)) others.push(id);
  }
  return [activeId, ...others];
}

/** Advance the cursor by `direction` (wrapping) and return the target. */
export function advanceTabCycle(
  order: string[],
  cursor: number,
  direction: 1 | -1,
): { targetId: string; nextCursor: number } {
  const n = order.length;
  const nextCursor = (cursor + direction + n) % n;
  return { targetId: order[nextCursor], nextCursor };
}

export const useTabCycleStore = create<TabCycleState>((set, get) => ({
  session: null,

  cycleTab: (direction) => {
    const projectId = useProjectStore.getState().activeProjectId;
    if (!projectId) return;
    const tabKey = currentTabKey(projectId);
    const projectTabs = useEditorStore.getState().tabs[tabKey];
    if (!projectTabs || projectTabs.tabs.length < 2) return;

    const activeId = projectTabs.activeTabId;
    const now = Date.now();
    const prev = get().session;
    const fresh =
      !prev || prev.tabKey !== tabKey || now >= prev.expiresAt || prev.lastActivated !== activeId;

    const order = fresh
      ? buildTabCycleOrder(
          useMruTabsStore.getState().list(tabKey),
          projectTabs.tabs.map((t) => t.id),
          activeId,
        )
      : prev.order;
    if (!order) return;

    const { targetId, nextCursor } = advanceTabCycle(order, fresh ? 0 : prev.cursor, direction);
    useEditorStore.getState().activateTab(tabKey, targetId);
    set({
      session: {
        tabKey,
        order,
        cursor: nextCursor,
        lastActivated: targetId,
        expiresAt: now + TAB_CYCLE_TTL_MS,
      },
    });
  },
}));
