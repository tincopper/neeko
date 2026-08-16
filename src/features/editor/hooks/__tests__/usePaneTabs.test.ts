import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Tab } from '@/shared/types';

import type { EditorGroupLayoutResult } from '../useEditorGroupLayout';
import { usePaneTabs } from '../usePaneTabs';

function fileTab(id: string, projectId = 'p1'): Tab {
  return {
    id,
    projectId,
    title: id,
    order: 0,
    data: {
      kind: 'file',
      filePath: id,
      fileName: id,
      content: { path: id, content: '', size: 0, is_binary: false },
      isDirty: false,
    },
  };
}

function makeLayout(overrides: Partial<EditorGroupLayoutResult> = {}): EditorGroupLayoutResult {
  const leftTabs = [fileTab('l1')];
  const rightTabs = [fileTab('r1')];
  const pinnedTabs = [fileTab('pin1')];
  return {
    layout: {
      isSplit: false,
      ratio: 0.5,
      activeGroupId: 'left',
      groups: {
        left: { tabIds: ['l1'], activeTabId: 'l1' },
        right: { tabIds: [], activeTabId: null },
      },
      pinnedTabIds: ['pin1'],
      pinnedActiveTabId: 'pin1',
      pinnedPanelRatio: 0.35,
    },
    isSplit: false,
    leftTabs,
    rightTabs,
    leftActiveTabId: 'l1',
    rightActiveTabId: 'r1',
    activeGroupId: 'left',
    splitRight: vi.fn(),
    moveToRight: vi.fn(),
    moveToLeft: vi.fn(),
    unsplit: vi.fn(),
    setActiveGroup: vi.fn(),
    setSplitRatio: vi.fn(),
    activateTabInGroup: vi.fn(),
    getTabGroupId: vi.fn(),
    pinnedTabs,
    pinnedActiveTabId: 'pin1',
    pinnedActiveTab: pinnedTabs[0]!,
    pinnedPanelRatio: 0.35,
    pinTab: vi.fn(),
    unpinTab: vi.fn(),
    setPinnedPanelRatio: vi.fn(),
    closeOtherTabs: vi.fn(),
    closeAllTabs: vi.fn(),
    ...overrides,
  };
}

describe('usePaneTabs', () => {
  it('left 面板：取 leftTabs / leftActiveTabId，projectIdForCheck 取自 active tab', () => {
    const { result } = renderHook(() => usePaneTabs('left', makeLayout(), null));
    expect(result.current.tabs.map((t) => t.id)).toEqual(['l1']);
    expect(result.current.activeTabId).toBe('l1');
    expect(result.current.activeTab?.id).toBe('l1');
    expect(result.current.projectIdForCheck).toBe('p1');
  });

  it('right 面板：取 rightTabs / rightActiveTabId', () => {
    const { result } = renderHook(() => usePaneTabs('right', makeLayout(), null));
    expect(result.current.tabs.map((t) => t.id)).toEqual(['r1']);
    expect(result.current.activeTabId).toBe('r1');
  });

  it('pinned 面板：取 pinnedTabs / pinnedActiveTab.id', () => {
    const { result } = renderHook(() => usePaneTabs('pinned', makeLayout(), null));
    expect(result.current.tabs.map((t) => t.id)).toEqual(['pin1']);
    expect(result.current.activeTabId).toBe('pin1');
    expect(result.current.activeTab?.id).toBe('pin1');
  });

  it('remoteProjectId 优先于 active tab 的 projectId', () => {
    const { result } = renderHook(() => usePaneTabs('left', makeLayout(), 'remote-p'));
    expect(result.current.projectIdForCheck).toBe('remote-p');
  });

  it('无激活 tab 时 projectIdForCheck 为 null', () => {
    const layout = makeLayout({ leftActiveTabId: null, leftTabs: [] });
    const { result } = renderHook(() => usePaneTabs('left', layout, null));
    expect(result.current.activeTab).toBeNull();
    expect(result.current.projectIdForCheck).toBeNull();
  });
});
