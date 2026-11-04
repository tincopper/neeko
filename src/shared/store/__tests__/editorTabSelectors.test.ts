// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { ProjectTabs, Tab } from '@/shared/types';
import { createDefaultEditorLayout } from '@/shared/types/editorGroup';

import {
  selectActiveTab,
  selectActiveTabId,
  selectActiveSessionRefs,
  selectOrderedTabIds,
  selectOrderedTabs,
  type EditorTabSpaceState,
} from '../editorTabSelectors';

const SPACE = 'p1\0';

function mkTab(id: string): Tab {
  return {
    id,
    scope: { kind: 'app' },
    title: id,
    data: { kind: 'file', filePath: id, fileName: id, content: '', isDirty: false },
  };
}

function stateWith(
  tabIds: string[],
  groups: {
    left: string[];
    right: string[];
    pinned: string[];
    active: 'left' | 'right';
    dockedLeft?: string[];
    dockedRight?: string[];
  },
): EditorTabSpaceState {
  const layout = createDefaultEditorLayout();
  layout.activeGroupId = groups.active;
  layout.isSplit = groups.right.length > 0;
  layout.groups.left = { tabIds: groups.left, activeTabId: groups.left[0] ?? null };
  layout.groups.right = { tabIds: groups.right, activeTabId: groups.right[0] ?? null };
  layout.pinnedTabIds = groups.pinned;
  layout.pinnedActiveTabId = groups.pinned[0] ?? null;
  layout.docked.left = {
    tabIds: groups.dockedLeft ?? [],
    activeTabId: groups.dockedLeft?.[0] ?? null,
  };
  layout.docked.right = {
    tabIds: groups.dockedRight ?? [],
    activeTabId: groups.dockedRight?.[0] ?? null,
  };
  const projectTabs: ProjectTabs = { tabs: tabIds.map(mkTab) };
  return { tabs: { [SPACE]: projectTabs }, editorLayout: { [SPACE]: layout } };
}

describe('selectOrderedTabIds / selectOrderedTabs', () => {
  it('顺序 = left → right → pinned（视觉顺序即仲裁顺序）', () => {
    const state = stateWith(['A', 'B', 'C', 'D', 'P'], {
      left: ['A', 'B'],
      right: ['C', 'D'],
      pinned: ['P'],
      active: 'right',
    });
    expect(selectOrderedTabIds(state, SPACE)).toEqual(['A', 'B', 'C', 'D', 'P']);
  });

  it('顺序追加 docked.left → docked.right（停靠的 tab 仍在仲裁集里）', () => {
    const state = stateWith(['A', 'B', 'P', 'DL', 'DR'], {
      left: ['A'],
      right: ['B'],
      pinned: ['P'],
      dockedLeft: ['DL'],
      dockedRight: ['DR'],
      active: 'left',
    });
    expect(selectOrderedTabIds(state, SPACE)).toEqual(['A', 'B', 'P', 'DL', 'DR']);
  });

  it('G2：仲裁顺序覆盖全部 tab（长度相等、无重复、集合相等）', () => {
    const state = stateWith(['A', 'B', 'P', 'DL1', 'DL2', 'DR'], {
      left: ['A'],
      right: ['B'],
      pinned: ['P'],
      dockedLeft: ['DL1', 'DL2'],
      dockedRight: ['DR'],
      active: 'left',
    });
    const ordered = selectOrderedTabIds(state, SPACE);
    const all = state.tabs[SPACE]!.tabs.map((t) => t.id);
    expect(ordered).toHaveLength(all.length);
    expect(new Set(ordered).size).toBe(ordered.length);
    expect([...ordered].sort()).toEqual([...all].sort());
  });

  it('selectOrderedTabs 投影成 Tab 并保持顺序', () => {
    const state = stateWith(['A', 'B', 'C'], {
      left: ['C', 'A'],
      right: [],
      pinned: ['B'],
      active: 'left',
    });
    expect(selectOrderedTabs(state, SPACE).map((t) => t.id)).toEqual(['C', 'A', 'B']);
  });

  it('跳过 layout 里已失效的 id（heal 语义：关闭后残留的 id 不产出）', () => {
    const state = stateWith(['A', 'B'], {
      left: ['A', 'GONE'],
      right: ['B'],
      pinned: ['ALSO_GONE'],
      active: 'left',
    });
    expect(selectOrderedTabIds(state, SPACE)).toEqual(['A', 'GONE', 'B', 'ALSO_GONE']);
    expect(selectOrderedTabs(state, SPACE).map((t) => t.id)).toEqual(['A', 'B']);
  });

  it('未知空间 / 缺 layout → 空数组', () => {
    const empty: EditorTabSpaceState = { tabs: {}, editorLayout: {} };
    expect(selectOrderedTabIds(empty, 'missing')).toEqual([]);
    expect(selectOrderedTabs(empty, 'missing')).toEqual([]);
  });
});

