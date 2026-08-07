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

describe('editorStore.pinTab — 多 pinned tabs 追加语义', () => {
  beforeEach(() => {
    useEditorStore.setState({
      tabs: {},
      editorLayout: {},
      activeTabId: null,
    });
  });

  it('pin 第一个 tab：从 left 移除并加入 pinnedTabIds', () => {
    const layout = createDefaultEditorLayout();
    layout.groups.left = { tabIds: ['A', 'B'], activeTabId: 'A' };
    seedState(layout, [makeTab('A'), makeTab('B')], 'A');

    useEditorStore.getState().pinTab('p1', 'A');

    const next = useEditorStore.getState().editorLayout['p1'];
    expect(next.pinnedTabIds).toEqual(['A']);
    expect(next.pinnedActiveTabId).toBe('A');
    expect(next.groups.left.tabIds).toEqual(['B']);
  });

  it('已有 pinned 时再 pin 新 tab：追加而非替换', () => {
    const layout = createDefaultEditorLayout();
    layout.pinnedTabIds = ['A'];
    layout.pinnedActiveTabId = 'A';
    layout.groups.left = { tabIds: ['B'], activeTabId: 'B' };
    seedState(layout, [makeTab('A'), makeTab('B')], 'B');

    useEditorStore.getState().pinTab('p1', 'B');

    const next = useEditorStore.getState().editorLayout['p1'];
    expect(next.pinnedTabIds).toEqual(['A', 'B']);
    expect(next.pinnedActiveTabId).toBe('B');
    expect(next.groups.left.tabIds).toEqual([]);
  });

  it('已 pin 的 tab 再次 pin：保持原有列表（幂等）', () => {
    const layout = createDefaultEditorLayout();
    layout.pinnedTabIds = ['A'];
    layout.pinnedActiveTabId = 'A';
    layout.groups.left = { tabIds: ['B'], activeTabId: 'B' };
    seedState(layout, [makeTab('A'), makeTab('B')], 'B');

    useEditorStore.getState().pinTab('p1', 'A');

    const next = useEditorStore.getState().editorLayout['p1'];
    expect(next.pinnedTabIds).toEqual(['A']);
    expect(next.groups.left.tabIds).toEqual(['B']);
  });
});

describe('editorStore.unpinTab — 按 tab 移除并放回 left', () => {
  beforeEach(() => {
    useEditorStore.setState({
      tabs: {},
      editorLayout: {},
      activeTabId: null,
    });
  });

  it('unpin 指定 tab：从 pinnedTabIds 移除，放回 left 组首部', () => {
    const layout = createDefaultEditorLayout();
    layout.pinnedTabIds = ['A', 'B'];
    layout.pinnedActiveTabId = 'B';
    layout.groups.left = { tabIds: ['C'], activeTabId: 'C' };
    seedState(layout, [makeTab('A'), makeTab('B'), makeTab('C')], 'B');

    useEditorStore.getState().unpinTab('p1', 'A');

    const next = useEditorStore.getState().editorLayout['p1'];
    expect(next.pinnedTabIds).toEqual(['B']);
    expect(next.groups.left.tabIds).toEqual(['A', 'C']);
  });

  it('unpin 当前激活的 pinned：pinnedActiveTabId 指向剩余的第一个', () => {
    const layout = createDefaultEditorLayout();
    layout.pinnedTabIds = ['A', 'B'];
    layout.pinnedActiveTabId = 'A';
    layout.groups.left = { tabIds: [], activeTabId: null };
    seedState(layout, [makeTab('A'), makeTab('B')], 'A');

    useEditorStore.getState().unpinTab('p1', 'A');

    const next = useEditorStore.getState().editorLayout['p1'];
    expect(next.pinnedTabIds).toEqual(['B']);
    expect(next.pinnedActiveTabId).toBe('B');
    expect(next.groups.left.tabIds).toEqual(['A']);
  });
});

describe('editorStore.activateTab — pinned tab 激活', () => {
  beforeEach(() => {
    useEditorStore.setState({
      tabs: {},
      editorLayout: {},
      activeTabId: null,
    });
  });

  it('激活 pinned tab：只更新 pinnedActiveTabId，不把 tab 加入 left/right 组', () => {
    const layout = createDefaultEditorLayout();
    layout.pinnedTabIds = ['A', 'B'];
    layout.pinnedActiveTabId = 'A';
    layout.groups.left = { tabIds: ['C'], activeTabId: 'C' };
    seedState(layout, [makeTab('A'), makeTab('B'), makeTab('C')], 'C');

    useEditorStore.getState().activateTab('p1', 'B');

    const next = useEditorStore.getState().editorLayout['p1'];
    expect(next.pinnedActiveTabId).toBe('B');
    expect(next.groups.left.tabIds).toEqual(['C']);
    expect(next.groups.right.tabIds).toEqual([]);
  });
});
