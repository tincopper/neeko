// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { ProjectTabs, Tab } from '@/shared/types';
import { createDefaultEditorLayout } from '@/shared/types/editorGroup';

import {
  countDockedTabs,
  hasCenterTabs,
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

describe('hasCenterTabs — 中心画面是否有东西可渲染', () => {
  /** 只构造 registry + layout（docked 组与中心组各自独立设定）。 */
  function nestedState(args: {
    left?: string[];
    right?: string[];
    pinned?: string[];
    dockedLeft?: string[];
    dockedRight?: string[];
    /** 覆盖注册表内容（缺省 = 布局里所有 id 都活着）；用空数组模拟「布局残留已关闭 tab 的 id」。 */
    registryIds?: string[];
    skipLayout?: boolean;
  }): EditorTabSpaceState {
    const layout = createDefaultEditorLayout();
    layout.groups.left = { tabIds: args.left ?? [], activeTabId: args.left?.[0] ?? null };
    layout.groups.right = { tabIds: args.right ?? [], activeTabId: args.right?.[0] ?? null };
    layout.isSplit = (args.right ?? []).length > 0;
    layout.pinnedTabIds = args.pinned ?? [];
    layout.pinnedActiveTabId = args.pinned?.[0] ?? null;
    layout.docked.left = {
      tabIds: args.dockedLeft ?? [],
      activeTabId: args.dockedLeft?.[0] ?? null,
    };
    layout.docked.right = {
      tabIds: args.dockedRight ?? [],
      activeTabId: args.dockedRight?.[0] ?? null,
    };
    const allIds = [
      ...(args.left ?? []),
      ...(args.right ?? []),
      ...(args.pinned ?? []),
      ...(args.dockedLeft ?? []),
      ...(args.dockedRight ?? []),
    ];
    const registryIds = args.registryIds ?? allIds;
    return {
      tabs: { [SPACE]: { tabs: registryIds.map(mkTab) } },
      editorLayout: args.skipLayout ? {} : { [SPACE]: layout },
    };
  }

  it('只有 docked.left → false（停靠的 tab 由宿主渲染，不改变中心区形态）', () => {
    expect(hasCenterTabs(nestedState({ dockedLeft: ['DL'] }), SPACE)).toBe(false);
  });

  it('只有 docked.right → false（terminal 默认停靠后被误判为「中心区有 tab」的回归点）', () => {
    expect(hasCenterTabs(nestedState({ dockedRight: ['DR'] }), SPACE)).toBe(false);
  });

  it('docked 两槽都有、中心组与 pinned 皆空 → false', () => {
    expect(hasCenterTabs(nestedState({ dockedLeft: ['DL'], dockedRight: ['DR'] }), SPACE)).toBe(
      false,
    );
  });

  it('groups.left 有 tab → true', () => {
    expect(hasCenterTabs(nestedState({ left: ['A'] }), SPACE)).toBe(true);
  });

  it('只有 groups.right 有 tab → true（分屏右侧也是中心画面）', () => {
    expect(hasCenterTabs(nestedState({ right: ['B'] }), SPACE)).toBe(true);
  });

  it('只有 pinnedTabIds 有 tab → true（pin 面板同样是中心画面的一部分）', () => {
    expect(hasCenterTabs(nestedState({ pinned: ['P'] }), SPACE)).toBe(true);
  });

  it('docked 与 groups.left 同时有 → true（停靠不影响中心组仍为真）', () => {
    expect(hasCenterTabs(nestedState({ left: ['A'], dockedRight: ['DR'] }), SPACE)).toBe(true);
  });

  it('缺 layout / 未知空间 → false（优雅降级，与 `selectOrderedTabIds` 同语义）', () => {
    expect(hasCenterTabs(nestedState({ skipLayout: true }), SPACE)).toBe(false);
    expect(hasCenterTabs({ tabs: {}, editorLayout: {} }, 'missing')).toBe(false);
  });

  // 同一个缺陷的第二次到达：布局声明了 id，但注册表里已经没有它（关闭路径的边角 / heal 不写回）。
  // 只数 `tabIds.length` 会判 true，而那几个 id 渲染不出任何 tab —— 症状同样是「空岛挤掉引导页」。
  it('中心组 tabIds 残留已移除的 id（注册表里没有）⇒ false', () => {
    expect(hasCenterTabs(nestedState({ left: ['GHOST'], registryIds: [] }), SPACE)).toBe(false);
  });

  it('组分中既有活 id 也有残留 id ⇒ true（只要有一条可渲染就是编辑器形态）', () => {
    expect(hasCenterTabs(nestedState({ left: ['GHOST', 'A'], registryIds: ['A'] }), SPACE)).toBe(
      true,
    );
  });
});

describe('countDockedTabs — 某槽宿主里可渲染 tab 的条数（zone 可见性与揭示的唯一内容事实）', () => {
  function dockedState(args: {
    left?: string[];
    right?: string[];
    center?: string[];
    /** 覆盖注册表内容（缺省 = 布局里所有 id 都活着）；用空数组模拟幽灵 id。 */
    registryIds?: string[];
    skipLayout?: boolean;
  }): EditorTabSpaceState {
    const layout = createDefaultEditorLayout();
    layout.groups.left = { tabIds: args.center ?? [], activeTabId: args.center?.[0] ?? null };
    layout.docked.left = { tabIds: args.left ?? [], activeTabId: args.left?.[0] ?? null };
    layout.docked.right = { tabIds: args.right ?? [], activeTabId: args.right?.[0] ?? null };
    const allIds = [...(args.center ?? []), ...(args.left ?? []), ...(args.right ?? [])];
    const registryIds = args.registryIds ?? allIds;
    return {
      tabs: { [SPACE]: { tabs: registryIds.map(mkTab) } },
      editorLayout: args.skipLayout ? {} : { [SPACE]: layout },
    };
  }

  it('该槽有 1 条存活 docked tab → 1', () => {
    expect(countDockedTabs(dockedState({ right: ['R'] }), SPACE, 'right')).toBe(1);
    expect(countDockedTabs(dockedState({ left: ['L'] }), SPACE, 'left')).toBe(1);
  });

  // 条数而不是布尔：揭示判据是「到达 = 条数增加」，1 → 2 必须可观测（布尔会把它抹平）。
  it('该槽有 2 条存活 docked tab → 2（同一事实的更细形式，不是第二个判据）', () => {
    expect(countDockedTabs(dockedState({ right: ['R1', 'R2'] }), SPACE, 'right')).toBe(2);
    expect(countDockedTabs(dockedState({ left: ['L1', 'L2', 'L3'] }), SPACE, 'left')).toBe(3);
  });

  it('只查请求的那一槽：docked.left 有、right 空 → right 为 0（左右互不冒充）', () => {
    const state = dockedState({ left: ['L1', 'L2'] });
    expect(countDockedTabs(state, SPACE, 'right')).toBe(0);
    expect(countDockedTabs(state, SPACE, 'left')).toBe(2);
  });

  it('中心组有 tab 但 docked 空 → 0（中心 ≠ 宿主，与 hasCenterTabs 互为反面）', () => {
    const state = dockedState({ center: ['C'] });
    expect(countDockedTabs(state, SPACE, 'right')).toBe(0);
    expect(hasCenterTabs(state, SPACE)).toBe(true);
  });

  it('布局残留已关闭 tab 的 id（注册表里没有）⇒ 0（与 hasCenterTabs 同一存活口径）', () => {
    expect(
      countDockedTabs(dockedState({ right: ['GHOST'], registryIds: [] }), SPACE, 'right'),
    ).toBe(0);
  });

  it('幽灵 id 与存活 id 混合 ⇒ 只数存活的（1，不是 tabIds.length 的 2）', () => {
    const state = dockedState({ right: ['GHOST', 'R'], registryIds: ['R'] });
    expect(countDockedTabs(state, SPACE, 'right')).toBe(1);
  });

  it('关光该槽（布局清空、注册表还剩 tab）→ 0（减少不得残留计数）', () => {
    expect(countDockedTabs(dockedState({ right: [], registryIds: ['R'] }), SPACE, 'right')).toBe(0);
  });

  it('tabKey 为 null（没有激活 workspace）→ 0', () => {
    expect(countDockedTabs(dockedState({ right: ['R'] }), null, 'right')).toBe(0);
  });

  it('缺 layout / 未知空间 → 0（优雅降级，与 selectOrderedTabIds 同语义）', () => {
    expect(countDockedTabs(dockedState({ right: ['R'], skipLayout: true }), SPACE, 'right')).toBe(
      0,
    );
    expect(countDockedTabs({ tabs: {}, editorLayout: {} }, 'missing', 'left')).toBe(0);
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
