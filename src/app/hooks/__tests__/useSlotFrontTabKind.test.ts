import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { panelView, tabHostView } from '@/shared/dock';
import { createDefaultDockState, useDockStore } from '@/shared/store/dockStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { Project, Tab } from '@/shared/types';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import { useSlotFrontTabKind } from '../useSlotFrontTabKind';

/**
 * 选中态的**响应式**部分：判据本身有纯函数用例（`utils/__tests__/tabKind.test.ts`），
 * 这里守的是「hook 真的订阅到了变化的切片」—— selector 每次返回新引用会让 zustand
 * 判不等（要么重渲染风暴、要么永远不更新），两种都会让图标要么常亮要么永不亮。
 */

const SPACE = WorkspaceSession.of('p1', null).key;

function makeTab(id: string, kind: 'agent-chat' | 'terminal'): Tab {
  return {
    id,
    scope: { kind: 'workspace', session: WorkspaceSession.of('p1', null) },
    title: id,
    data: kind === 'terminal' ? { kind: 'terminal', agentId: null } : { kind: 'agent-chat' },
  };
}

/** 把一条 tab 停进右栏宿主并让宿主可见（图标该亮的唯一布置）。 */
function dockRight(id: string, kind: 'agent-chat' | 'terminal'): void {
  act(() => {
    useEditorStore.getState().addTab(makeTab(id, kind));
    useEditorStore.getState().dockTab(SPACE, id, 'right');
    useDockStore.getState().activateView(tabHostView('right'));
  });
}

beforeEach(() => {
  localStorage.clear();
  useDockStore.setState({ ...createDefaultDockState(), leftZoneExpandedBeforeLibrary: null });
  useEditorStore.setState({ tabs: {}, editorLayout: {} });
  useWorkspaceStore.setState({ byProject: {} });
  useProjectStore.setState({
    activeProjectId: 'p1',
    activeProject: { id: 'p1' } as unknown as Project,
  });
});

describe('useSlotFrontTabKind — 图标选中态的订阅面', () => {
  it('无 tab 时不亮；中心区出现 tab 也不亮（中间开会话 ≠ 右栏打开）', () => {
    const { result, rerender } = renderHook(() => useSlotFrontTabKind('right'));
    expect(result.current).toBeNull();

    act(() => {
      useEditorStore.getState().addTab(makeTab('c1', 'agent-chat'));
    });
    rerender();

    expect(result.current).toBeNull();
  });

  it('停靠 + 宿主展开 → 给出本栏前台种类（订阅到了 tabs / layout / zones）', () => {
    const { result, rerender } = renderHook(() => useSlotFrontTabKind('right'));
    dockRight('t1', 'terminal');
    rerender();

    expect(result.current).toBe('terminal');
  });

  it('宿主收起 → null（同一份 tab 不该继续点亮图标）', () => {
    const { result, rerender } = renderHook(() => useSlotFrontTabKind('right'));
    dockRight('t1', 'terminal');
    rerender();
    expect(result.current).toBe('terminal');

    act(() => {
      useDockStore.getState().setSlotExpanded('right', false);
    });
    rerender();

    expect(result.current).toBeNull();
  });

  it('本栏前台换成别的面板 → null（图标跟着「本栏是否在显示宿主」走）', () => {
    const { result, rerender } = renderHook(() => useSlotFrontTabKind('right'));
    dockRight('t1', 'terminal');
    rerender();
    expect(result.current).toBe('terminal');

    act(() => {
      useDockStore.getState().activateView(panelView('files'));
    });
    rerender();

    expect(result.current).toBeNull();
  });

  it('只看自己那一栏（左栏图标的判据不含右栏的 tab）', () => {
    const { result: right } = renderHook(() => useSlotFrontTabKind('right'));
    const { result: left } = renderHook(() => useSlotFrontTabKind('left'));
    dockRight('t1', 'terminal');

    expect(right.current).toBe('terminal');
    expect(left.current).toBeNull();
  });

  it('无激活项目 → null（tab 空间键为空时不该拿别的项目的高亮）', () => {
    act(() => {
      useEditorStore.getState().addTab(makeTab('c1', 'agent-chat'));
    });
    useProjectStore.setState({ activeProjectId: null, activeProject: null });

    const { result } = renderHook(() => useSlotFrontTabKind('right'));

    expect(result.current).toBeNull();
  });
});
