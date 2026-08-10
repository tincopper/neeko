import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { closeEditorTab } from '@/features/terminal';
import { useEditorStore } from '@/shared/store/editorStore';
import type { Tab } from '@/shared/types';

import { useEditorGroupLayout } from '../useEditorGroupLayout';

function makeTab(id: string, kind: Tab['data']['kind'] = 'file'): Tab {
  if (kind === 'file') {
    return {
      id,
      projectId: 'p1',
      title: id,
      order: 0,
      data: {
        kind: 'file',
        filePath: id,
        fileName: id,
        content: '',
        isDirty: false,
      },
    };
  }
  return {
    id,
    projectId: 'p1',
    title: id,
    order: 0,
    data: { kind: 'terminal', agentId: null, status: 'Idle' },
  };
}

describe('closeTab → layout auto-switch (regression: blank content area)', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: {}, editorLayout: {}, activeTabId: null });
  });

  it('single group: closing the active tab moves group activeTabId to the adjacent remaining tab', () => {
    const { addTab, activateTab } = useEditorStore.getState();
    act(() => {
      addTab('p1', makeTab('A'));
      addTab('p1', makeTab('B'));
      activateTab('p1', 'A');
    });

    const { result } = renderHook(() => useEditorGroupLayout('p1'));
    expect(result.current.leftActiveTabId).toBe('A');
    expect(result.current.leftTabs.map((t) => t.id)).toEqual(['A', 'B']);

    // Close the active tab through the real UI path (cache cleanup + store).
    act(() => {
      closeEditorTab('p1', 'A');
    });

    // The content area derives `activeTab` from leftActiveTabId — it must point
    // at a tab that still exists, otherwise the pane renders a blank area.
    expect(result.current.leftActiveTabId).toBe('B');
    expect(result.current.leftTabs.map((t) => t.id)).toEqual(['B']);
    expect(useEditorStore.getState().activeTabId).toBe('B');
  });

  it('single group: closing a non-active tab keeps the active tab intact', () => {
    const { addTab, activateTab } = useEditorStore.getState();
    act(() => {
      addTab('p1', makeTab('A'));
      addTab('p1', makeTab('B'));
      addTab('p1', makeTab('C'));
      activateTab('p1', 'B');
    });

    act(() => {
      closeEditorTab('p1', 'A');
    });

    expect(useEditorStore.getState().tabs['p1'].activeTabId).toBe('B');
    const { result } = renderHook(() => useEditorGroupLayout('p1'));
    expect(result.current.leftActiveTabId).toBe('B');
    expect(result.current.leftTabs.map((t) => t.id)).toEqual(['B', 'C']);
  });

  it('split: closing the last tab of the active group keeps the other group rendering', () => {
    const store = useEditorStore.getState();
    act(() => {
      store.addTab('p1', makeTab('A'));
      store.addTab('p1', makeTab('B'));
      store.activateTab('p1', 'A');
      store.splitRight('p1', 'A');
      store.activateTab('p1', 'B');
    });

    // left: [B], right: [A]
    act(() => {
      closeEditorTab('p1', 'A');
    });

    const layout = useEditorStore.getState().editorLayout['p1'];
    expect(layout.isSplit).toBe(false);
    expect(layout.groups.left.tabIds).toEqual(['B']);
    expect(layout.groups.left.activeTabId).toBe('B');
    expect(useEditorStore.getState().activeTabId).toBe('B');
  });
});
