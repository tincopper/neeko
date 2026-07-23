import { useCallback, useMemo } from "react";
import { useEditorStore } from '@/shared/store';
import { closeAllEditorTabs, closeEditorTab } from '@/features/terminal/components/terminalTabCleanup';
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
  pinnedTab: Tab | null;
  pinnedPanelRatio: number;
  pinTab: (tabId: string) => void;
  unpinTab: () => void;
  setPinnedPanelRatio: (ratio: number) => void;
  closeOtherTabs: (keepTabId: string) => void;
  closeAllTabs: () => void;
}

export function useEditorGroupLayout(tabKey: string): EditorGroupLayoutResult {
  const allTabs = useEditorStore((s) => s.tabs[tabKey]?.tabs ?? []);
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

  const layout: EditorSplitLayout = useMemo(() => {
    if (rawLayout) return rawLayout;
    const l = createDefaultEditorLayout();
    l.groups.left.tabIds = allTabs.map((t) => t.id);
    l.groups.left.activeTabId = allTabs.length > 0 ? allTabs[allTabs.length - 1].id : null;
    return l;
  }, [rawLayout, allTabs]);

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

  const splitRight = useCallback((tabId: string) => storeSplitRight(tabKey, tabId), [storeSplitRight, tabKey]);
  const moveToRight = useCallback((tabId: string) => storeMoveToRight(tabKey, tabId), [storeMoveToRight, tabKey]);
  const moveToLeft = useCallback((tabId: string) => storeMoveToLeft(tabKey, tabId), [storeMoveToLeft, tabKey]);
  const unsplit = useCallback(() => storeUnsplit(tabKey), [storeUnsplit, tabKey]);
  const setActiveGroup = useCallback((groupId: EditorGroupId) => storeSetActiveGroup(tabKey, groupId), [storeSetActiveGroup, tabKey]);
  const setSplitRatio = useCallback((ratio: number) => storeSetSplitRatio(tabKey, ratio), [storeSetSplitRatio, tabKey]);

  const activateTabInGroup = useCallback(
    (tabId: string) => storeActivateTab(tabKey, tabId),
    [storeActivateTab, tabKey],
  );

  const getTabGroupId = useCallback(
    (tabId: string) => findGroupIdForTab(layout, tabId),
    [layout],
  );

  const pinTab = useCallback(
    (tabId: string) => storePinTab(tabKey, tabId),
    [storePinTab, tabKey],
  );

  const unpinTab = useCallback(
    () => storeUnpinTab(tabKey),
    [storeUnpinTab, tabKey],
  );

  const setPinnedPanelRatio = useCallback(
    (ratio: number) => storeSetPinnedPanelRatio(tabKey, ratio),
    [storeSetPinnedPanelRatio, tabKey],
  );

  const pinnedTab = useMemo(() => {
    const pinnedId = layout.pinnedTabId;
    if (!pinnedId) return null;
    return tabsById.get(pinnedId) ?? null;
  }, [layout.pinnedTabId, tabsById]);

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
    pinnedTab,
    pinnedPanelRatio,
    pinTab,
    unpinTab,
    setPinnedPanelRatio,
    closeOtherTabs,
    closeAllTabs,
  };
}
