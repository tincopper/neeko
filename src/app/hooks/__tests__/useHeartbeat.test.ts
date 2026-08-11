import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useHeartbeat } from '../useHeartbeat';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

describe('useHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('立即发送一次心跳', () => {
    renderHook(() => useHeartbeat(5000));
    expect(invokeMock).toHaveBeenCalledWith('heartbeat');
  });

  it('按固定间隔持续发送心跳', () => {
    renderHook(() => useHeartbeat(5000));
    expect(invokeMock).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(invokeMock).toHaveBeenCalledTimes(2);

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(invokeMock).toHaveBeenCalledTimes(3);
  });

  it('卸载后停止发送心跳', () => {
    const { unmount } = renderHook(() => useHeartbeat(5000));
    expect(invokeMock).toHaveBeenCalledTimes(1);

    unmount();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it('心跳失败不抛出异常', async () => {
    invokeMock.mockRejectedValue(new Error('boom'));
    renderHook(() => useHeartbeat(5000));
    // 等待异步 tick 完成，不应抛出
    await act(async () => {
      await Promise.resolve();
    });
    expect(invokeMock).toHaveBeenCalledWith('heartbeat');
  });
});
