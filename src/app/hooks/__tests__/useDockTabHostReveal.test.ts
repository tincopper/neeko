import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { tabHostView, type DockSlot } from '@/shared/dock';
import { createDefaultDockState, useDockStore } from '@/shared/store/dockStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { unregisterTabSurfacePolicy } from '@/shared/store/tabSurfacePolicy';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { Tab } from '@/shared/types';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';
import { createProject } from '@/testing/factories';

import { registerNewTabDockPolicy } from '../../dock/registerNewTabDockPolicy';
import { moveTabToSlot } from '../../utils/tabSurface';
import { useDockTabHostContent } from '../useDockTabHostContent';
import { useDockTabHostReveal } from '../useDockTabHostReveal';

/**
 * 「内容到达即前置」的唯一实现（P6）。
 *
 * 为什么揭示必须住在 app 层而不是宿主组件里：宿主（`DockTabHost`）只在**槽展开且自己
 * 是前台**时才挂载（`DockZone` 对收起的槽 `return null`）。把揭示写在宿主的 effect 里，
 * 自动停靠（Action Menu / 侧栏点会话 / history 恢复 —— 它们只经 `addTab` 问种类策略，
 * 不经过 `moveTabToSlot`）在**槽收起时永远等不到那次 effect**：tab 建好了但看不见。
 *
 * 判据就是 P5 已经算好的同一个事实（该槽宿主有几条可渲染 tab），所以本 hook 只吃
 * `useDockTabHostContent()` 的返回值，不另造判据。**判据是条数而不是布尔**：
 * 布尔会把 1 → 2（已折叠且已非空的槽再来一条）抹平成「不变」⇒ 那次点击没有反应。
 *
 * 只测 hook、不用 Provider 包（同 `useDockBarMove.test.ts`）：本 hook 挂在骨架
 * `AppShell` 上，只允许依赖域 store —— 一旦偷偷抓 Context，真机首帧就会崩，而包了
 * Provider 的用例会假绿。
 */

const SPACE = WorkspaceSession.of('p1', null).key;

function chatTab(id: string): Tab {
  return {
    id,
    scope: { kind: 'workspace', session: WorkspaceSession.of('p1', null) },
    title: id,
    data: { kind: 'agent-chat' },
  };
}

function terminalTab(id: string): Tab {
  return {
    id,
    scope: { kind: 'workspace', session: WorkspaceSession.of('p1', null) },
    title: id,
    data: { kind: 'terminal', agentId: null },
  };
}

/** 手动停靠一条 tab（等价于右键 Move to Dock：写入路径显式、不经种类策略）。 */
function dockManually(id: string, slot: DockSlot): void {
  useEditorStore.getState().addTab(terminalTab(id));
  useEditorStore.getState().dockTab(SPACE, id, slot);
}

/**
 * 按组合根的真实形态装配：内容事实由 `useDockTabHostContent` 算，揭示只读它。
 * （`AppShell` 里就是这两行。）
 */
function renderReveal() {
  return renderHook(() => useDockTabHostReveal(useDockTabHostContent()));
}

function zone(slot: DockSlot) {
  return useDockStore.getState().zones[slot];
}

beforeEach(() => {
  localStorage.clear();
  useDockStore.setState({ ...createDefaultDockState(), leftZoneExpandedBeforeLibrary: null });
  useEditorStore.setState({ tabs: {}, editorLayout: {} });
  useWorkspaceStore.setState({ byProject: {} });
  useProjectStore.setState({
    activeProjectId: 'p1',
    activeProject: createProject({ id: 'p1' }),
  });
});

afterEach(() => {
  unregisterTabSurfacePolicy();
});

