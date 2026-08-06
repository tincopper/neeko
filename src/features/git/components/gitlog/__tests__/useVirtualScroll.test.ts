import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useVirtualScroll } from '../useVirtualScroll';
import { computeRowOffsets } from '../virtualScroll';

// jsdom 无 IntersectionObserver / ResizeObserver，测试内 stub（不污染全局 setup）
class IOMock {
  static instances: IOMock[] = [];
  callback: IntersectionObserverCallback;
  observed: Element[] = [];
  disconnected = false;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    IOMock.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
}

class ROMock {
  static instances: ROMock[] = [];
  callback: ResizeObserverCallback;
  disconnected = false;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ROMock.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
}

// stub 必须放在 beforeEach：afterEach 的 unstubAllGlobals 会恢复全局，
// 顶层只执行一次，后续测试会拿到 undefined
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', IOMock);
  vi.stubGlobal('ResizeObserver', ROMock);
});

afterEach(() => {
  IOMock.instances = [];
  ROMock.instances = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const baseOptions = {
  rowCount: 20,
  selectedRowIndex: -1,
  expandHeight: 0,
  hasMore: false,
  loadingMore: false,
  onLoadMore: vi.fn(),
};

describe('useVirtualScroll', () => {
  it('初始窗口：viewport 未测量时渲染 0..overscan', () => {
    const { result } = renderHook(() => useVirtualScroll(baseOptions));
    expect(result.current.startIndex).toBe(0);
    expect(result.current.endIndex).toBe(10); // overscan = 10
    expect(result.current.offsetY).toBe(0);
  });

  it('handleScroll 更新 scrollTop 并移动窗口', () => {
    const { result } = renderHook(() => useVirtualScroll(baseOptions));
    // 挂载容器：视口测量由 useMeasure 接管（clientHeight 64 → viewportHeight 64）
    act(() => {
      result.current.containerRef({ scrollTop: 160, clientHeight: 64 } as HTMLDivElement);
    });
    // 20 行均匀 32px；滚动到 160（第 5 行），视口 64px（2 行）
    act(() => {
      result.current.handleScroll();
    });
    const offsets = computeRowOffsets(20, -1, 0);
    // start = max(0, findRowIndex(160) - 10) = 0；end = min(19, findRowIndex(224) + 10) = 17
    expect(result.current.startIndex).toBe(0);
    expect(result.current.endIndex).toBe(17);
    expect(result.current.offsetY).toBe(offsets[0]);
  });

  it('窗口偏移随 startIndex 变化：offsetY = offsets[startIndex]', () => {
    const { result } = renderHook(() => useVirtualScroll({ ...baseOptions, rowCount: 100 }));
    act(() => {
      result.current.containerRef({
        scrollTop: 64 * 32, // 第 64 行
        clientHeight: 32 * 3,
      } as HTMLDivElement);
    });
    act(() => {
      result.current.handleScroll();
    });
    const offsets = computeRowOffsets(100, -1, 0);
    expect(result.current.offsetY).toBe(offsets[result.current.startIndex]);
    expect(result.current.startIndex).toBeGreaterThanOrEqual(50);
    expect(result.current.endIndex).toBeLessThan(100);
  });

  it('展开面板高度参与 rowOffsets：expand 行之后窗口下移', () => {
    const { result } = renderHook(() =>
      useVirtualScroll({ ...baseOptions, selectedRowIndex: 2, expandHeight: 100 }),
    );
    act(() => {
      result.current.containerRef({ scrollTop: 200, clientHeight: 64 } as HTMLDivElement);
    });
    act(() => {
      result.current.handleScroll();
    });
    // offsets: [0,32,64,196,228,...]；scrollTop 200 → 行 3 开始
    expect(result.current.startIndex).toBe(0); // 3 - 10 截断
    expect(result.current.offsetY).toBe(0);
    expect(result.current.endIndex).toBeGreaterThanOrEqual(13); // 3 + 10
  });

  it('hasMore 时创建 IntersectionObserver，交叉触发 onLoadMore', () => {
    const onLoadMore = vi.fn();
    const { result, rerender } = renderHook((opts) => useVirtualScroll(opts), {
      initialProps: { ...baseOptions, hasMore: false, onLoadMore },
    });
    // 模拟真实时序：sentinel 先挂载，再开启 hasMore
    result.current.sentinelRef.current = document.createElement('div');
    rerender({ ...baseOptions, hasMore: true, onLoadMore });
    expect(IOMock.instances).toHaveLength(1);
    const io = IOMock.instances[0]!;
    act(() => {
      io.callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        io as unknown as IntersectionObserver,
      );
    });
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    act(() => {
      io.callback(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        io as unknown as IntersectionObserver,
      );
    });
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('hasMore=false 时不创建 IntersectionObserver', () => {
    renderHook(() => useVirtualScroll(baseOptions));
    expect(IOMock.instances).toHaveLength(0);
  });

  it('视口测量：容器未挂载时不创建 ResizeObserver（挂载行为由 useMeasure 测试覆盖）', () => {
    // renderHook 无 DOM，callback ref 未被调用 → node 为 null，RO 不创建
    renderHook(() => useVirtualScroll(baseOptions));
    expect(ROMock.instances).toHaveLength(0);
  });

  it('卸载时清理 IntersectionObserver', () => {
    const { result, rerender, unmount } = renderHook((opts) => useVirtualScroll(opts), {
      initialProps: { ...baseOptions, hasMore: false },
    });
    result.current.sentinelRef.current = document.createElement('div');
    rerender({ ...baseOptions, hasMore: true });
    const io = IOMock.instances[0]!;
    unmount();
    expect(io.disconnected).toBe(true);
  });
});
