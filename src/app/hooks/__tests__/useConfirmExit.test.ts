import { listen } from '@tauri-apps/api/event';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { confirmAppExit } from '@/features/settings/api/settingsApi';
import { APP_CLOSE_REQUESTED_EVENT } from '@/shared/events';
import { useEditorStore } from '@/shared/store/editorStore';
import type { Tab } from '@/shared/types';

import { useConfirmExit } from '../useConfirmExit';

vi.mock('@/features/settings/api/settingsApi', () => ({
  confirmAppExit: vi.fn(),
}));

function makeFileTab(
  id: string,
  title: string,
  overrides: Partial<{
    isDirty: boolean;
    isUntitled: boolean;
    untitledName: string;
  }> = {},
): Tab {
  return {
    id,
    projectId: 'p1',
    title,
    order: 0,
    data: {
      kind: 'file',
      filePath: title,
      fileName: title,
      content: { path: title, content: '', size: 0, is_binary: false },
      isDirty: false,
      ...overrides,
    },
  };
}

/** 取出 useTauriEvent 注册到 `listen` 的事件处理器（全局 mock 首个调用）。 */
function registeredCloseHandler(): (e: { payload: unknown }) => void {
  return vi.mocked(listen).mock.calls[0][1] as (e: { payload: unknown }) => void;
}

describe('useConfirmExit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.setState({ tabs: {}, editorLayout: {}, activeTabId: null });
  });

  it('starts with the exit dialog closed', () => {
    const { result } = renderHook(() => useConfirmExit());
    expect(result.current.confirmExitOpen).toBe(false);
  });

  it('subscribes to the app-close-requested event', () => {
    renderHook(() => useConfirmExit());
    expect(vi.mocked(listen)).toHaveBeenCalledWith(APP_CLOSE_REQUESTED_EVENT, expect.any(Function));
  });

  it('opens the exit dialog when the backend requests close', () => {
    const { result } = renderHook(() => useConfirmExit());

    act(() => {
      registeredCloseHandler()({ payload: undefined });
    });

    expect(result.current.confirmExitOpen).toBe(true);
  });

  it('reports no unsaved files when no dirty tabs exist', () => {
    const { result } = renderHook(() => useConfirmExit());
    useEditorStore.getState().addTab('p1', makeFileTab('a', 'a.ts'));
    useEditorStore.getState().addTab('p1', makeFileTab('b', 'b.ts', { isDirty: false }));

    act(() => {
      registeredCloseHandler()({ payload: undefined });
    });

    expect(result.current.unsavedFileNames).toEqual([]);
  });

  it('collects names of dirty file tabs when backend requests close', () => {
    const { result } = renderHook(() => useConfirmExit());
    useEditorStore.getState().addTab('p1', makeFileTab('a', 'a.ts', { isDirty: true }));
    useEditorStore.getState().addTab('p1', makeFileTab('b', 'b.ts', { isDirty: false }));
    useEditorStore
      .getState()
      .addTab('p1', makeFileTab('u', 'Untitled-1', { isDirty: true, isUntitled: true }));

    act(() => {
      registeredCloseHandler()({ payload: undefined });
    });

    // 只收集 dirty 文件；未保存 tab 展示 untitledName
    expect(result.current.unsavedFileNames).toEqual(['a.ts', 'Untitled-1']);
  });

  it('invokes confirm_app_exit and closes the dialog on confirm', () => {
    const { result } = renderHook(() => useConfirmExit());
    act(() => {
      registeredCloseHandler()({ payload: undefined });
    });

    act(() => {
      result.current.confirmExit();
    });

    expect(vi.mocked(confirmAppExit)).toHaveBeenCalledTimes(1);
    expect(result.current.confirmExitOpen).toBe(false);
  });

  it('closes the dialog without invoking exit on cancel', () => {
    const { result } = renderHook(() => useConfirmExit());
    act(() => {
      registeredCloseHandler()({ payload: undefined });
    });

    act(() => {
      result.current.closeExitDialog();
    });

    expect(result.current.confirmExitOpen).toBe(false);
    expect(vi.mocked(confirmAppExit)).not.toHaveBeenCalled();
  });

  it('keeps a stable listener across re-renders', () => {
    const { result } = renderHook(() => useConfirmExit());
    expect(vi.mocked(listen)).toHaveBeenCalledTimes(1);

    // 打开确认框 → 关闭，触发两次 state 变化与重渲染；
    // handler 必须稳定（useCallback），否则每次渲染都会重复订阅/注销。
    act(() => {
      registeredCloseHandler()({ payload: undefined });
    });
    act(() => {
      result.current.closeExitDialog();
    });

    expect(vi.mocked(listen)).toHaveBeenCalledTimes(1);
  });
});
