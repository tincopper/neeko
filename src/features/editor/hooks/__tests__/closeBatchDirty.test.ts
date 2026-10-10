// Red→Green tests for closeOtherTabs / closeAllTabs dirty confirmation.
// Covers the "batch close with unsaved files must confirm first" requirement.
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditorStore } from '@/shared/store/editorStore';
import type { Tab } from '@/shared/types';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import { useEditorGroupLayout } from '../useEditorGroupLayout';

const SPACE_p1 = WorkspaceSession.of('p1', null).key;

/** 测试身份源：项目 id → WorkspaceSession（主仓形态）。 */
function mkSession(projectId: string) {
  return WorkspaceSession.of(projectId, null);
}

vi.mock('@/features/terminal', () => ({
  closeEditorTab: (tabKey: string, tabId: string) => {
    useEditorStore.getState().closeTab(tabKey, tabId);
  },
  closeAllEditorTabs: (tabKey: string) => {
    useEditorStore.getState().clearProjectTabs(tabKey);
  },
}));

function makeTab(
  id: string,
  overrides: Partial<{ isDirty: boolean; isUntitled: boolean; untitledName: string }> = {},
): Tab {
  return {
    id,
    scope: { kind: 'workspace', session: mkSession('p1') },
    title: id,
    order: 0,
    data: {
      kind: 'file',
      filePath: id,
      fileName: id,
      content: { path: id, content: '', size: 0, is_binary: false },
      isDirty: false,
      ...overrides,
    },
  };
}

describe('useEditorGroupLayout batch close dirty confirmation', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: {}, editorLayout: {}, activeTabId: null });
  });

  it('closeOtherTabs closes directly when no dirty tabs are affected', () => {
    const onRequestCloseDirty = vi.fn();
    const { addTab } = useEditorStore.getState();
    act(() => {
      addTab(makeTab('A'));
      addTab(makeTab('B', { isDirty: false }));
    });

    const { result } = renderHook(() => useEditorGroupLayout(SPACE_p1, onRequestCloseDirty));
    act(() => {
      result.current.closeOtherTabs('A');
    });

    expect(onRequestCloseDirty).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tabs[SPACE_p1].tabs.map((t) => t.id)).toEqual(['A']);
  });

  it('closeOtherTabs asks confirmation when affected tabs are dirty', () => {
    const onRequestCloseDirty = vi.fn();
    const { addTab } = useEditorStore.getState();
    act(() => {
      addTab(makeTab('A'));
      addTab(makeTab('B', { isDirty: true, fileName: 'b.ts' }));
      addTab(makeTab('C', { isDirty: true, fileName: 'c.ts' }));
      addTab(makeTab('D', { isDirty: false }));
    });

    const { result } = renderHook(() => useEditorGroupLayout(SPACE_p1, onRequestCloseDirty));
    act(() => {
      result.current.closeOtherTabs('A');
    });

    // 回调收到未保存文件名；尚未关闭任何 tab
    expect(onRequestCloseDirty).toHaveBeenCalledTimes(1);
    const [dirtyNames, doClose] = onRequestCloseDirty.mock.calls[0] as [string[], () => void];
    expect(dirtyNames).toEqual(['b.ts', 'c.ts']);
    expect(useEditorStore.getState().tabs[SPACE_p1].tabs.map((t) => t.id)).toEqual([
      'A',
      'B',
      'C',
      'D',
    ]);

    // 用户确认后执行关闭
    act(() => {
      doClose();
    });
    expect(useEditorStore.getState().tabs[SPACE_p1].tabs.map((t) => t.id)).toEqual(['A']);
  });

  it('closeOtherTabs closes directly when no confirmation callback is provided', () => {
    const { addTab } = useEditorStore.getState();
    act(() => {
      addTab(makeTab('A'));
      addTab(makeTab('B', { isDirty: true }));
    });

    const { result } = renderHook(() => useEditorGroupLayout(SPACE_p1));
    act(() => {
      result.current.closeOtherTabs('A');
    });

    expect(useEditorStore.getState().tabs[SPACE_p1].tabs.map((t) => t.id)).toEqual(['A']);
  });

  it('closeAllTabs asks confirmation when dirty tabs exist and only closes on confirm', () => {
    const onRequestCloseDirty = vi.fn();
    const { addTab } = useEditorStore.getState();
    act(() => {
      addTab(makeTab('A', { isDirty: true, fileName: 'a.ts' }));
      addTab(makeTab('B'));
    });

    const { result } = renderHook(() => useEditorGroupLayout(SPACE_p1, onRequestCloseDirty));
    act(() => {
      result.current.closeAllTabs();
    });

    expect(onRequestCloseDirty).toHaveBeenCalledTimes(1);
    const [dirtyNames, doClose] = onRequestCloseDirty.mock.calls[0] as [string[], () => void];
    expect(dirtyNames).toEqual(['a.ts']);
    // 未确认前不关闭
    expect(useEditorStore.getState().tabs[SPACE_p1]).toBeDefined();

    act(() => {
      doClose();
    });
    expect(useEditorStore.getState().tabs[SPACE_p1]).toBeUndefined();
  });

  it('closeAllTabs closes directly when no dirty tabs exist', () => {
    const onRequestCloseDirty = vi.fn();
    const { addTab } = useEditorStore.getState();
    act(() => {
      addTab(makeTab('A'));
      addTab(makeTab('B'));
    });

    const { result } = renderHook(() => useEditorGroupLayout(SPACE_p1, onRequestCloseDirty));
    act(() => {
      result.current.closeAllTabs();
    });

    expect(onRequestCloseDirty).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tabs[SPACE_p1]).toBeUndefined();
  });
});
