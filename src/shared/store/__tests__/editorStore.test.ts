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

describe('editorStore.updateTab — browser 标题/favicon 同步', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: {}, editorLayout: {}, activeTabId: null });
  });

  function seedBrowserTab() {
    useEditorStore.getState().addTab('p1', {
      id: 'tb1',
      projectId: 'p1',
      title: 'Browser',
      order: 0,
      data: { kind: 'browser', url: 'https://a.com' },
    });
  }

  it('同时更新浏览器 tab 顶层标题与 data.favicon', () => {
    seedBrowserTab();
    useEditorStore.getState().updateTab('p1', 'tb1', {
      title: 'GitHub',
      favicon: 'https://a.com/favicon.ico',
    });

    const tab = useEditorStore.getState().tabs['p1']!.tabs.find((t) => t.id === 'tb1')!;
    expect(tab.title).toBe('GitHub');
    expect(tab.data).toMatchObject({
      kind: 'browser',
      url: 'https://a.com',
      favicon: 'https://a.com/favicon.ico',
    });
  });

  it('仅更新 favicon 时保留 url', () => {
    seedBrowserTab();
    useEditorStore.getState().updateTab('p1', 'tb1', { favicon: 'https://a.com/fav.png' });

    const tab = useEditorStore.getState().tabs['p1']!.tabs.find((t) => t.id === 'tb1')!;
    expect(tab.data).toMatchObject({
      kind: 'browser',
      url: 'https://a.com',
      favicon: 'https://a.com/fav.png',
    });
  });
});

describe('editorStore.unpinTabTo — 拖拽 unpin 到指定组', () => {
  beforeEach(() => {
    useEditorStore.setState({
      tabs: {},
      editorLayout: {},
      activeTabId: null,
    });
  });

  it('拖到 left 组某 tab 上：从 pinned 移除，插到 over tab 之前', () => {
    const layout = createDefaultEditorLayout();
    layout.pinnedTabIds = ['A', 'B'];
    layout.pinnedActiveTabId = 'A';
    layout.groups.left = { tabIds: ['C', 'D'], activeTabId: 'C' };
    seedState(layout, [makeTab('A'), makeTab('B'), makeTab('C'), makeTab('D')], 'A');

    useEditorStore.getState().unpinTabTo('p1', 'A', 'left', 'D');

    const next = useEditorStore.getState().editorLayout['p1'];
    expect(next.pinnedTabIds).toEqual(['B']);
    expect(next.groups.left.tabIds).toEqual(['C', 'A', 'D']);
  });

  it('拖入的 tab 成为目标组激活 tab', () => {
    const layout = createDefaultEditorLayout();
    layout.pinnedTabIds = ['A'];
    layout.pinnedActiveTabId = 'A';
    layout.groups.left = { tabIds: ['C'], activeTabId: 'C' };
    seedState(layout, [makeTab('A'), makeTab('C')], 'A');

    useEditorStore.getState().unpinTabTo('p1', 'A', 'left', 'C');

    const next = useEditorStore.getState().editorLayout['p1'];
    expect(next.groups.left.activeTabId).toBe('A');
  });

  it('被拖 tab 是 pinnedActiveTabId 时交接给剩余第一个', () => {
    const layout = createDefaultEditorLayout();
    layout.pinnedTabIds = ['A', 'B'];
    layout.pinnedActiveTabId = 'A';
    layout.groups.left = { tabIds: ['C'], activeTabId: 'C' };
    seedState(layout, [makeTab('A'), makeTab('B'), makeTab('C')], 'A');

    useEditorStore.getState().unpinTabTo('p1', 'A', 'left', 'C');

    const next = useEditorStore.getState().editorLayout['p1'];
    expect(next.pinnedActiveTabId).toBe('B');
  });

  it('overId 为 null → 追加到目标组尾部', () => {
    const layout = createDefaultEditorLayout();
    layout.pinnedTabIds = ['A'];
    layout.pinnedActiveTabId = 'A';
    layout.groups.left = { tabIds: ['C', 'D'], activeTabId: 'C' };
    seedState(layout, [makeTab('A'), makeTab('C'), makeTab('D')], 'A');

    useEditorStore.getState().unpinTabTo('p1', 'A', 'left', null);

    const next = useEditorStore.getState().editorLayout['p1'];
    expect(next.groups.left.tabIds).toEqual(['C', 'D', 'A']);
  });

  it('tab 不在 pinned → 幂等返回原 layout', () => {
    const layout = createDefaultEditorLayout();
    layout.pinnedTabIds = ['B'];
    layout.pinnedActiveTabId = 'B';
    layout.groups.left = { tabIds: ['C'], activeTabId: 'C' };
    seedState(layout, [makeTab('A'), makeTab('B'), makeTab('C')], 'B');

    useEditorStore.getState().unpinTabTo('p1', 'A', 'left', 'C');

    const next = useEditorStore.getState().editorLayout['p1'];
    expect(next.pinnedTabIds).toEqual(['B']);
    expect(next.groups.left.tabIds).toEqual(['C']);
  });

  it('unpin 后 pinned 清空、目标组是 right 时 isSplit 保持', () => {
    const layout = createDefaultEditorLayout();
    layout.isSplit = true;
    layout.pinnedTabIds = ['A'];
    layout.pinnedActiveTabId = 'A';
    layout.groups.left = { tabIds: ['C'], activeTabId: 'C' };
    layout.groups.right = { tabIds: ['D'], activeTabId: 'D' };
    seedState(layout, [makeTab('A'), makeTab('C'), makeTab('D')], 'A');

    useEditorStore.getState().unpinTabTo('p1', 'A', 'right', 'D');

    const next = useEditorStore.getState().editorLayout['p1'];
    expect(next.pinnedTabIds).toEqual([]);
    expect(next.isSplit).toBe(true);
    expect(next.groups.right.tabIds).toEqual(['A', 'D']);
    expect(next.groups.left.tabIds).toEqual(['C']);
  });
});

