import { listen } from '@tauri-apps/api/event';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { confirmAppExit } from '@/features/settings/api/settingsApi';
import { APP_CLOSE_REQUESTED_EVENT } from '@/shared/events';

import { useConfirmExit } from '../useConfirmExit';

vi.mock('@/features/settings/api/settingsApi', () => ({
  confirmAppExit: vi.fn(),
}));

/** 取出 useTauriEvent 注册到 `listen` 的事件处理器（全局 mock 首个调用）。 */
function registeredCloseHandler(): (e: { payload: unknown }) => void {
  return vi.mocked(listen).mock.calls[0][1] as (e: { payload: unknown }) => void;
}

describe('useConfirmExit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
