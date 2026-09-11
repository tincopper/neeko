import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useOnlyAfterMount, usePresence, useReducedMotion } from '../usePresence';

// 确定性 rAF：把回调排队，测试显式 flush（不依赖 jsdom 计时）。
let rafQueue: FrameRequestCallback[] = [];
let rafSeq = 0;

function flushRaf() {
  const queued = rafQueue;
  rafQueue = [];
  act(() => {
    queued.forEach((cb) => cb(0));
  });
}

function stubMatchMedia(initial: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: initial,
    media: query,
    addEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) => {
      listeners.add(cb);
    },
    removeEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) => {
      listeners.delete(cb);
    },
  }));
  return {
    fire(matches: boolean) {
      act(() => {
        listeners.forEach((cb) => cb({ matches } as MediaQueryListEvent));
      });
    },
    listenerCount: () => listeners.size,
  };
}

beforeEach(() => {
  rafQueue = [];
  rafSeq = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return ++rafSeq;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('usePresence', () => {
  it('初始不可见：不挂载、不展示', () => {
    const { result } = renderHook(() => usePresence(false));
    expect(result.current.mounted).toBe(false);
    expect(result.current.show).toBe(false);
  });

  it('初始可见：立即挂载并展示（首帧不播过渡）', () => {
    const { result } = renderHook(() => usePresence(true));
    expect(result.current.mounted).toBe(true);
    expect(result.current.show).toBe(true);
  });

  it('不可见 → 可见：先挂载，下一帧才 show（保证 enter 过渡能播）', () => {
    const { result, rerender } = renderHook(
      ({ visible }: { visible: boolean }) => usePresence(visible),
      { initialProps: { visible: false } },
    );
    rerender({ visible: true });
    expect(result.current.mounted).toBe(true);
    expect(result.current.show).toBe(false);

    flushRaf();
    expect(result.current.show).toBe(true);
  });

  it('转为不可见立即 hide；过渡结束后卸载并回调 onExited', () => {
    const onExited = vi.fn();
    const { result, rerender } = renderHook(
      ({ visible }: { visible: boolean }) => usePresence(visible, onExited),
      { initialProps: { visible: true } },
    );
    flushRaf();
    expect(result.current.show).toBe(true);

    rerender({ visible: false });
    expect(result.current.show).toBe(false);
    expect(result.current.mounted).toBe(true);

    act(() => result.current.onTransitionEnd());
    expect(result.current.mounted).toBe(false);
    expect(onExited).toHaveBeenCalledTimes(1);
  });

  it('过渡结束时若仍可见，不得卸载（enter 过渡的 transitionend 会被忽略）', () => {
    const onExited = vi.fn();
    const { result } = renderHook(() => usePresence(true, onExited));
    act(() => result.current.onTransitionEnd());
    expect(result.current.mounted).toBe(true);
    expect(onExited).not.toHaveBeenCalled();
  });
});

describe('useOnlyAfterMount', () => {
  it('挂载后一帧才 ready', () => {
    const { result } = renderHook(() => useOnlyAfterMount());
    expect(result.current).toBe(false);
    flushRaf();
    expect(result.current).toBe(true);
  });
});

describe('useReducedMotion', () => {
  it('读取初始偏好并在 change 时更新', () => {
    const mq = stubMatchMedia(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);

    mq.fire(false);
    expect(result.current).toBe(false);
  });

  it('卸载时注销 matchMedia 监听（防泄漏）', () => {
    const mq = stubMatchMedia(false);
    const { unmount } = renderHook(() => useReducedMotion());
    expect(mq.listenerCount()).toBe(1);
    unmount();
    expect(mq.listenerCount()).toBe(0);
  });
});
