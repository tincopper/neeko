import { beforeEach, describe, expect, it } from 'vitest';

import { panelView, tabHostView, type DockSlot } from '@/shared/dock';
import { createDefaultDockState, useDockStore } from '@/shared/store/dockStore';
import { useEditorStore } from '@/shared/store/editorStore';
import type { Tab, TabKind } from '@/shared/types';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import {
  findTabInSlot,
  findTabOfKind,
  isOpenableTabKind,
  SESSION_KIND_OF_TAB_KIND,
  selectSlotFrontTabKind,
} from '../tabKind';

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

/** 某一栏图标的选中态判据（只有「本栏」参与，中心区不参与）。 */
function frontKind(slot: DockSlot = 'right') {
  const { tabs, layout } = space();
  return selectSlotFrontTabKind(tabs, layout, useDockStore.getState(), slot);
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

describe('SESSION_KIND_OF_TAB_KIND', () => {
  it('可打开种类逐一映射到会话种类（唯一映射点，不靠名字碰巧相同）', () => {
    expect(SESSION_KIND_OF_TAB_KIND['agent-chat']).toBe('chat');
    expect(SESSION_KIND_OF_TAB_KIND.terminal).toBe('terminal');
    // 穷尽性：键集必须等于可打开种类集（漏一种 = 点图标时查不到会话，静默新建空会话）
    expect(Object.keys(SESSION_KIND_OF_TAB_KIND).sort()).toEqual(['agent-chat', 'terminal']);
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

describe('selectSlotFrontTabKind — 图标选中态的唯一判据（只看**本栏**）', () => {
  it('无布局 → null', () => {
    expect(
      selectSlotFrontTabKind(undefined, undefined, useDockStore.getState(), 'right'),
    ).toBeNull();
  });

  it('中心前台 tab 不点亮任何一栏的图标（回归：中间开 chat 不该让右栏图标选中）', () => {
    seed([workspaceTab('c1', 'agent-chat')]);

    expect(frontKind('right')).toBeNull();
    expect(frontKind('left')).toBeNull();
  });

  it('中心前台是 terminal 同样不点亮（右栏 Terminal 图标只代表右栏自己）', () => {
    seed([workspaceTab('t1', 'terminal')]);

    expect(frontKind('right')).toBeNull();
  });

  it('停靠宿主可见（槽展开 + 宿主前台）→ 该栏前台的种类', () => {
    seed([workspaceTab('t1', 'terminal')]);
    useEditorStore.getState().dockTab(SPACE, 't1', 'right');
    useDockStore.getState().activateView(tabHostView('right'));

    expect(frontKind('right')).toBe('terminal');
  });

  it('宿主被收起 → null（隐藏的 tab 不该点亮图标）', () => {
    seed([workspaceTab('t1', 'terminal')]);
    useEditorStore.getState().dockTab(SPACE, 't1', 'right');
    useDockStore.getState().activateView(tabHostView('right'));
    useDockStore.getState().setSlotExpanded('right', false);

    expect(frontKind('right')).toBeNull();
  });

  it('本栏被别的面板占着前台（宿主不在前台）→ null', () => {
    seed([workspaceTab('t1', 'terminal')]);
    useEditorStore.getState().dockTab(SPACE, 't1', 'right');
    useDockStore.getState().activateView(tabHostView('right'));
    useDockStore.getState().activateView(panelView('files'));

    expect(frontKind('right')).toBeNull();
  });

  it('两栏互相独立：左栏报 chat、右栏报 terminal（不是一个全局集合）', () => {
    seed([workspaceTab('c1', 'agent-chat'), workspaceTab('t1', 'terminal')]);
    useEditorStore.getState().dockTab(SPACE, 'c1', 'left');
    useEditorStore.getState().dockTab(SPACE, 't1', 'right');
    useDockStore.getState().activateView(tabHostView('left'));
    useDockStore.getState().activateView(tabHostView('right'));

    expect(frontKind('left')).toBe('agent-chat');
    expect(frontKind('right')).toBe('terminal');
  });

  it('宿主前台换到另一条 kind → 返回值跟着换（不是「出现过就常亮」）', () => {
    seed([workspaceTab('c1', 'agent-chat'), workspaceTab('t1', 'terminal')]);
    useEditorStore.getState().dockTab(SPACE, 'c1', 'right');
    useEditorStore.getState().dockTab(SPACE, 't1', 'right');
    useDockStore.getState().activateView(tabHostView('right'));
    expect(frontKind('right')).toBe('terminal');

    useEditorStore.getState().activateTab(SPACE, 'c1');

    expect(frontKind('right')).toBe('agent-chat');
  });

  it('本槽收起时，别的槽把前台指向本槽宿主也不算「本栏打开」（跨槽泄漏）', () => {
    seed([workspaceTab('t1', 'terminal')]);
    useEditorStore.getState().dockTab(SPACE, 't1', 'left');
    // isViewVisible 会在这个态上说「tabHost:left 可见」（右槽展开且前台指向它）——
    // 槽内口径必须回答「左槽在显示谁」：左槽收起 → null。
    useDockStore.setState({
      zones: {
        left: { expanded: false, activeView: tabHostView('left') },
        right: { expanded: true, activeView: tabHostView('left') },
      },
    });

    expect(frontKind('left')).toBeNull();
  });

  it('前台指向已不存在的 tab → null（残留 id 不点亮图标）', () => {
    seed([workspaceTab('t1', 'terminal')]);
    useEditorStore.getState().dockTab(SPACE, 't1', 'right');
    useDockStore.getState().activateView(tabHostView('right'));
    useEditorStore.setState((s) => ({
      editorLayout: {
        [SPACE]: {
          ...s.editorLayout[SPACE],
          docked: {
            ...s.editorLayout[SPACE].docked,
            right: { tabIds: ['ghost'], activeTabId: 'ghost' },
          },
        },
      },
    }));

    expect(frontKind('right')).toBeNull();
  });

  it('tabs 注册表缺失 → null（不拿未知种类去点亮图标）', () => {
    seed([workspaceTab('t1', 'terminal')]);
    useEditorStore.getState().dockTab(SPACE, 't1', 'right');
    useDockStore.getState().activateView(tabHostView('right'));
    const { layout } = space();

    expect(selectSlotFrontTabKind(undefined, layout, useDockStore.getState(), 'right')).toBeNull();
  });
});

describe('findTabInSlot — 「这一栏的实例」= 前台优先，否则声明序', () => {
  function inSlot(slot: DockSlot, kind: TabKind) {
    const { tabs, layout } = space();
    return findTabInSlot(tabs, layout, slot, kind);
  }

  it('同栏多条同种：前台优先（高亮着时点一下 = 收起，而不是「切到另一条」）', () => {
    seed([workspaceTab('t1', 'terminal'), workspaceTab('t2', 'terminal')]);
    useEditorStore.getState().dockTab(SPACE, 't1', 'right');
    useEditorStore.getState().dockTab(SPACE, 't2', 'right'); // 后停的是前台

    expect(inSlot('right', 'terminal')?.tabId).toBe('t2');
  });

  it('前台不是该种类时回落声明序首条（确定性，不随点击漂移）', () => {
    seed([workspaceTab('t1', 'terminal'), workspaceTab('c1', 'agent-chat')]);
    useEditorStore.getState().dockTab(SPACE, 't1', 'right');
    useEditorStore.getState().dockTab(SPACE, 'c1', 'right'); // 前台是 chat

    expect(inSlot('right', 'terminal')?.tabId).toBe('t1');
    expect(inSlot('right', 'terminal')?.tabId).toBe('t1');
  });

  it('只看本槽：另一槽的同种 tab 不被认', () => {
    seed([workspaceTab('t1', 'terminal')]);
    useEditorStore.getState().dockTab(SPACE, 't1', 'left');

    expect(inSlot('right', 'terminal')).toBeNull();
  });
});
