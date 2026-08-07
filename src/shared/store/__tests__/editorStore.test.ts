import { beforeEach, describe, expect, it } from 'vitest';

import type { EditorSplitLayout, Tab } from '@/shared/types';
import { createDefaultEditorLayout } from '@/shared/types/editorGroup';

import { useEditorStore } from '../editorStore';

function makeTab(id: string): Tab {
  return {
    id,
    projectId: 'p1',
    title: id,
    order: 0,
    data: { kind: 'file', filePath: id, fileName: id, content: '', isDirty: false },
  };
}

function splitLayout(
  leftIds: string[],
  rightIds: string[],
  leftActive: string,
  rightActive: string,
): EditorSplitLayout {
  const layout = createDefaultEditorLayout();
  layout.isSplit = true;
  layout.activeGroupId = 'right';
  layout.groups.left = { tabIds: leftIds, activeTabId: leftActive };
  layout.groups.right = { tabIds: rightIds, activeTabId: rightActive };
  return layout;
}

function seedState(layout: EditorSplitLayout, tabs: Tab[], globalActive: string) {
  useEditorStore.setState({
    tabs: { p1: { tabs, activeTabId: globalActive } },
    editorLayout: { p1: layout },
    activeTabId: globalActive,
  });
}

describe('editorStore.closeTab — split layout active switch', () => {
  beforeEach(() => {
    useEditorStore.setState({
      tabs: {},
      editorLayout: {},
      activeTabId: null,
    });
  });

  it('closing a group active tab (not global active) keeps that group on a valid adjacent tab', () => {
    // left: [A, B] active=A ; right: [C] active=C ; global active=C
    const layout = splitLayout(['A', 'B'], ['C'], 'A', 'C');
    seedState(layout, [makeTab('A'), makeTab('B'), makeTab('C')], 'C');

    useEditorStore.getState().closeTab('p1', 'A');

    const next = useEditorStore.getState().editorLayout['p1'];
    expect(next.groups.left.tabIds).toEqual(['B']);
    // left group must NOT point at C (belongs to right group) → would render blank
    expect(next.groups.left.activeTabId).toBe('B');
    expect(next.groups.right.activeTabId).toBe('C');
    expect(useEditorStore.getState().activeTabId).toBe('C');
  });

  it('closing the right group active tab keeps right group valid', () => {
    // left: [A] active=A ; right: [B, C] active=C ; global active=A
    const layout = splitLayout(['A'], ['B', 'C'], 'A', 'C');
    seedState(layout, [makeTab('A'), makeTab('B'), makeTab('C')], 'A');

    useEditorStore.getState().closeTab('p1', 'C');

    const next = useEditorStore.getState().editorLayout['p1'];
    expect(next.groups.right.tabIds).toEqual(['B']);
    expect(next.groups.right.activeTabId).toBe('B');
    expect(next.groups.left.activeTabId).toBe('A');
    expect(useEditorStore.getState().activeTabId).toBe('A');
  });

  it('closing the global active tab switches to the adjacent tab in the same group', () => {
    const layout = splitLayout(['A', 'B'], ['C', 'D'], 'B', 'D');
    seedState(layout, [makeTab('A'), makeTab('B'), makeTab('C'), makeTab('D')], 'B');

    useEditorStore.getState().closeTab('p1', 'B');

    const next = useEditorStore.getState().editorLayout['p1'];
    expect(next.groups.left.activeTabId).toBe('A');
    expect(useEditorStore.getState().activeTabId).toBe('A');
  });
});
