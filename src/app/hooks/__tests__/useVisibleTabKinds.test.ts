import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { tabHostView } from '@/shared/dock';
import { useAppViewStore } from '@/shared/store/appViewStore';
import { createDefaultDockState, useDockStore } from '@/shared/store/dockStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { Project, Tab } from '@/shared/types';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import { useVisibleTabKinds } from '../useVisibleTabKinds';

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

beforeEach(() => {
  localStorage.clear();
  useAppViewStore.setState({ appView: 'normal' });
  useDockStore.setState({ ...createDefaultDockState(), leftZoneExpandedBeforeLibrary: null });
  useEditorStore.setState({ tabs: {}, editorLayout: {} });
  useWorkspaceStore.setState({ byProject: {} });
  useProjectStore.setState({
    activeProjectId: 'p1',
    activeProject: { id: 'p1' } as unknown as Project,
  });
});

describe('useVisibleTabKinds — 图标选中态的订阅面', () => {
  it('无 tab 时不亮；创建 chat tab 后亮起来（订阅到了 tabs 切片）', () => {
    const { result, rerender } = renderHook(() => useVisibleTabKinds());
    expect(result.current('agent-chat')).toBe(false);

    act(() => {
      useEditorStore.getState().addTab(makeTab('c1', 'agent-chat'));
    });
    rerender();

    expect(result.current('agent-chat')).toBe(true);
    expect(result.current('terminal')).toBe(false);
  });

  it('切到另一种 kind → 前一种熄灭（不是「出现过就一直亮」）', () => {
    act(() => {
      useEditorStore.getState().addTab(makeTab('c1', 'agent-chat'));
      useEditorStore.getState().addTab(makeTab('t1', 'terminal'));
      useEditorStore.getState().activateTab(SPACE, 'c1');
    });
    const { result, rerender } = renderHook(() => useVisibleTabKinds());
    expect(result.current('agent-chat')).toBe(true);

    act(() => {
      useEditorStore.getState().activateTab(SPACE, 't1');
    });
    rerender();

    expect(result.current('agent-chat')).toBe(false);
    expect(result.current('terminal')).toBe(true);
  });

  it('停靠宿主展开/收起会点亮与熄灭（订阅到了 zones 切片）', () => {
    act(() => {
      useEditorStore.getState().addTab(makeTab('t1', 'terminal'));
      useEditorStore.getState().dockTab(SPACE, 't1', 'right');
      useEditorStore.getState().activateTab(SPACE, 't1');
    });
    const { result, rerender } = renderHook(() => useVisibleTabKinds());

    act(() => {
      useDockStore.getState().activateView(tabHostView('right'));
    });
    rerender();
    expect(result.current('terminal')).toBe(true);

    act(() => {
      useDockStore.getState().setSlotExpanded('right', false);
    });
    rerender();
    expect(result.current('terminal')).toBe(false);
  });

  it('无激活项目 → 全部不亮（tab 空间键为空时不该拿别的项目的高亮）', () => {
    act(() => {
      useEditorStore.getState().addTab(makeTab('c1', 'agent-chat'));
    });
    useProjectStore.setState({ activeProjectId: null, activeProject: null });

    const { result } = renderHook(() => useVisibleTabKinds());

    expect(result.current('agent-chat')).toBe(false);
  });
});