describe('selectActiveTabId — 前台 = 激活编辑器组的激活 tab', () => {
  it('激活组为 left → 取 left 的 activeTabId', () => {
    const layout = createDefaultEditorLayout();
    layout.activeGroupId = 'left';
    layout.groups.left = { tabIds: ['A', 'B'], activeTabId: 'B' };
    layout.groups.right = { tabIds: ['C'], activeTabId: 'C' };
    const state: EditorTabSpaceState = {
      tabs: { [SPACE]: { tabs: [mkTab('A'), mkTab('B'), mkTab('C')] } },
      editorLayout: { [SPACE]: layout },
    };
    expect(selectActiveTabId(state, SPACE)).toBe('B');
  });

  it('换组 → 取该组的 activeTabId', () => {
    const layout = createDefaultEditorLayout();
    layout.activeGroupId = 'right';
    layout.groups.left = { tabIds: ['A'], activeTabId: 'A' };
    layout.groups.right = { tabIds: ['C'], activeTabId: 'C' };
    const state: EditorTabSpaceState = {
      tabs: { [SPACE]: { tabs: [mkTab('A'), mkTab('C')] } },
      editorLayout: { [SPACE]: layout },
    };
    expect(selectActiveTabId(state, SPACE)).toBe('C');
  });

  it('**pinned 激活态不影响组前台**（正交：pinned 是参照面板，不是当前工作 tab）', () => {
    const layout = createDefaultEditorLayout();
    layout.activeGroupId = 'left';
    layout.groups.left = { tabIds: ['A'], activeTabId: 'A' };
    layout.pinnedTabIds = ['P'];
    layout.pinnedActiveTabId = 'P';
    const state: EditorTabSpaceState = {
      tabs: { [SPACE]: { tabs: [mkTab('A'), mkTab('P')] } },
      editorLayout: { [SPACE]: layout },
    };
    expect(selectActiveTabId(state, SPACE)).toBe('A');
  });

  it('缺 layout / 未知空间 → null（优雅降级；I1 保证生产中不可达）', () => {
    const empty: EditorTabSpaceState = { tabs: {}, editorLayout: {} };
    expect(selectActiveTabId(empty, SPACE)).toBeNull();
    expect(selectActiveTabId(empty, 'missing')).toBeNull();
  });
});

describe('selectActiveTab — 前台 Tab 对象', () => {
  it('返回激活组的激活 tab 对象；已失效 id → null', () => {
    const layout = createDefaultEditorLayout();
    layout.activeGroupId = 'left';
    layout.groups.left = { tabIds: ['A', 'B'], activeTabId: 'B' };
    const state: EditorTabSpaceState = {
      tabs: { [SPACE]: { tabs: [mkTab('A'), mkTab('B')] } },
      editorLayout: { [SPACE]: layout },
    };
    expect(selectActiveTab(state, SPACE)?.id).toBe('B');

    // 激活位指向已从注册表移除的 id → null（不产出幽灵 tab）
    layout.groups.left = { tabIds: ['A'], activeTabId: 'GONE' };
    const stale: EditorTabSpaceState = {
      tabs: { [SPACE]: { tabs: [mkTab('A')] } },
      editorLayout: { [SPACE]: layout },
    };
    expect(selectActiveTab(stale, SPACE)).toBeNull();
  });
});

