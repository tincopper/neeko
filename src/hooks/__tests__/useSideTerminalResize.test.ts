import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSideTerminalResize } from '../../hooks/useSideTerminalResize';

// mock requestAnimationFrame / cancelAnimationFrame
const rafCallbacks: Map<number, FrameRequestCallback> = new Map();
let rafId = 0;

beforeEach(() => {
  rafCallbacks.clear();
  rafId = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = ++rafId;
    rafCallbacks.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    rafCallbacks.delete(id);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function flushRAF() {
  for (const [id, cb] of rafCallbacks) {
    rafCallbacks.delete(id);
    cb(0);
  }
}

describe('useSideTerminalResize', () => {
  const defaultOnWidthChange = vi.fn();

  beforeEach(() => {
    defaultOnWidthChange.mockReset();
  });

  it('使用初始宽度', () => {
    const { result } = renderHook(() =>
      useSideTerminalResize(400, defaultOnWidthChange),
    );
    expect(result.current.sideTerminalWidth).toBe(400);
  });

  it('setSideTerminalWidth 直接更新宽度', () => {
    const { result } = renderHook(() =>
      useSideTerminalResize(400, defaultOnWidthChange),
    );

    act(() => {
      result.current.setSideTerminalWidth(600);
    });

    expect(result.current.sideTerminalWidth).toBe(600);
  });

  it('拖拽时宽度约束在 200-1200 之间', () => {
    const { result } = renderHook(() =>
      useSideTerminalResize(500, defaultOnWidthChange),
    );

    // 模拟 mousedown
    const mouseDownEvent = {
      preventDefault: vi.fn(),
      clientX: 500,
    } as unknown as React.MouseEvent;

    act(() => {
      result.current.handleSideDividerMouseDown(mouseDownEvent);
    });

    // 向右拖拽 400px（宽度会变窄），使宽度变成 100（低于最小值 200）
    const mouseMoveEvent = new MouseEvent('mousemove', { clientX: 900 });
    document.dispatchEvent(mouseMoveEvent);

    flushRAF();

    expect(result.current.sideTerminalWidth).toBeGreaterThanOrEqual(200);
  });

  it('拖拽结束时调用 onWidthChange 回调', () => {
    const onWidthChange = vi.fn();
    const { result } = renderHook(() =>
      useSideTerminalResize(500, onWidthChange),
    );

    const mouseDownEvent = {
      preventDefault: vi.fn(),
      clientX: 500,
    } as unknown as React.MouseEvent;

    act(() => {
      result.current.handleSideDividerMouseDown(mouseDownEvent);
    });

    // 向左拖拽 100px → 宽度增加到 600
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 400 }));
    flushRAF();
    document.dispatchEvent(new MouseEvent('mouseup'));

    expect(onWidthChange).toHaveBeenCalled();
    expect(onWidthChange.mock.calls[0][0]).toBe(600);
  });

  it('suppressResizeRef 为 true 时抑制 resize', () => {
    const suppressRef = { current: false };
    const { result } = renderHook(() =>
      useSideTerminalResize(500, defaultOnWidthChange, suppressRef),
    );

    const mouseDownEvent = {
      preventDefault: vi.fn(),
      clientX: 500,
    } as unknown as React.MouseEvent;

    act(() => {
      result.current.handleSideDividerMouseDown(mouseDownEvent);
    });

    // 拖拽期间 suppressResizeRef 应为 true
    expect(suppressRef.current).toBe(true);

    document.dispatchEvent(new MouseEvent('mouseup'));

    // 释放后恢复
    expect(suppressRef.current).toBe(false);
  });
});