describe('useDockTabHostReveal — 到达（条数增加）即前置该槽', () => {
  it('右槽 0 → 1 条停靠 tab：该槽被激活展开（否则新 tab 停在收起的槽里，等于看不见）', () => {
    renderReveal();
    expect(zone('right').expanded).toBe(false);

    act(() => {
      dockManually('t1', 'right');
    });

    expect(zone('right')).toEqual({ expanded: true, activeView: tabHostView('right') });
  });

  it('左槽同一规则（不特判）：收起的左槽收到第一条停靠 tab 时被展开', () => {
    // 左槽默认展开：先收起，冲突面才是「收起的槽收到内容」
    useDockStore.getState().setSlotExpanded('left', false);
    renderReveal();

    act(() => {
      dockManually('t1', 'left');
    });

    expect(zone('left')).toEqual({ expanded: true, activeView: tabHostView('left') });
  });

  it('1 → 0（关光最后一条）：一字不动 —— 关光不重开（空宿主不占位是派生结果）', () => {
    dockManually('t1', 'right');
    renderReveal(); // 挂载时已非空：不揭示（见下一条），右槽仍是收起的
    expect(zone('right').expanded).toBe(false);
    const before = zone('right');

    act(() => {
      useEditorStore.getState().closeTab(SPACE, 't1');
    });

    expect(zone('right')).toEqual(before);
  });

  it('挂载时已经非空：不揭示（初值取当前值 —— 揭示只由「到达」触发，不由「存在」触发）', () => {
    dockManually('t1', 'right');

    renderReveal();

    expect(zone('right').expanded).toBe(false);
    expect(zone('right').activeView).not.toBe(tabHostView('right'));
  });

  it('已非空时又来一条（1 → 2）：仍然揭示 —— 到达 = 条数增加，不是布尔跃迁', () => {
    // P6-2b 转正的核心回归：旧布尔判据在这里没有假 → 真跃迁，于是「侧栏点第二个会话」
    // 落在已收起且已有一条 chat 的右槽上时是一下无反应的点击。
    dockManually('t1', 'right');
    renderReveal(); // 挂载时 1 条：不揭示（见上一条），右槽仍是收起的
    expect(zone('right').expanded).toBe(false);

    act(() => {
      dockManually('t2', 'right');
    });

    expect(zone('right')).toEqual({ expanded: true, activeView: tabHostView('right') });
  });

  it('条数减少（2 → 1，关掉一条）：一字不动 —— 关 tab 不得重开用户收起的槽', () => {
    dockManually('t1', 'right');
    dockManually('t2', 'right');
    renderReveal();
    expect(zone('right').expanded).toBe(false);
    const before = zone('right');

    act(() => {
      useEditorStore.getState().closeTab(SPACE, 't1');
    });

    expect(zone('right')).toEqual(before);
  });

  it('真实缺陷路径：槽已收起时**自动停靠**（addTab 种类策略，不走 moveTabToSlot）也会揭示', () => {
    // 生产里这条策略由 `bootstrap()` 注册；本用例走真实策略，而不是自己调 dockTab
    registerNewTabDockPolicy();
    // 右槽先展开再收起：证明揭示改变的是「收起」这一态，而不是从默认态碰巧展开
    useDockStore.getState().setSlotExpanded('right', true);
    useDockStore.getState().setSlotExpanded('right', false);
    renderReveal();

    act(() => {
      useEditorStore.getState().addTab(chatTab('chat-1'));
    });

    // tab 确实被种类策略停进了右槽（真实路径，不是测试自造）
    expect(useEditorStore.getState().editorLayout[SPACE]?.docked.right.tabIds).toEqual(['chat-1']);
    expect(zone('right')).toEqual({ expanded: true, activeView: tabHostView('right') });
  });

  it('已有一条 chat 的收起槽又自动停靠一条（1 → 2）：也揭示（本次转正的那一击）', () => {
    registerNewTabDockPolicy();
    renderReveal();
    act(() => {
      useEditorStore.getState().addTab(chatTab('chat-1'));
    });
    // 用户收起右槽（内容仍在：1 条）
    act(() => {
      useDockStore.getState().setSlotExpanded('right', false);
    });

    act(() => {
      useEditorStore.getState().addTab(chatTab('chat-2'));
    });

    expect(useEditorStore.getState().editorLayout[SPACE]?.docked.right.tabIds).toEqual([
      'chat-1',
      'chat-2',
    ]);
    expect(zone('right')).toEqual({ expanded: true, activeView: tabHostView('right') });
  });

  it('与 `moveTabToSlot` 的显式展开重叠：揭示不产生第二次写入（`activateView` 幂等）', () => {
    renderReveal();
    let zonesAfterMove: unknown;

    act(() => {
      useEditorStore.getState().addTab(terminalTab('t1'));
      // 用户路径的编排点：dockTab → activateView(host)（显式展开）
      expect(moveTabToSlot(SPACE, 't1', 'right')).toBe(true);
      zonesAfterMove = useDockStore.getState().zones;
    });

    // 揭示 effect 已在 act 内跑完：若它再写一次，`zones` 会是一个新对象（applyActivate 的
    // 早退保证「前台已是该宿主且展开」时不写入）。
    expect(useDockStore.getState().zones).toBe(zonesAfterMove);
  });
});
