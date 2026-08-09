import { useCallback, useMemo } from 'react';

import { closeAllEditorTabs, closeEditorTab } from '@/features/terminal';
import { useEditorStore } from '@/shared/store';
import type { EditorGroupId, EditorSplitLayout, Tab } from '@/shared/types';
import { createDefaultEditorLayout, findGroupIdForTab } from '@/shared/types/editorGroup';

export interface EditorGroupLayoutResult {
  layout: EditorSplitLayout;
  isSplit: boolean;
  leftTabs: Tab[];
  rightTabs: Tab[];
  leftActiveTabId: string | null;
  rightActiveTabId: string | null;
  activeGroupId: EditorGroupId;
  splitRight: (tabId: string) => void;
  moveToRight: (tabId: string) => void;
  moveToLeft: (tabId: string) => void;
  unsplit: () => void;
  setActiveGroup: (groupId: EditorGroupId) => void;
  setSplitRatio: (ratio: number) => void;
  activateTabInGroup: (tabId: string) => void;
  getTabGroupId: (tabId: string) => EditorGroupId | null;
  // ── Pin ──
  pinnedTabs: Tab[];
  pinnedActiveTabId: string | null;
  pinnedActiveTab: Tab | null;
  pinnedPanelRatio: number;
  pinTab: (tabId: string) => void;
  unpinTab: (tabId: string) => void;
  setPinnedPanelRatio: (ratio: number) => void;
  closeOtherTabs: (keepTabId: string) => void;
  closeAllTabs: () => void;
}

// Stable empty array: returning a fresh `[]` from a zustand selector each call
// makes useSyncExternalStore see a changed snapshot every render (infinite
// loop risk in production builds); share one reference instead.
const EMPTY_TABS: Tab[] = [];

