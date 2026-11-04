import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { Tab } from '@/shared/types';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';
import { createProject } from '@/testing/factories';

import { useDockTabHostContent } from '../useDockTabHostContent';

/**
 * zone 可见性的**内容事实**注入端口：app 层把「当前 workspace 在每个槽有几条停靠 tab」
 * 算成两个计数交给布局层（layout 不得 import tab 域）。
 *
 * 为什么是计数而不是布尔：揭示判据是「到达 = 条数增加」，布尔会把 1 → 2 抹平成「不变」
 * （已折叠且已非空的槽再停靠一条 tab 就看不见）。
 *
 * 这里守两件事：
 * 1. 键是**当前 workspace**（`useActiveWorkspaceKey`）—— 切 worktree 后读的是另一格 tab 空间，
 *    不是裸 projectId 的空间；
 * 2. 返回值是稳定引用（下游 `React.memo` 挂在 `DockLayout` 上，每次渲染新对象会击穿 memo）。
 */

const MAIN_SPACE = WorkspaceSession.of('p1', null).key;
const WORKTREE_SPACE = WorkspaceSession.of('p1', '/repo/wt').key;

function makeTab(id: string, session = WorkspaceSession.of('p1', null)): Tab {
  return {
    id,
    scope: { kind: 'workspace', session },
    title: id,
    data: { kind: 'terminal', agentId: null },
  };
}

function seedProject(withProject = true): void {
  useProjectStore.setState({
    activeProjectId: withProject ? 'p1' : null,
    activeProject: withProject ? createProject({ id: 'p1' }) : null,
  });
}

beforeEach(() => {
  useEditorStore.setState({ tabs: {}, editorLayout: {} });
  useWorkspaceStore.setState({ byProject: {} });
  seedProject();
});

describe('useDockTabHostContent — 各槽宿主里可渲染 tab 的条数', () => {
  it('没有停靠 tab → 两槽皆 0', () => {
    const { result } = renderHook(() => useDockTabHostContent());
    expect(result.current).toEqual({ left: 0, right: 0 });
  });

  it('右槽有 1 条停靠 tab → right 为 1，left 仍为 0（按槽投影，不串味）', () => {
    const { result } = renderHook(() => useDockTabHostContent());

    act(() => {
      useEditorStore.getState().addTab(makeTab('t1'));
      useEditorStore.getState().dockTab(MAIN_SPACE, 't1', 'right');
    });

    expect(result.current).toEqual({ left: 0, right: 1 });
  });

  it('右槽再停一条 → right 为 2（计数而非布尔：1 → 2 是揭示判据要看见的到达）', () => {
    const { result } = renderHook(() => useDockTabHostContent());

    act(() => {
      useEditorStore.getState().addTab(makeTab('t1'));
      useEditorStore.getState().dockTab(MAIN_SPACE, 't1', 'right');
    });
    act(() => {
      useEditorStore.getState().addTab(makeTab('t2'));
      useEditorStore.getState().dockTab(MAIN_SPACE, 't2', 'right');
    });

    expect(result.current).toEqual({ left: 0, right: 2 });
  });

  it('没有激活项目（tabKey=null）→ 两槽皆 0（不凭空占位）', () => {
    seedProject(false);
    useEditorStore.getState().addTab(makeTab('t1'));
    useEditorStore.getState().dockTab(MAIN_SPACE, 't1', 'right');

    const { result } = renderHook(() => useDockTabHostContent());
    expect(result.current).toEqual({ left: 0, right: 0 });
  });

  it('键跟随**当前 workspace**：切到 worktree 后只认 worktree 的停靠 tab', () => {
    // 主仓空间里有一条停靠 tab，worktree 空间空着
    useEditorStore.getState().addTab(makeTab('t1'));
    useEditorStore.getState().dockTab(MAIN_SPACE, 't1', 'right');

    const { result } = renderHook(() => useDockTabHostContent());
    expect(result.current.right).toBe(1);

    act(() => {
      useWorkspaceStore.getState().setActiveWorkspace('p1', '/repo/wt');
    });
    // 切到 worktree：那一格 tab 空间是空的（不是「主仓有就算有」）
    expect(result.current).toEqual({ left: 0, right: 0 });

    act(() => {
      useEditorStore.getState().addTab(makeTab('t2', WorkspaceSession.of('p1', '/repo/wt')));
      useEditorStore.getState().dockTab(WORKTREE_SPACE, 't2', 'left');
    });
    expect(result.current).toEqual({ left: 1, right: 0 });
  });

  it('状态不变时重复渲染返回同一引用（不击穿 DockLayout 的 memo）', () => {
    const { result, rerender } = renderHook(() => useDockTabHostContent());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
