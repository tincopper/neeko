import { useMemo } from 'react';

import type { EditorGroupId, Tab } from '@/shared/types';

import type { EditorGroupLayoutResult } from './useEditorGroupLayout';

export interface PaneTabsResult {
  tabs: Tab[];
  activeTabId: string | null;
  activeTab: Tab | null;
  projectIdForCheck: string | null;
}

/** 根据面板 groupId 从布局状态派生当前面板的 tabs / activeTab / 项目 id */
export function usePaneTabs(
  groupId: EditorGroupId | 'pinned',
  layoutState: EditorGroupLayoutResult,
  remoteProjectId: string | null,
): PaneTabsResult {
  const { leftTabs, rightTabs, pinnedTabs, leftActiveTabId, rightActiveTabId, pinnedActiveTab } =
    layoutState;

  const tabs = useMemo(() => {
    if (groupId === 'left') return leftTabs;
    if (groupId === 'right') return rightTabs;
    if (groupId === 'pinned') return pinnedTabs;
    return [];
  }, [groupId, leftTabs, rightTabs, pinnedTabs]);

  const activeTabId = useMemo(() => {
    if (groupId === 'left') return leftActiveTabId;
    if (groupId === 'right') return rightActiveTabId;
    if (groupId === 'pinned') return pinnedActiveTab?.id ?? null;
    return null;
  }, [groupId, leftActiveTabId, rightActiveTabId, pinnedActiveTab]);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? null,
    [tabs, activeTabId],
  );

  return {
    tabs,
    activeTabId,
    activeTab,
    projectIdForCheck: remoteProjectId ?? activeTab?.projectId ?? null,
  };
}
