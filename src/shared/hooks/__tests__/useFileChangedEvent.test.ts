import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Tauri event API:listen 返回可控的 unlisten（延迟 resolve 模拟竞态）
const mockListen = vi.fn();

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

/**
 * 动态导入 hook：useFileChangedEvent 内部持有模块级单例状态
 * （refCount/generation/sharedUnlisten），每次 resetModules 后重新求值，
 * 保证各用例之间状态隔离。
 */
async function loadHook() {
  const mod = await import('../useFileChangedEvent');
  return mod.useFileChangedEvent;
}

/** flush 微任务,让 listen().then() 回调执行(模拟真实异步 resolve)。 */
async function flush() {
  await act(async () => {});
}

describe('useFileChangedEvent', () => {
  beforeEach(() => {
    vi.resetModules();
    mockListen.mockReset();
  });

  it('should_subscribe_once_and_unlisten_once_on_last_unmount', async () => {
    const useFileChangedEvent = await loadHook();
    const unlisten = vi.fn();
    mockListen.mockResolvedValue(unlisten);

    const { unmount } = renderHook(() => useFileChangedEvent(() => {}));
    await flush(); // listen().then 完成,sharedUnlisten 已赋值

    expect(mockListen).toHaveBeenCalledTimes(1);
    expect(mockListen).toHaveBeenCalledWith('file-changed', expect.any(Function));

    unmount();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('should_share_single_listener_across_subscribers_and_unlisten_only_at_zero_refcount', async () => {
    const useFileChangedEvent = await loadHook();
    const unlisten = vi.fn();
    mockListen.mockResolvedValue(unlisten);

    const a = renderHook(() => useFileChangedEvent(() => {}));
    const b = renderHook(() => useFileChangedEvent(() => {}));
    await flush();

    // 两个订阅者共享同一个 listen
    expect(mockListen).toHaveBeenCalledTimes(1);

    a.unmount();
    expect(unlisten).not.toHaveBeenCalled(); // 仍有一个订阅者,不注销

    b.unmount();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('should_self_clean_stale_listen_when_generation_changes_before_resolve', async () => {
    const useFileChangedEvent = await loadHook();
    let resolveOld: (fn: () => void) => void = () => {};
    let resolveNew: (fn: () => void) => void = () => {};
    const oldUnlisten = vi.fn();
    const newUnlisten = vi.fn();

    mockListen
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveNew = resolve;
          }),
      );

    const first = renderHook(() => useFileChangedEvent(() => {}));
    first.unmount(); // refCount → 0,generation++,旧 listen 变为 stale

    const second = renderHook(() => useFileChangedEvent(() => {}));

    // 旧 listen 晚到:必须自清,且不得覆盖新的 sharedUnlisten
    await act(async () => {
      resolveOld(oldUnlisten);
    });
    expect(oldUnlisten).toHaveBeenCalledTimes(1);

    // 新 listen 接管
    await act(async () => {
      resolveNew(newUnlisten);
    });
    expect(newUnlisten).not.toHaveBeenCalled(); // 尚未卸载,不应注销

    second.unmount();
    expect(newUnlisten).toHaveBeenCalledTimes(1);
    expect(oldUnlisten).toHaveBeenCalledTimes(1); // 旧监听仅自清一次
  });

  it('should_dispatch_payload_to_all_subscribers', async () => {
    const useFileChangedEvent = await loadHook();
    mockListen.mockResolvedValue(vi.fn());

    const cbA = vi.fn();
    const cbB = vi.fn();
    renderHook(() => useFileChangedEvent(cbA));
    renderHook(() => useFileChangedEvent(cbB));
    await flush();

    const listener = mockListen.mock.calls[0][1];
    act(() => {
      listener({ payload: { project_id: 'p1', paths: ['src/a.ts'] } });
    });
    expect(cbA).toHaveBeenCalledWith({ project_id: 'p1', paths: ['src/a.ts'] });
    expect(cbB).toHaveBeenCalledWith({ project_id: 'p1', paths: ['src/a.ts'] });
  });
});
