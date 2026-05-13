import { useCallback, useMemo } from "react";
import { useAppStore } from "../store/appStore";
import type { EditorGroupId, EditorSplitLayout, Tab } from "../types";
import { createDefaultEditorLayout, findGroupIdForTab } from "../types/editorGroup";

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
}

export function useEditorGroupLayout(tabKey: string): EditorGroupLayoutResult {
  const allTabs = useAppStore((s) => s.tabs[tabKey]?.tabs ?? []);
  const rawLayout = useAppStore((s) => s.editorLayout[tabKey]);
  const storeSplitRight = useAppStore((s) => s.splitRight);
  const storeMoveToRight = useAppStore((s) => s.moveToRight);
  const storeMoveToLeft = useAppStore((s) => s.moveToLeft);
  const storeUnsplit = useAppStore((s) => s.unsplit);
  const storeSetActiveGroup = useAppStore((s) => s.setActiveGroup);
  const storeSetSplitRatio = useAppStore((s) => s.setSplitRatio);
  const storeActivateTab = useAppStore((s) => s.activateTab);

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
  };
}
