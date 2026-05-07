import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProjectItemDrag } from '../useProjectItemDrag';

// Mock document.elementsFromPoint (not available in jsdom)
const mockElementsFromPoint = vi.fn(() => []);
Object.defineProperty(document, 'elementsFromPoint', {
  value: mockElementsFromPoint,
  writable: true,
});

describe('useProjectItemDrag', () => {
  const mockOnDragEnd = vi.fn();

  beforeEach(() => {
    mockOnDragEnd.mockReset();
    mockElementsFromPoint.mockReturnValue([]);
  });

  it('初始状态', () => {
    const { result } = renderHook(() =>
      useProjectItemDrag({ projectId: 'p1', onDragEnd: mockOnDragEnd })
    );

    expect(result.current.isDragging).toBe(false);
    expect(result.current.dragOffset).toEqual({ x: 0, y: 0 });
    expect(result.current.dropIndicator).toBeNull();
  });

  it('指针按下不激活拖拽（未超过阈值）', () => {
    const { result } = renderHook(() =>
      useProjectItemDrag({ projectId: 'p1', onDragEnd: mockOnDragEnd })
    );

    const target = document.createElement('div');
    target.setPointerCapture = vi.fn();
    target.releasePointerCapture = vi.fn();

    act(() => {
      result.current.handlePointerDown({
        button: 0,
        clientX: 100,
        clientY: 100,
        target,
      } as unknown as React.PointerEvent);
    });

    act(() => {
      result.current.handlePointerMove({
        clientX: 102,
        clientY: 102,
        target,
      } as unknown as React.PointerEvent);
    });

    expect(result.current.isDragging).toBe(false);
    expect(result.current.dragOffset).toEqual({ x: 0, y: 0 });
  });

  it('超过阈值后激活拖拽', () => {
    const { result } = renderHook(() =>
      useProjectItemDrag({ projectId: 'p1', onDragEnd: mockOnDragEnd })
    );

    const target = document.createElement('div');
    target.setPointerCapture = vi.fn();
    target.releasePointerCapture = vi.fn();

    act(() => {
      result.current.handlePointerDown({
        button: 0,
        clientX: 100,
        clientY: 100,
        target,
      } as unknown as React.PointerEvent);
    });

    act(() => {
      result.current.handlePointerMove({
        clientX: 110,
        clientY: 110,
        target,
      } as unknown as React.PointerEvent);
    });

    expect(result.current.isDragging).toBe(true);
    expect(result.current.dragOffset).toEqual({ x: 10, y: 10 });
  });

  it('非主键按下不激活拖拽', () => {
    const { result } = renderHook(() =>
      useProjectItemDrag({ projectId: 'p1', onDragEnd: mockOnDragEnd })
    );

    const target = document.createElement('div');
    target.setPointerCapture = vi.fn();

    act(() => {
      result.current.handlePointerDown({
        button: 1, // 右键
        clientX: 100,
        clientY: 100,
        target,
      } as unknown as React.PointerEvent);
    });

    act(() => {
      result.current.handlePointerMove({
        clientX: 110,
        clientY: 110,
        target,
      } as unknown as React.PointerEvent);
    });

    expect(result.current.isDragging).toBe(false);
  });

  it('释放时重置状态', () => {
    const { result } = renderHook(() =>
      useProjectItemDrag({ projectId: 'p1', onDragEnd: mockOnDragEnd })
    );

    const target = document.createElement('div');
    target.setPointerCapture = vi.fn();
    target.releasePointerCapture = vi.fn();

    act(() => {
      result.current.handlePointerDown({
        button: 0,
        clientX: 100,
        clientY: 100,
        target,
      } as unknown as React.PointerEvent);
    });

    act(() => {
      result.current.handlePointerMove({
        clientX: 110,
        clientY: 110,
        target,
      } as unknown as React.PointerEvent);
    });

    expect(result.current.isDragging).toBe(true);

    act(() => {
      result.current.handlePointerUp({
        clientX: 110,
        clientY: 110,
        target,
      } as unknown as React.PointerEvent);
    });

    expect(result.current.isDragging).toBe(false);
    expect(result.current.dragOffset).toEqual({ x: 0, y: 0 });
    expect(result.current.dropIndicator).toBeNull();
  });

  it('指针取消时重置状态', () => {
    const { result } = renderHook(() =>
      useProjectItemDrag({ projectId: 'p1', onDragEnd: mockOnDragEnd })
    );

    const target = document.createElement('div');
    target.setPointerCapture = vi.fn();

    act(() => {
      result.current.handlePointerDown({
        button: 0,
        clientX: 100,
        clientY: 100,
        target,
      } as unknown as React.PointerEvent);
    });

    act(() => {
      result.current.handlePointerMove({
        clientX: 110,
        clientY: 110,
        target,
      } as unknown as React.PointerEvent);
    });

    act(() => {
      result.current.handlePointerCancel();
    });

    expect(result.current.isDragging).toBe(false);
    expect(result.current.dragOffset).toEqual({ x: 0, y: 0 });
    expect(result.current.dropIndicator).toBeNull();
  });

  it('拖拽结束时调用 onDragEnd', () => {
    const { result } = renderHook(() =>
      useProjectItemDrag({ projectId: 'p1', onDragEnd: mockOnDragEnd })
    );

    const target = document.createElement('div');
    target.setPointerCapture = vi.fn();
    target.releasePointerCapture = vi.fn();

    // Mock elementsFromPoint to return a drop target
    const mockTargetEl = document.createElement('div');
    mockTargetEl.dataset.dragId = 'p2';
    mockTargetEl.getBoundingClientRect = () => ({
      top: 200,
      bottom: 220,
      left: 0,
      right: 100,
      width: 100,
      height: 20,
      x: 0,
      y: 200,
      toJSON: () => {},
    });
    mockElementsFromPoint.mockReturnValue([mockTargetEl]);

    act(() => {
      result.current.handlePointerDown({
        button: 0,
        clientX: 100,
        clientY: 100,
        target,
      } as unknown as React.PointerEvent);
    });

    act(() => {
      result.current.handlePointerMove({
        clientX: 110,
        clientY: 200,
        target,
      } as unknown as React.PointerEvent);
    });

    act(() => {
      result.current.handlePointerUp({
        clientX: 110,
        clientY: 200,
        target,
      } as unknown as React.PointerEvent);
    });

    expect(mockOnDragEnd).toHaveBeenCalledWith('p1', 'p2');
  });

  it('拖拽结束时如果没有 drop target 不调用 onDragEnd', () => {
    const { result } = renderHook(() =>
      useProjectItemDrag({ projectId: 'p1', onDragEnd: mockOnDragEnd })
    );

    const target = document.createElement('div');
    target.setPointerCapture = vi.fn();
    target.releasePointerCapture = vi.fn();

    // elementsFromPoint returns empty (no drop target)
    mockElementsFromPoint.mockReturnValue([]);

    act(() => {
      result.current.handlePointerDown({
        button: 0,
        clientX: 100,
        clientY: 100,
        target,
      } as unknown as React.PointerEvent);
    });

    act(() => {
      result.current.handlePointerMove({
        clientX: 110,
        clientY: 110,
        target,
      } as unknown as React.PointerEvent);
    });

    act(() => {
      result.current.handlePointerUp({
        clientX: 110,
        clientY: 110,
        target,
      } as unknown as React.PointerEvent);
    });

    expect(mockOnDragEnd).not.toHaveBeenCalled();
  });
});
