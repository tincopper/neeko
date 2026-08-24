import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDeltaBatcher } from '../useDeltaBatcher';

// 可控 rAF：收集回调，测试手动 flush（对齐 AgentChatTabView 的流式批处理）。
let rafCallbacks: Array<() => void> = [];
const rafStub = vi.fn((cb: FrameRequestCallback) => {
  rafCallbacks.push(() => cb(0));
  return rafCallbacks.length;
});
const cancelStub = vi.fn((id: number) => {
  rafCallbacks[id - 1] = () => {};
});

function flushRaf() {
  const cbs = rafCallbacks;
  rafCallbacks = [];
  for (const cb of cbs) cb();
}

beforeEach(() => {
  rafCallbacks = [];
  rafStub.mockClear();
  cancelStub.mockClear();
  vi.stubGlobal('requestAnimationFrame', rafStub);
  vi.stubGlobal('cancelAnimationFrame', cancelStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useDeltaBatcher', () => {
  it('多次 push 只调度一次 rAF，flush 回调收到完整有序数组', () => {
    const onFlush = vi.fn();
    const { result } = renderHook(() => useDeltaBatcher(onFlush));

    act(() => {
      result.current.push('text', 'a');
      result.current.push('text', 'b');
      result.current.push('reasoning', 'r1');
    });

    // 批处理：事件到达期间不立即 flush，仅调度一个动画帧
    expect(rafStub).toHaveBeenCalledTimes(1);
    expect(onFlush).not.toHaveBeenCalled();

    act(() => flushRaf());

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith([
      { kind: 'text', delta: 'a' },
      { kind: 'text', delta: 'b' },
      { kind: 'reasoning', delta: 'r1' },
    ]);
  });

  it('手动 flush 立即回调并清空缓冲、取消挂起的 rAF', () => {
    const onFlush = vi.fn();
    const { result } = renderHook(() => useDeltaBatcher(onFlush));

    act(() => {
      result.current.push('text', 'x');
      result.current.flush();
    });

    expect(cancelStub).toHaveBeenCalled();
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith([{ kind: 'text', delta: 'x' }]);

    // 缓冲已清空 → 后续 rAF 回调 no-op
    act(() => flushRaf());
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it('空缓冲 flush 不触发回调', () => {
    const onFlush = vi.fn();
    const { result } = renderHook(() => useDeltaBatcher(onFlush));

    act(() => result.current.flush());
    expect(onFlush).not.toHaveBeenCalled();
  });

  it('卸载时取消挂起的 rAF', () => {
    const onFlush = vi.fn();
    const { result, unmount } = renderHook(() => useDeltaBatcher(onFlush));

    act(() => {
      result.current.push('text', 'z');
    });
    expect(rafStub).toHaveBeenCalledTimes(1);

    unmount();
    expect(cancelStub).toHaveBeenCalled();
  });

  it('重渲染后 flush 使用最新回调（ref 模式）', () => {
    const onFlush1 = vi.fn();
    const { result, rerender } = renderHook(({ cb }) => useDeltaBatcher(cb), {
      initialProps: { cb: onFlush1 },
    });
    const onFlush2 = vi.fn();
    rerender({ cb: onFlush2 });

    act(() => {
      result.current.push('text', 'v');
      flushRaf();
    });
    expect(onFlush1).not.toHaveBeenCalled();
    expect(onFlush2).toHaveBeenCalledWith([{ kind: 'text', delta: 'v' }]);
  });
});
