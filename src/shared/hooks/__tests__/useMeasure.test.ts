import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMeasure } from '../useMeasure';

// jsdom 无 ResizeObserver，测试内 stub（不污染全局 setup）
class ROMock {
  static instances: ROMock[] = [];
  callback: ResizeObserverCallback;
  observed: Element[] = [];
  disconnected = false;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ROMock.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ROMock);
});

afterEach(() => {
  ROMock.instances = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function makeEl(clientHeight: number): HTMLDivElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
  return el;
}

describe('useMeasure', () => {
  it('初始：容器未挂载时 height 为 0，node 为 null', () => {
    const { result } = renderHook(() => useMeasure());
    expect(result.current.height).toBe(0);
    expect(result.current.node).toBeNull();
  });

  it('容器挂载：callback ref 立即测量高度并创建 ResizeObserver', () => {
    const { result } = renderHook(() => useMeasure());
    const el = makeEl(400);
    act(() => {
      result.current.containerRef(el);
    });
    expect(result.current.node).toBe(el);
    expect(result.current.height).toBe(400);
    expect(ROMock.instances).toHaveLength(1);
    expect(ROMock.instances[0]!.observed).toContain(el);
  });

  it('回归：容器晚挂载（首帧骨架 → 数据到达）自动触发测量，无需滚动', () => {
    const { result } = renderHook(() => useMeasure());
    // 首帧无容器：RO 不应创建
    expect(ROMock.instances).toHaveLength(0);
    // 容器出现 → callback ref 触发 → 立即测量
    const el = makeEl(400);
    act(() => {
      result.current.containerRef(el);
    });
    expect(ROMock.instances).toHaveLength(1);
    expect(result.current.height).toBe(400);
  });

  it('ResizeObserver 回调在尺寸变化时更新高度', () => {
    const { result } = renderHook(() => useMeasure());
    const el = makeEl(400);
    act(() => {
      result.current.containerRef(el);
    });
    const ro = ROMock.instances[0]!;
    Object.defineProperty(el, 'clientHeight', { value: 800, configurable: true });
    act(() => {
      ro.callback([{} as ResizeObserverEntry], ro as unknown as ResizeObserver);
    });
    expect(result.current.height).toBe(800);
  });

  it('容器卸载（ref(null)）断开 ResizeObserver 并归零', () => {
    const { result } = renderHook(() => useMeasure());
    const el = makeEl(400);
    act(() => {
      result.current.containerRef(el);
    });
    const ro = ROMock.instances[0]!;
    act(() => {
      result.current.containerRef(null);
    });
    expect(ro.disconnected).toBe(true);
    expect(result.current.node).toBeNull();
    expect(result.current.height).toBe(0);
  });

  it('hook 卸载时断开 ResizeObserver', () => {
    const { result, unmount } = renderHook(() => useMeasure());
    const el = makeEl(400);
    act(() => {
      result.current.containerRef(el);
    });
    const ro = ROMock.instances[0]!;
    unmount();
    expect(ro.disconnected).toBe(true);
  });
});
