import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTauriEvent } from '../useTauriEvent';

// Mock Tauri event API:listen 返回可控的 unlisten
const mockListen = vi.fn();
const mockUnlisten = vi.fn();

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

/** flush 微任务,让 listen().then() 回调执行(模拟真实异步 resolve)。 */
async function flush() {
  await act(async () => {});
}

describe('useTauriEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUnlisten.mockClear();
    mockListen.mockImplementation(() => Promise.resolve(mockUnlisten));
  });

  it('subscribes to the given event with the handler', async () => {
    const handler = vi.fn();
    renderHook(() => useTauriEvent('test://event', handler));

    expect(mockListen).toHaveBeenCalledTimes(1);
    expect(mockListen).toHaveBeenCalledWith('test://event', expect.any(Function));

    // 触发事件,payload 派发到 handler
    const listener = mockListen.mock.calls[0][1];
    act(() => {
      listener({ payload: { url: 'https://a.com' } });
    });
    expect(handler).toHaveBeenCalledWith({ url: 'https://a.com' });
  });

  it('unsubscribes on unmount', async () => {
    const { unmount } = renderHook(() => useTauriEvent('test://event', vi.fn()));
    expect(mockListen).toHaveBeenCalledTimes(1);

    await flush(); // listen().then 完成,unlisten 已赋值
    unmount();
    expect(mockUnlisten).toHaveBeenCalledTimes(1);
  });

  it('re-subscribes when handler identity changes and cleans up the old listener', async () => {
    const { rerender } = renderHook(({ h }) => useTauriEvent('test://event', h), {
      initialProps: { h: vi.fn() },
    });
    expect(mockListen).toHaveBeenCalledTimes(1);
    await flush();

    rerender({ h: vi.fn() });
    // 旧监听取消 + 新监听建立
    expect(mockUnlisten).toHaveBeenCalledTimes(1);
    expect(mockListen).toHaveBeenCalledTimes(2);
  });

  it('re-subscribes when event name changes', async () => {
    const { rerender } = renderHook(({ ev }) => useTauriEvent(ev, vi.fn()), {
      initialProps: { ev: 'test://one' },
    });
    expect(mockListen).toHaveBeenCalledTimes(1);
    await flush();

    rerender({ ev: 'test://two' });
    expect(mockUnlisten).toHaveBeenCalledTimes(1);
    expect(mockListen).toHaveBeenCalledTimes(2);
    expect(mockListen.mock.calls[1][0]).toBe('test://two');
  });

  it('cancels pending listen when unmounted before resolution (no leak)', async () => {
    let resolveFn: (fn: () => void) => void = () => {};
    mockListen.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFn = resolve;
        }),
    );

    const { unmount } = renderHook(() => useTauriEvent('test://event', vi.fn()));
    unmount(); // listen 尚未 resolve

    // 竞态:异步 resolve 后应立即调用返回的 unlisten
    const returnedUnlisten = vi.fn();
    await act(async () => {
      resolveFn(returnedUnlisten);
    });
    expect(returnedUnlisten).toHaveBeenCalledTimes(1);
    expect(mockUnlisten).not.toHaveBeenCalled(); // 不应重复注销
  });
});