describe('selectActiveSessionRefs', () => {
  /** 由一个前台 tab 的数据构造「单单元、单 tab」状态。 */
  function stateWithActive(data: Tab['data'], tabKey = SPACE): EditorTabSpaceState {
    const layout = createDefaultEditorLayout();
    const tab: Tab = { id: 'tab-1', scope: { kind: 'app' }, title: 't', data };
    layout.groups.left = { tabIds: [tab.id], activeTabId: tab.id };
    return { tabs: { [tabKey]: { tabs: [tab] } }, editorLayout: { [tabKey]: layout } };
  }

  it('前台是终端会话（有 ptySessionId）⇒ 该单元计入', () => {
    const state = stateWithActive({ kind: 'terminal', agentId: null, ptySessionId: 'pty-1' });
    expect(selectActiveSessionRefs(state)).toEqual([
      { workspaceKey: SPACE, kind: 'terminal', sessionId: 'pty-1' },
    ]);
  });

  it('前台是 agent chat 会话（有 sessionId）⇒ 该单元计入', () => {
    const state = stateWithActive({ kind: 'agent-chat', sessionId: 'chat-1' });
    expect(selectActiveSessionRefs(state)).toEqual([
      { workspaceKey: SPACE, kind: 'chat', sessionId: 'chat-1' },
    ]);
  });

  it('会话 tab 但还没铸造 id（PTY 未创建）⇒ 不计入（子行也没被高亮）', () => {
    expect(selectActiveSessionRefs(stateWithActive({ kind: 'terminal', agentId: null }))).toEqual(
      [],
    );
    expect(selectActiveSessionRefs(stateWithActive({ kind: 'agent-chat' }))).toEqual([]);
  });

  it('前台是文件 tab ⇒ 不计入（父行保留自己的选中底色）', () => {
    expect(selectActiveSessionRefs(stateWithActive(mkTab('f').data))).toEqual([]);
  });

  it('停靠在 dock 宿主前台的会话仍计入（停靠不改「当前会话」这一事实）', () => {
    const layout = createDefaultEditorLayout();
    const center: Tab = { id: 'file-1', scope: { kind: 'app' }, title: 'f', data: mkTab('f').data };
    const docked: Tab = {
      id: 'chat-1',
      scope: { kind: 'app' },
      title: 'c',
      data: { kind: 'agent-chat', sessionId: 'chat-1' },
    };
    layout.groups.left = { tabIds: [center.id], activeTabId: center.id };
    layout.docked.right = { tabIds: [docked.id], activeTabId: docked.id };
    const state: EditorTabSpaceState = {
      tabs: { [SPACE]: { tabs: [center, docked] } },
      editorLayout: { [SPACE]: layout },
    };
    expect(selectActiveSessionRefs(state)).toEqual([
      { workspaceKey: SPACE, kind: 'chat', sessionId: 'chat-1' },
    ]);
  });

  it('多个单元时按 key 排序，供稳定快照比较', () => {
    const a: EditorTabSpaceState = stateWithActive(
      { kind: 'terminal', agentId: null, ptySessionId: 'p-a' },
      'p-a\0',
    );
    const b: EditorTabSpaceState = stateWithActive(
      { kind: 'terminal', agentId: null, ptySessionId: 'p-b' },
      'p-b\0',
    );
    const merged: EditorTabSpaceState = {
      tabs: { ...b.tabs, ...a.tabs },
      editorLayout: { ...b.editorLayout, ...a.editorLayout },
    };
    expect(selectActiveSessionRefs(merged).map((ref) => ref.workspaceKey)).toEqual([
      'p-a\0',
      'p-b\0',
    ]);
  });
});
