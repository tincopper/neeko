import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `moveTabToSlot` 的**调用次序**（design §7.2：顺序不可颠倒）。
 *
 * 为什么用边界 mock 而不是真 store + spy：zustand 每次 `set` 都会
 * `Object.assign({}, state, nextState)` 复制 state，对 action 直接 `vi.spyOn`
 * 会被复制进后续 state（spy 永久留在 store 上、调用记录跨用例泄漏）。这里只关心
 * 「编排是否按顺序调用三个 action」，真实效果由 `tabSurface.test.ts` 用真 store 断言。
 *
 * 顺序错了的后果：先开宿主再移动 → 移动失败时侧区已被打开；先展开再钉图标 →
 * 用户可能失去回程入口。两种都是半完成态。
 */

const { calls, editorStore, dockStore } = vi.hoisted(() => {
  const calls: string[] = [];
  const workspaceKey = 'p1\u0000';
  const editorState = {
    editorLayout: {
      [workspaceKey]: {
        isSplit: false,
        ratio: 0.5,
        activeGroupId: 'left' as const,
        groups: {
          left: { tabIds: ['t1'], activeTabId: 't1' },
          right: { tabIds: [], activeTabId: null },
        },
        docked: {
          left: { tabIds: [], activeTabId: null },
          right: { tabIds: [], activeTabId: null },
        },
        pinnedTabIds: [] as string[],
        pinnedActiveTabId: null,
        pinnedPanelRatio: 0.35,
      },
    } as Record<string, unknown>,
    tabs: { [workspaceKey]: { tabs: [{ id: 't1' }] } } as Record<string, unknown>,
    dockTab: () => {
      calls.push('dockTab');
      return true;
    },
  };
  const dockState = {
    setViewOnBar: () => {
      calls.push('setViewOnBar');
    },
    activateView: () => {
      calls.push('activateView');
    },
  };
  return {
    calls,
    editorStore: { getState: () => editorState },
    dockStore: { getState: () => dockState },
  };
});

vi.mock('@/shared/store/editorStore', () => ({ useEditorStore: editorStore }));
vi.mock('@/shared/store/dockStore', () => ({ useDockStore: dockStore }));

import { moveTabToSlot } from '../tabSurface';

const SPACE = 'p1\u0000';

describe('moveTabToSlot — 三步顺序（不可颠倒）', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('停靠到右槽：dockTab → setViewOnBar → activateView', () => {
    expect(moveTabToSlot(SPACE, 't1', 'right')).toBe(true);
    expect(calls).toEqual(['dockTab', 'setViewOnBar', 'activateView']);
  });

  it('停靠到左槽：同样是三步（左槽不做特例，D4）', () => {
    expect(moveTabToSlot(SPACE, 't1', 'left')).toBe(true);
    expect(calls).toEqual(['dockTab', 'setViewOnBar', 'activateView']);
  });

  it('回中心：只有 dockTab，不碰任何宿主状态', () => {
    expect(moveTabToSlot(SPACE, 't1', 'center')).toBe(true);
    expect(calls).toEqual(['dockTab']);
  });
});
