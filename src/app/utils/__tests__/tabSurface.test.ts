import { beforeEach, describe, expect, it } from 'vitest';

import { tabHostView } from '@/shared/dock';
import { useAppViewStore } from '@/shared/store/appViewStore';
import { createDefaultDockState, useDockStore } from '@/shared/store/dockStore';
import { useEditorStore } from '@/shared/store/editorStore';
import type { Tab } from '@/shared/types';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import { moveTabToSlot } from '../tabSurface';

/**
 * `moveTabToSlot` 是 tab 停靠的**唯一跨 store 编排点**（design §7.2）。
 *
 * 这些用例守两件事：
 * 1. 三步顺序（`dockTab` → `setViewOnBar` → `activateView`）—— 顺序错了会出现
 *    「宿主开了但 tab 还在中间」（双挂载）或「tab 停靠了但侧区没开」（看不见）；
 * 2. 前置校验失败时**状态一字不动**（半完成态是不可表示状态，不允许存在）。
 */

const SPACE = WorkspaceSession.of('p1', null).key;
const TAB_HOST_RIGHT = tabHostView('right');

function makeTab(id: string): Tab {
  return {
    id,
    scope: { kind: 'workspace', session: WorkspaceSession.of('p1', null) },
    title: id,
    data: { kind: 'file', filePath: id, fileName: id, content: '', isDirty: false },
  };
}

function seedCenter(ids: string[]): void {
  // 通过唯一创建入口 addTab 建空间（它同时 ensureLayout —— 手写 tabs 会让 addTab 早退、layout 缺失）
  useEditorStore.setState({ tabs: {}, editorLayout: {} });
  for (const id of ids) useEditorStore.getState().addTab(makeTab(id));
}

beforeEach(() => {
  localStorage.clear();
  useAppViewStore.setState({ appView: 'normal' });
  useDockStore.setState({ ...createDefaultDockState(), leftZoneExpandedBeforeLibrary: null });
  useEditorStore.setState({ tabs: {}, editorLayout: {} });
});

describe('moveTabToSlot — 停靠效果（真实 store）', () => {
  // 调用**次序**由 `tabSurface.order.test.ts` 用边界 mock 钉住：zustand 的 state 对象会在
  // 每次 set 时被 `Object.assign` 复制，对 action 直接 `vi.spyOn` 会被复制进后续 state，
  // 调用记录就此跨用例泄漏（实测：spy 永久留在 store 上）。本文件只断言真实结果。

  it('停靠后 tab 在 docked.right，且宿主图标已钉住并展开为前台', () => {
    seedCenter(['A', 'B']);

    expect(moveTabToSlot(SPACE, 'B', 'right')).toBe(true);

    const layout = useEditorStore.getState().editorLayout[SPACE]!;
    expect(layout.groups.left.tabIds).toEqual(['A']);
    expect(layout.docked.right).toEqual({ tabIds: ['B'], activeTabId: 'B' });

    const dock = useDockStore.getState();
    expect(dock.placements[TAB_HOST_RIGHT].onBar).toBe(true);
    expect(dock.zones[dock.placements[TAB_HOST_RIGHT].slot]).toEqual({
      expanded: true,
      activeView: TAB_HOST_RIGHT,
    });
  });

  it('回中心：只移动 tab，不写任何宿主状态（dock 切片引用不变）', () => {
    seedCenter(['A', 'B']);
    moveTabToSlot(SPACE, 'B', 'right');
    const dockBefore = useDockStore.getState();

    expect(moveTabToSlot(SPACE, 'B', 'center')).toBe(true);
    expect(useDockStore.getState().placements).toBe(dockBefore.placements);
    expect(useDockStore.getState().zones).toBe(dockBefore.zones);
    const layout = useEditorStore.getState().editorLayout[SPACE]!;
    expect(layout.docked.right.tabIds).toEqual([]);
    expect(layout.groups[layout.activeGroupId].tabIds).toContain('B');
  });
});

describe('moveTabToSlot — 前置校验失败 ⇒ false 且状态一字不动', () => {
  it('无 layout / 未知 tab ⇒ false，且不碰 dock 状态', () => {
    const before = useDockStore.getState();

    expect(moveTabToSlot('no-such-space', 'A', 'right')).toBe(false);
    seedCenter(['A']);
    expect(moveTabToSlot(SPACE, 'ghost', 'right')).toBe(false);
    expect(useDockStore.getState().placements).toBe(before.placements);
    expect(useDockStore.getState().zones).toBe(before.zones);
  });

  it('pinned tab ⇒ false（R9：拒绝，不静默 unpin，也不打开宿主）', () => {
    seedCenter(['A']);
    useEditorStore.getState().pinTab(SPACE, 'A');
    const dockBefore = useDockStore.getState();

    expect(moveTabToSlot(SPACE, 'A', 'right')).toBe(false);
    expect(useDockStore.getState().zones).toBe(dockBefore.zones);
    expect(useEditorStore.getState().editorLayout[SPACE]!.pinnedTabIds).toEqual(['A']);
  });

  it('目标宿主未在声明表登记 ⇒ false（移进去也没有渲染点）', () => {
    seedCenter(['A']);
    const layoutBefore = useEditorStore.getState().editorLayout[SPACE];
    const dockBefore = useDockStore.getState();

    expect(moveTabToSlot(SPACE, 'A', 'top' as never)).toBe(false);
    expect(useEditorStore.getState().editorLayout[SPACE]).toBe(layoutBefore);
    expect(useDockStore.getState().zones).toBe(dockBefore.zones);
  });
});