export function useEditorGroupLayout(tabKey: string): EditorGroupLayoutResult {
  const allTabs = useEditorStore((s) => s.tabs[tabKey]?.tabs ?? EMPTY_TABS);
  const projectActiveTabId = useEditorStore((s) => s.tabs[tabKey]?.activeTabId ?? null);
  const rawLayout = useEditorStore((s) => s.editorLayout[tabKey]);
  const storeSplitRight = useEditorStore((s) => s.splitRight);
  const storeMoveToRight = useEditorStore((s) => s.moveToRight);
  const storeMoveToLeft = useEditorStore((s) => s.moveToLeft);
  const storeUnsplit = useEditorStore((s) => s.unsplit);
  const storeSetActiveGroup = useEditorStore((s) => s.setActiveGroup);
  const storeSetSplitRatio = useEditorStore((s) => s.setSplitRatio);
  const storeActivateTab = useEditorStore((s) => s.activateTab);
  const storePinTab = useEditorStore((s) => s.pinTab);
  const storeUnpinTab = useEditorStore((s) => s.unpinTab);
  const storeSetPinnedPanelRatio = useEditorStore((s) => s.setPinnedPanelRatio);

  // Live tab id lookup set — O(1) membership checks for healing stale layouts
  // (avoids O(n×m) `allTabs.some(...)` scans inside the heal callback).
  const liveTabIdSet = useMemo(() => {
    const set = new Set<string>();
    for (const t of allTabs) set.add(t.id);
    return set;
  }, [allTabs]);

  // Repair a group whose activeTabId is null or points at a tab that is no
  // longer in the group. The layout can go stale through paths that write tabs
  // without a layout (session restore) or through split juggling — and when it
  // does, EditorGroupPane's `activeTab` lookup misses and the content area
  // renders blank while the tab bar still shows the tabs.
  // NOTE: the layout's own `tabIds` may itself list removed tabs (leftTabs
  // filters them out), so only tabs that still exist in the store are
  // candidates for the healed active id.
  const healGroupActiveTabId = useCallback(
    (tabIds: string[], currentActiveTabId: string | null): string | null => {
      const liveTabIds = tabIds.filter((id) => liveTabIdSet.has(id));
      if (currentActiveTabId && liveTabIds.includes(currentActiveTabId)) return currentActiveTabId;
      if (liveTabIds.length === 0) return null;
      // Prefer the store's active tab when it lives in this group, else the
      // last remaining tab — mirrors the fallback branch below.
      return projectActiveTabId && liveTabIds.includes(projectActiveTabId)
        ? projectActiveTabId
        : liveTabIds[liveTabIds.length - 1];
    },
    [projectActiveTabId, liveTabIdSet],
  );

  const layout: EditorSplitLayout = useMemo(() => {
    if (rawLayout) {
      // A stored layout may reference tabs that were removed (blank content
      // area bug). Heal each group without mutating the stored layout.
      const leftActive = healGroupActiveTabId(
        rawLayout.groups.left.tabIds,
        rawLayout.groups.left.activeTabId,
      );
      const rightActive = healGroupActiveTabId(
        rawLayout.groups.right.tabIds,
        rawLayout.groups.right.activeTabId,
      );
      const livePinnedIds = rawLayout.pinnedTabIds.filter((id) => liveTabIdSet.has(id));
      const pinnedActive =
        rawLayout.pinnedActiveTabId && livePinnedIds.includes(rawLayout.pinnedActiveTabId)
          ? rawLayout.pinnedActiveTabId
          : livePinnedIds.length > 0
            ? livePinnedIds[livePinnedIds.length - 1]
            : null;
      if (
        rawLayout.groups.left.activeTabId === leftActive &&
        rawLayout.groups.right.activeTabId === rightActive &&
        rawLayout.pinnedActiveTabId === pinnedActive
      ) {
        return rawLayout;
      }
      return {
        ...rawLayout,
        groups: {
          left: { ...rawLayout.groups.left, activeTabId: leftActive },
          right: { ...rawLayout.groups.right, activeTabId: rightActive },
        },
        pinnedActiveTabId: pinnedActive,
      };
    }
    const l = createDefaultEditorLayout();
    l.groups.left.tabIds = allTabs.map((t) => t.id);
    // Prefer the store's active tab so the fallback (used before any layout is
    // created, e.g. right after session restore) never points at a removed tab
    // — otherwise closing the active tab leaves a blank content area.
    l.groups.left.activeTabId =
      projectActiveTabId && liveTabIdSet.has(projectActiveTabId)
        ? projectActiveTabId
        : allTabs.length > 0
          ? allTabs[allTabs.length - 1].id
          : null;
    return l;
  }, [rawLayout, allTabs, projectActiveTabId, healGroupActiveTabId, liveTabIdSet]);

  const tabsById = useMemo(() => {
    const map = new Map<string, Tab>();
    for (const t of allTabs) map.set(t.id, t);
    return map;
  }, [allTabs]);

  const leftTabs = useMemo(
    () => layout.groups.left.tabIds.map((id) => tabsById.get(id)).filter(Boolean) as Tab[],
    [layout.groups.left.tabIds, tabsById],
  );

  const rightTabs = useMemo(
    () => layout.groups.right.tabIds.map((id) => tabsById.get(id)).filter(Boolean) as Tab[],
    [layout.groups.right.tabIds, tabsById],
  );

  const splitRight = useCallback(
    (tabId: string) => storeSplitRight(tabKey, tabId),
    [storeSplitRight, tabKey],
  );
  const moveToRight = useCallback(
    (tabId: string) => storeMoveToRight(tabKey, tabId),
    [storeMoveToRight, tabKey],
  );
  const moveToLeft = useCallback(
    (tabId: string) => storeMoveToLeft(tabKey, tabId),
    [storeMoveToLeft, tabKey],
  );
  const unsplit = useCallback(() => storeUnsplit(tabKey), [storeUnsplit, tabKey]);
  const setActiveGroup = useCallback(
    (groupId: EditorGroupId) => storeSetActiveGroup(tabKey, groupId),
    [storeSetActiveGroup, tabKey],
  );
  const setSplitRatio = useCallback(
    (ratio: number) => storeSetSplitRatio(tabKey, ratio),
    [storeSetSplitRatio, tabKey],
  );

  const activateTabInGroup = useCallback(
    (tabId: string) => storeActivateTab(tabKey, tabId),
    [storeActivateTab, tabKey],
  );

  const getTabGroupId = useCallback((tabId: string) => findGroupIdForTab(layout, tabId), [layout]);

  const pinTab = useCallback((tabId: string) => storePinTab(tabKey, tabId), [storePinTab, tabKey]);

  const unpinTab = useCallback(
    (tabId: string) => storeUnpinTab(tabKey, tabId),
    [storeUnpinTab, tabKey],
  );

  const setPinnedPanelRatio = useCallback(
    (ratio: number) => storeSetPinnedPanelRatio(tabKey, ratio),
    [storeSetPinnedPanelRatio, tabKey],
  );

  const pinnedTabs = useMemo(
    () => layout.pinnedTabIds.map((id) => tabsById.get(id)).filter(Boolean) as Tab[],
    [layout.pinnedTabIds, tabsById],
  );

  const pinnedActiveTab = useMemo(() => {
    const pinnedId = layout.pinnedActiveTabId;
    if (!pinnedId) return null;
    return tabsById.get(pinnedId) ?? null;
  }, [layout.pinnedActiveTabId, tabsById]);

  const pinnedPanelRatio = layout.pinnedPanelRatio ?? 0.35;

  const closeOtherTabs = useCallback(
    (keepTabId: string) => {
      const store = useEditorStore.getState();
      const projectTabs = store.tabs[tabKey];
      if (!projectTabs) return;
      for (const tab of projectTabs.tabs) {
        if (tab.id !== keepTabId) {
          closeEditorTab(tabKey, tab.id);
        }
      }
    },
    [tabKey],
  );

  const closeAllTabs = useCallback(() => {
    closeAllEditorTabs(tabKey);
  }, [tabKey]);

  return {
    layout,
    isSplit: layout.isSplit,
    leftTabs,
    rightTabs,
    leftActiveTabId: layout.groups.left.activeTabId,
    rightActiveTabId: layout.groups.right.activeTabId,
    activeGroupId: layout.activeGroupId,
    splitRight,
    moveToRight,
    moveToLeft,
    unsplit,
    setActiveGroup,
    setSplitRatio,
    activateTabInGroup,
    getTabGroupId,
    pinnedTabs,
    pinnedActiveTabId: layout.pinnedActiveTabId,
    pinnedActiveTab,
    pinnedPanelRatio,
    pinTab,
    unpinTab,
    setPinnedPanelRatio,
    closeOtherTabs,
    closeAllTabs,
  };
}
