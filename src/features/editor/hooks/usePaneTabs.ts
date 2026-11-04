import { useMemo } from 'react';

import type { EditorPaneId, Tab } from '@/shared/types';
import { tabProjectId } from '@/shared/utils/tabIdentity';
import type { ProjectId } from '@/shared/utils/workspaceRef';

import type { EditorGroupLayoutResult } from './useEditorGroupLayout';

export interface PaneTabsResult {
  tabs: Tab[];
  activeTabId: string | null;
  activeTab: Tab | null;
  projectIdForCheck: ProjectId | null;
}

/** 稳定的空数组：避免每次渲染新建数组导致 memo 失效。 */
const EMPTY_TABS: Tab[] = [];

/**
 * 根据 pane 身份从布局状态派生当前面板的 tabs / activeTab / 项目 id。
 *
 * 五个 pane 同构：中心组两个、pinned、两个槽位宿主（docked）—— 都是「布局里的一个组」，
 * 因此取值方式一致（组即顺序与归属），不为 dock 另写一套渲染管线。
 */
export function usePaneTabs(
  paneId: EditorPaneId,
  layoutState: EditorGroupLayoutResult,
  remoteProjectId: ProjectId | null,
): PaneTabsResult {
  const {
    leftTabs,
    rightTabs,
    pinnedTabs,
    leftActiveTabId,
    rightActiveTabId,
    pinnedActiveTab,
    dockedTabs,
    dockedActiveTabIds,
  } = layoutState;

  const tabs = useMemo(() => {
    if (paneId === 'left') return leftTabs;
    if (paneId === 'right') return rightTabs;
    if (paneId === 'pinned') return pinnedTabs;
    if (paneId === 'dockLeft') return dockedTabs?.left ?? EMPTY_TABS;
    if (paneId === 'dockRight') return dockedTabs?.right ?? EMPTY_TABS;
    return EMPTY_TABS;
  }, [paneId, leftTabs, rightTabs, pinnedTabs, dockedTabs]);

  const activeTabId = useMemo(() => {
    if (paneId === 'left') return leftActiveTabId;
    if (paneId === 'right') return rightActiveTabId;
    if (paneId === 'pinned') return pinnedActiveTab?.id ?? null;
    if (paneId === 'dockLeft') return dockedActiveTabIds?.left ?? null;
    if (paneId === 'dockRight') return dockedActiveTabIds?.right ?? null;
    return null;
  }, [paneId, leftActiveTabId, rightActiveTabId, pinnedActiveTab, dockedActiveTabIds]);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? null,
    [tabs, activeTabId],
  );

  return {
    tabs,
    activeTabId,
    activeTab,
    projectIdForCheck: remoteProjectId ?? (activeTab ? tabProjectId(activeTab) : null),
  };
}
