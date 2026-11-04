import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { appViewKey, panelView, slotViews } from '@/shared/dock';
import { createDefaultDockState, useDockStore } from '@/shared/store/dockStore';
import { useNotificationStore } from '@/shared/store/notificationStore';

// 注入一个「不可移动」的视图（P1 的 tabHost 才会真有这样的行，但拒绝路径必须现在就被测到）
vi.mock('@/shared/dock', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/dock')>();
  return {
    ...actual,
    DOCK_VIEW_META: {
      ...actual.DOCK_VIEW_META,
      'tabHost:right': {
        view: 'tabHost:right',
        host: 'tabHost',
        activation: { kind: 'toggleZone' },
        defaultSlot: 'right',
        defaultOrder: 90,
        movable: false,
      },
    },
  };
});

import { useDockBarMove } from '../useDockBarMove';

const PROJECTS = panelView('projects');
const FILES = panelView('files');
const TAB_HOST = 'tabHost:right' as never;

const messages = () => useNotificationStore.getState().notifications.map((n) => n.message);

/**
 * 不用 AppProvider 包：本 hook 由组合根在 Provider **之外**装配（`App.tsx` 先算 header
 * 再渲染 `<AppProviders>`）—— 它一旦依赖 Context，整棵应用在首帧就抛。提示因此走
 * `notify`（store 侧），本文件用 notificationStore 断言。
 */
function renderMove() {
  return renderHook(() => useDockBarMove()).result;
}

beforeEach(() => {
  localStorage.clear();
  useNotificationStore.setState({ notifications: [], unreadCount: 0 });
  useDockStore.setState({ ...createDefaultDockState(), leftZoneExpandedBeforeLibrary: null });
});

describe('useDockBarMove — 拖拽与键盘共用的落位入口', () => {
  it('跨栏移动：落位真的变了，且不报提示', () => {
    const move = renderMove();

    act(() => move.current(PROJECTS, 'right', 0));

    expect(slotViews(useDockStore.getState(), 'right')).toContain(PROJECTS);
    expect(messages()).toEqual([]);
  });

  it('栏内重排：下标生效', () => {
    const move = renderMove();

    act(() => move.current(FILES, 'right', 3));

    const right = slotViews(useDockStore.getState(), 'right');
    expect(right.indexOf(FILES)).toBe(3);
  });

  it('不可移动的视图被拒 → 用提示解释（而不是「拖了没反应」）', () => {
    const move = renderMove();
    const before = useDockStore.getState().placements;

    act(() => move.current(TAB_HOST, 'left'));

    expect(useDockStore.getState().placements).toBe(before);
    expect(messages()).toEqual(['This view is pinned to its side']);
  });

  it('同位置（幂等 no-op）不报提示：没移动 ≠ 不能移动', () => {
    const move = renderMove();

    act(() => move.current(FILES, 'right', 0));

    expect(messages()).toEqual([]);
  });

  it('非法槽位被静默忽略（不写状态、不报提示）', () => {
    const move = renderMove();
    const before = useDockStore.getState().placements;

    act(() => move.current(FILES, 'top' as never));

    expect(useDockStore.getState().placements).toBe(before);
    expect(messages()).toEqual([]);
  });

  it('appView 入口（Library）也能换栏：落位是布局，不是选中态', () => {
    const move = renderMove();

    act(() => move.current(appViewKey('library'), 'right'));

    expect(useDockStore.getState().placements[appViewKey('library')].slot).toBe('right');
  });
});
