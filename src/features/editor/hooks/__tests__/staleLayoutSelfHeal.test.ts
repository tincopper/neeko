// Regression: a layout that EXISTS in the store but whose group activeTabId is
// stale (null, or pointing at a removed tab) must self-heal in the UI seam.
//
// The blank-content-area bug: EditorGroupPane derives `activeTab` from
// `layout.groups.left.activeTabId`; when that id doesn't match any live tab
// the content area renders nothing while the tab bar still shows the tabs —
// exactly the DOM the user reported (two agent tabs, none selected, empty pane).
//
// `useEditorGroupLayout` previously returned the raw layout as-is, so any path
// that left a stale activeTabId behind (session restore, legacy state, split
// juggling) produced a permanent blank area. The fallback path only repaired
// the NO-layout case; this tests the layout-EXISTS-but-stale case.
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useEditorStore } from '@/shared/store/editorStore';
import type { Tab } from '@/shared/types';
import { createDefaultEditorLayout } from '@/shared/types/editorGroup';

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

function seedLayout(tabIds: string[], activeTabId: string | null) {
  const layout = createDefaultEditorLayout();
  layout.groups.left.tabIds = tabIds;
  layout.groups.left.activeTabId = activeTabId;
  useEditorStore.setState({
    tabs: {
      p1: {
        tabs: tabIds.map((id) => makeTab(id)),
        activeTabId: activeTabId ?? tabIds[tabIds.length - 1] ?? null,
      },
    },
    editorLayout: { p1: layout },
    activeTabId: activeTabId,
  });
}

describe('stale layout → group activeTabId self-heals to a live tab (blank content regression)', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: {}, editorLayout: {}, activeTabId: null });
  });

  it('existing layout with null activeTabId still resolves a live tab', () => {
    seedLayout(['A', 'B'], null);

    const { result } = renderHook(() => useEditorGroupLayout('p1'));

    expect(result.current.leftTabs.map((t) => t.id)).toEqual(['A', 'B']);
    expect(result.current.leftActiveTabId).not.toBeNull();
    expect(result.current.leftTabs.some((t) => t.id === result.current.leftActiveTabId)).toBe(true);
  });

  it('existing layout whose activeTabId points at a removed tab falls back to a live tab', () => {
    // Layout says active = 'C', but C was closed and only A/B remain.
    seedLayout(['A', 'B'], 'C');

    const { result } = renderHook(() => useEditorGroupLayout('p1'));

    expect(result.current.leftActiveTabId).not.toBe('C');
    expect(result.current.leftTabs.some((t) => t.id === result.current.leftActiveTabId)).toBe(true);
  });

  it('existing layout whose tabIds still lists a removed tab heals to a live tab', () => {
    // Layout tabIds = [A, B, C] but C was removed from the store tabs.
    const layout = createDefaultEditorLayout();
    layout.groups.left.tabIds = ['A', 'B', 'C'];
    layout.groups.left.activeTabId = 'C';
    useEditorStore.setState({
      tabs: { p1: { tabs: [makeTab('A'), makeTab('B')], activeTabId: 'B' } },
      editorLayout: { p1: layout },
      activeTabId: 'B',
    });

    const { result } = renderHook(() => useEditorGroupLayout('p1'));

    expect(result.current.leftTabs.map((t) => t.id)).toEqual(['A', 'B']);
    expect(result.current.leftActiveTabId).not.toBe('C');
    expect(result.current.leftTabs.some((t) => t.id === result.current.leftActiveTabId)).toBe(true);
  });

  it('empty layout with no tabs keeps activeTabId null', () => {
    seedLayout([], null);

    const { result } = renderHook(() => useEditorGroupLayout('p1'));

    expect(result.current.leftTabs).toEqual([]);
    expect(result.current.leftActiveTabId).toBeNull();
  });

  it('split layout: each stale group heals to a live tab in its own group', () => {
    // left: [A, B] active = 'X' (removed) ; right: [C, D] active = null.
    const layout = createDefaultEditorLayout();
    layout.isSplit = true;
    layout.activeGroupId = 'right';
    layout.groups.left = { tabIds: ['A', 'B'], activeTabId: 'X' };
    layout.groups.right = { tabIds: ['C', 'D'], activeTabId: null };
    useEditorStore.setState({
      tabs: {
        p1: {
          tabs: [makeTab('A'), makeTab('B'), makeTab('C'), makeTab('D')],
          activeTabId: 'B',
        },
      },
      editorLayout: { p1: layout },
      activeTabId: 'B',
    });

    const { result } = renderHook(() => useEditorGroupLayout('p1'));

    // left group heals to store active 'B'; right group falls back to last live tab.
    expect(result.current.leftActiveTabId).toBe('B');
    expect(result.current.rightActiveTabId).toBe('D');
    expect(result.current.leftTabs.some((t) => t.id === result.current.leftActiveTabId)).toBe(true);
    expect(result.current.rightTabs.some((t) => t.id === result.current.rightActiveTabId)).toBe(
      true,
    );
  });

  it('pinned tabs: removed pinned ids are filtered and pinnedActiveTabId falls back', () => {
    // pinned = [P, R] (R removed) ; pinnedActiveTabId = R (removed) → falls back to P.
    const layout = createDefaultEditorLayout();
    layout.pinnedTabIds = ['P', 'R'];
    layout.pinnedActiveTabId = 'R';
    layout.groups.left = { tabIds: ['A'], activeTabId: 'A' };
    useEditorStore.setState({
      tabs: {
        p1: {
          tabs: [makeTab('P'), makeTab('A')],
          activeTabId: 'P',
        },
      },
      editorLayout: { p1: layout },
      activeTabId: 'P',
    });

    const { result } = renderHook(() => useEditorGroupLayout('p1'));

    expect(result.current.pinnedTabs.map((t) => t.id)).toEqual(['P']);
    expect(result.current.pinnedActiveTabId).toBe('P');
    expect(result.current.leftActiveTabId).toBe('A');
  });

  it('healthy layout returns the raw layout reference unchanged (no healing)', () => {
    const layout = createDefaultEditorLayout();
    layout.groups.left = { tabIds: ['A', 'B'], activeTabId: 'A' };
    useEditorStore.setState({
      tabs: { p1: { tabs: [makeTab('A'), makeTab('B')], activeTabId: 'A' } },
      editorLayout: { p1: layout },
      activeTabId: 'A',
    });

    const { result } = renderHook(() => useEditorGroupLayout('p1'));

    expect(result.current.leftActiveTabId).toBe('A');
    // No staleness → the memo must return the very same layout object,
    // keeping React re-render bailing out on unchanged reference.
    expect(result.current.layout).toBe(layout);
  });
});