describe('editorStore.addTab — targetGroup 指定落组（pane 内 + 创建跟随发起面板）', () => {
  beforeEach(() => {
    useEditorStore.setState({
      tabs: {},
      editorLayout: {},
      activeTabId: null,
    });
  });

  function seedTwoGroups() {
    const layout = createDefaultEditorLayout();
    layout.isSplit = true;
    layout.groups.left = { tabIds: ['L1'], activeTabId: 'L1' };
    layout.groups.right = { tabIds: ['R1'], activeTabId: 'R1' };
    // 激活组为 right：缺省落组行为（回归基准）
    layout.activeGroupId = 'right';
    seedState(layout, [makeTab('L1'), makeTab('R1')], 'R1');
  }

  function makeNewTab(id: string): Tab {
    return {
      id,
      projectId: 'p1',
      title: id,
      order: 99,
      data: { kind: 'browser', url: '' },
    };
  }

  it("targetGroup='pinned' → 落 pinnedTabIds 并激活 pinned，groups 不含它", () => {
    seedTwoGroups();
    useEditorStore.getState().addTab('p1', makeNewTab('NEW'), 'pinned');

    const next = useEditorStore.getState().editorLayout['p1'];
    expect(next.pinnedTabIds).toEqual(['NEW']);
    expect(next.pinnedActiveTabId).toBe('NEW');
    expect(next.groups.left.tabIds).toEqual(['L1']);
    expect(next.groups.right.tabIds).toEqual(['R1']);
    expect(useEditorStore.getState().activeTabId).toBe('NEW');
  });

  it("targetGroup='left' → 落 left 组并激活（即使激活组是 right）", () => {
    seedTwoGroups();
    useEditorStore.getState().addTab('p1', makeNewTab('NEW'), 'left');

    const next = useEditorStore.getState().editorLayout['p1'];
    expect(next.groups.left.tabIds).toEqual(['L1', 'NEW']);
    expect(next.groups.left.activeTabId).toBe('NEW');
    expect(next.groups.right.tabIds).toEqual(['R1']);
  });

  it("targetGroup='right' → 落 right 组并激活", () => {
    seedTwoGroups();
    useEditorStore.getState().addTab('p1', makeNewTab('NEW'), 'right');

    const next = useEditorStore.getState().editorLayout['p1'];
    expect(next.groups.right.tabIds).toEqual(['R1', 'NEW']);
    expect(next.groups.right.activeTabId).toBe('NEW');
  });

  it('缺省 targetGroup → 保持现状落到 activeGroupId（回归保护）', () => {
    seedTwoGroups();
    useEditorStore.getState().addTab('p1', makeNewTab('NEW'));

    const next = useEditorStore.getState().editorLayout['p1'];
    expect(next.groups.right.tabIds).toEqual(['R1', 'NEW']);
    expect(next.groups.left.tabIds).toEqual(['L1']);
    expect(next.pinnedTabIds).toEqual([]);
  });

  it("targetGroup='pinned' 且布局已有 pinned tab → 追加不替换", () => {
    const layout = createDefaultEditorLayout();
    layout.pinnedTabIds = ['P1'];
    layout.pinnedActiveTabId = 'P1';
    layout.groups.left = { tabIds: ['L1'], activeTabId: 'L1' };
    seedState(layout, [makeTab('P1'), makeTab('L1')], 'L1');

    useEditorStore.getState().addTab('p1', makeNewTab('NEW'), 'pinned');

    const next = useEditorStore.getState().editorLayout['p1'];
    expect(next.pinnedTabIds).toEqual(['P1', 'NEW']);
    expect(next.pinnedActiveTabId).toBe('NEW');
  });
});
