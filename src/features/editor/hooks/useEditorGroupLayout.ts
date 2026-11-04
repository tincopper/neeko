import { useCallback, useMemo } from 'react';

import { closeAllEditorTabs, closeEditorTab } from '@/features/terminal';
import type { DockSlot } from '@/shared/dock';
import { useEditorStore } from '@/shared/store/editorStore';
import type { EditorGroupId, EditorSplitLayout, Tab } from '@/shared/types';
import { findGroupIdForTab } from '@/shared/types/editorGroup';
import { getTabDisplayName, isDirtyFileTab } from '@/shared/utils/fileTree';

import { fallbackEditorLayout, healEditorLayout } from '../utils/healEditorLayout';

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
  // ── 槽位宿主（dock）投影：与中心三组同构的派生读取面 ──
  dockedTabs: Record<DockSlot, Tab[]>;
  dockedActiveTabIds: Record<DockSlot, string | null>;
}

/**
 * 批量关闭前如有未保存文件，先询问用户。`dirtyNames` 为待关闭的未保存文件名，
 * 用户确认后调用 `doClose` 执行实际关闭。
 */
type RequestCloseDirty = (dirtyNames: string[], doClose: () => void) => void;

// Stable empty array: returning a fresh `[]` from a zustand selector each call
// makes useSyncExternalStore see a changed snapshot every render (infinite
// loop risk in production builds); share one reference instead.
const EMPTY_TABS: Tab[] = [];

export function useEditorGroupLayout(
  tabKey: string,
  onRequestCloseDirty?: RequestCloseDirty,
): EditorGroupLayoutResult {
  const allTabs = useEditorStore((s) => s.tabs[tabKey]?.tabs ?? EMPTY_TABS);
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

  // 布局自愈（纯函数，见 utils/healEditorLayout）：读侧修正幽灵激活位，不写回 store
  const layout: EditorSplitLayout = useMemo(
    () => (rawLayout ? healEditorLayout(rawLayout, allTabs) : fallbackEditorLayout(allTabs)),
    [rawLayout, allTabs],
  );

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

  const dockedLeftTabs = useMemo(
    () => layout.docked.left.tabIds.map((id) => tabsById.get(id)).filter(Boolean) as Tab[],
    [layout.docked.left.tabIds, tabsById],
  );

  const dockedRightTabs = useMemo(
    () => layout.docked.right.tabIds.map((id) => tabsById.get(id)).filter(Boolean) as Tab[],
    [layout.docked.right.tabIds, tabsById],
  );

  const dockedTabs = useMemo(
    () => ({ left: dockedLeftTabs, right: dockedRightTabs }),
    [dockedLeftTabs, dockedRightTabs],
  );

  const dockedActiveTabIds = useMemo(
    () => ({ left: layout.docked.left.activeTabId, right: layout.docked.right.activeTabId }),
    [layout.docked.left.activeTabId, layout.docked.right.activeTabId],
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

  const dirtyNamesOf = useCallback(
    (tabsToCheck: Tab[]): string[] => tabsToCheck.filter(isDirtyFileTab).map(getTabDisplayName),
    [],
  );

  const closeOtherTabs = useCallback(
    (keepTabId: string) => {
      const store = useEditorStore.getState();
      const projectTabs = store.tabs[tabKey];
      if (!projectTabs) return;
      const targets = projectTabs.tabs.filter((t) => t.id !== keepTabId);
      const dirty = dirtyNamesOf(targets);
      const doClose = () => {
        for (const tab of targets) {
          closeEditorTab(tabKey, tab.id);
        }
      };
      if (dirty.length > 0 && onRequestCloseDirty) {
        onRequestCloseDirty(dirty, doClose);
      } else {
        doClose();
      }
    },
    [tabKey, dirtyNamesOf, onRequestCloseDirty],
  );

  const closeAllTabs = useCallback(() => {
    const store = useEditorStore.getState();
    const projectTabs = store.tabs[tabKey];
    if (!projectTabs) return;
    const dirty = dirtyNamesOf(projectTabs.tabs);
    const doClose = () => closeAllEditorTabs(tabKey);
    if (dirty.length > 0 && onRequestCloseDirty) {
      onRequestCloseDirty(dirty, doClose);
    } else {
      doClose();
    }
  }, [tabKey, dirtyNamesOf, onRequestCloseDirty]);

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
    dockedTabs,
    dockedActiveTabIds,
  };
}
