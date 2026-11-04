import { beforeEach, describe, expect, it } from 'vitest';

import { tabHostView } from '@/shared/dock';
import { createDefaultDockState, useDockStore } from '@/shared/store/dockStore';
import { useEditorStore } from '@/shared/store/editorStore';
import type { Tab } from '@/shared/types';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import { findTabOfKind, isOpenableTabKind, selectVisibleTabKinds } from '../tabKind';

/**
 * 种类入口的两个派生面（激活哪条 / 图标该不该高亮）都是纯函数 —— 这里直测输入输出，
 * 不经过 React：消费侧最怕的就是「判据各写一份」，而判据能在这里被穷举。
 */

const SPACE = WorkspaceSession.of('p1', null).key;

function workspaceTab(id: string, kind: 'terminal' | 'agent-chat'): Tab {
  return {
    id,
    scope: { kind: 'workspace', session: WorkspaceSession.of('p1', null) },
    title: id,
    data: kind === 'terminal' ? { kind: 'terminal', agentId: null } : { kind: 'agent-chat' },
  };
}

function seed(tabs: Tab[]): void {
  useEditorStore.setState({ tabs: {}, editorLayout: {} });
  for (const tab of tabs) useEditorStore.getState().addTab(tab);
}

function space() {
  const state = useEditorStore.getState();
  return { tabs: state.tabs[SPACE], layout: state.editorLayout[SPACE] };
}

function find(kind: 'terminal' | 'agent-chat') {
  const { tabs, layout } = space();
  return findTabOfKind(tabs, layout, kind);
}

function visible(appView: 'normal' | 'settings' | 'library' = 'normal') {
  const { tabs, layout } = space();
  return selectVisibleTabKinds(tabs, layout, useDockStore.getState(), appView);
}

beforeEach(() => {
  localStorage.clear();
  useDockStore.setState({ ...createDefaultDockState(), leftZoneExpandedBeforeLibrary: null });
  useEditorStore.setState({ tabs: {}, editorLayout: {} });
});

describe('isOpenableTabKind', () => {
  it('只放行声明过的种类（meta 里的 tabKind 是 string，不能直接当 TabKind 用）', () => {
    expect(isOpenableTabKind('agent-chat')).toBe(true);
    expect(isOpenableTabKind('terminal')).toBe(true);
    expect(isOpenableTabKind('file')).toBe(false);
    expect(isOpenableTabKind('')).toBe(false);
  });
});

describe('findTabOfKind', () => {
  it('没有该种类的 tab → null', () => {
    seed([workspaceTab('c1', 'terminal')]);

    expect(find('agent-chat')).toBeNull();
  });

  it('空间不存在（tabs / layout 都没有）→ null（不抛）', () => {
    expect(findTabOfKind(undefined, undefined, 'terminal')).toBeNull();
  });

  it('中心区的 tab：dockSlot = null', () => {
    seed([workspaceTab('c1', 'agent-chat')]);

    expect(find('agent-chat')).toEqual({ tabId: 'c1', dockSlot: null });
  });

  it('停靠到右槽后：dockSlot = right（同一事实由布局给出，不由调用方猜）', () => {
    seed([workspaceTab('c1', 'agent-chat')]);
    useEditorStore.getState().dockTab(SPACE, 'c1', 'right');

    expect(find('agent-chat')).toEqual({ tabId: 'c1', dockSlot: 'right' });
  });

  it('同种多条：优先返回前台那条（点击 = 回到我正在用的那条）', () => {
    seed([workspaceTab('chat1', 'agent-chat'), workspaceTab('chat2', 'agent-chat')]);
    useEditorStore.getState().activateTab(SPACE, 'chat2');

    expect(find('agent-chat')?.tabId).toBe('chat2');
  });

  it('前台在另一条 kind 上时：确定性回落到注册顺序首条（点两次不会跳来跳去）', () => {
    seed([workspaceTab('chat1', 'agent-chat'), workspaceTab('term1', 'terminal')]);
    useEditorStore.getState().activateTab(SPACE, 'term1');

    expect(find('agent-chat')?.tabId).toBe('chat1');
    expect(find('agent-chat')?.tabId).toBe('chat1');
  });
});

describe('selectVisibleTabKinds — 图标选中态的唯一判据', () => {
  it('无布局 → 空集', () => {
    expect(
      selectVisibleTabKinds(undefined, undefined, useDockStore.getState(), 'normal').size,
    ).toBe(0);
  });

  it('中心前台 tab 的种类可见（normal 视图）', () => {
    seed([workspaceTab('c1', 'agent-chat')]);

    expect(visible()).toEqual(new Set(['agent-chat']));
  });

  it('Library / Settings 覆盖中心区 → 中间的 tab 不可见', () => {
    seed([workspaceTab('c1', 'agent-chat')]);

    expect(visible('library').size).toBe(0);
    expect(visible('settings').size).toBe(0);
  });

  it('停靠宿主可见（槽展开 + 宿主前台）→ 该槽前台 tab 的种类可见', () => {
    seed([workspaceTab('t1', 'terminal')]);
    useEditorStore.getState().dockTab(SPACE, 't1', 'right');
    useDockStore.getState().activateView(tabHostView('right'));

    expect(visible()).toEqual(new Set(['terminal']));
  });

  it('宿主被收起 → 不可见（隐藏的 tab 不该点亮图标）', () => {
    seed([workspaceTab('t1', 'terminal')]);
    useEditorStore.getState().dockTab(SPACE, 't1', 'right');
    useDockStore.getState().activateView(tabHostView('right'));
    useDockStore.getState().setSlotExpanded('right', false);

    expect(visible().size).toBe(0);
  });

  it('中心与宿主可以同时可见（两种 kind 同时高亮，不是单选）', () => {
    seed([workspaceTab('c1', 'agent-chat'), workspaceTab('t1', 'terminal')]);
    useEditorStore.getState().dockTab(SPACE, 't1', 'right');
    useDockStore.getState().activateView(tabHostView('right'));

    expect(visible()).toEqual(new Set(['agent-chat', 'terminal']));
  });
});
