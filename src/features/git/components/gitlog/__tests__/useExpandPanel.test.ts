import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { CommitDetail, CommitFileChange } from '@/features/git/types';

import { useExpandPanel } from '../useExpandPanel';

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

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ROMock);
});

afterEach(() => {
  ROMock.instances = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const baseProps: {
  selectedHash: string | null;
  selectedExpanded: boolean;
  detail: CommitDetail | null;
  files: CommitFileChange[];
  detailLoading: boolean;
  detailError: string | null;
} = {
  selectedHash: 'abc123',
  selectedExpanded: true,
  detail: null,
  files: [],
  detailLoading: false,
  detailError: null,
};

/** 构造带 offsetHeight 的 div */
function makeEl(offsetHeight: number): HTMLDivElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'offsetHeight', { configurable: true, value: offsetHeight });
  return el;
}

describe('useExpandPanel', () => {
  it('初始 expandHeight 为 0', () => {
    const { result } = renderHook(() => useExpandPanel(baseProps));
    expect(result.current.expandHeight).toBe(0);
  });

  it('依赖变化时重新测量 expandRef 指向元素的高度', () => {
    const { result, rerender } = renderHook((props) => useExpandPanel(props), {
      initialProps: baseProps,
    });
    result.current.expandRef.current = makeEl(120);
    act(() => {
      rerender({ ...baseProps, detailLoading: true });
    });
    expect(result.current.expandHeight).toBe(120);
    // files 变化再次重测
    result.current.expandRef.current = makeEl(200);
    act(() => {
      rerender({
        ...baseProps,
        detailLoading: true,
        files: [{ path: 'a.ts' } as CommitFileChange],
      });
    });
    expect(result.current.expandHeight).toBe(200);
  });

  it('detailError 变化也触发重测（对齐现码依赖）', () => {
    const { result, rerender } = renderHook((props) => useExpandPanel(props), {
      initialProps: baseProps,
    });
    result.current.expandRef.current = makeEl(88);
    act(() => {
      rerender({ ...baseProps, detailError: 'boom' });
    });
    expect(result.current.expandHeight).toBe(88);
  });

  it('不变量：面板在虚拟窗口外（ref 为 null）时保留上次高度，不清零', () => {
    const { result, rerender } = renderHook((props) => useExpandPanel(props), {
      initialProps: baseProps,
    });
    // 先测到 120
    result.current.expandRef.current = makeEl(120);
    act(() => {
      rerender({ ...baseProps, files: [{ path: 'b.ts' } as CommitFileChange] });
    });
    expect(result.current.expandHeight).toBe(120);
    // 面板滚出窗口：ref 置 null 后依赖变化 —— 高度必须保持 120
    result.current.expandRef.current = null;
    act(() => {
      rerender({ ...baseProps, files: [{ path: 'c.ts' } as CommitFileChange] });
    });
    expect(result.current.expandHeight).toBe(120);
  });

  it('未选中时不测量，高度保持 0', () => {
    const { result, rerender } = renderHook((props) => useExpandPanel(props), {
      initialProps: { ...baseProps, selectedExpanded: false },
    });
    result.current.expandRef.current = makeEl(120);
    act(() => {
      rerender({
        ...baseProps,
        selectedExpanded: false,
        files: [{ path: 'd.ts' } as CommitFileChange],
      });
    });
    expect(result.current.expandHeight).toBe(0);
  });

  it('卸载时断开 ResizeObserver（重测创建后清理）', () => {
    const { result, rerender, unmount } = renderHook((props) => useExpandPanel(props), {
      initialProps: baseProps,
    });
    // mount 时 ref 为 null 不创建；依赖变化重测时创建
    result.current.expandRef.current = makeEl(120);
    rerender({ ...baseProps, files: [{ path: 'x.ts' } as CommitFileChange] });
    expect(ROMock.instances).toHaveLength(1);
    const ro = ROMock.instances[0]!;
    unmount();
    expect(ro.disconnected).toBe(true);
  });
});
