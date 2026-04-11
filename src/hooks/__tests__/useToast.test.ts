import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useToast } from '../../hooks/useToast';

describe('useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('初始状态没有 toast', () => {
    const { result } = renderHook(() => useToast());
    expect(result.current.toast).toBeNull();
  });

  it('显示带消息和类型的 toast', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.showToast('Hello', 'info');
    });

    expect(result.current.toast).toEqual({ message: 'Hello', type: 'info' });
  });

  it('默认类型为 info', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.showToast('默认类型');
    });

    expect(result.current.toast?.type).toBe('info');
  });

  it('支持 error 类型', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.showToast('错误', 'error');
    });

    expect(result.current.toast?.type).toBe('error');
  });

  it('3 秒后自动消失', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.showToast('临时消息');
    });

    expect(result.current.toast).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(result.current.toast).toBeNull();
  });

  it('替换现有 toast 并重置计时器', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.showToast('第一条');
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    act(() => {
      result.current.showToast('第二条');
    });

    expect(result.current.toast?.message).toBe('第二条');

    // 原始计时器已被清除，第一条的 3s 到期不影响
    act(() => {
      vi.advanceTimersByTime(1500); // 离第二条仅 1500ms
    });
    expect(result.current.toast).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1500); // 离第二条共 3000ms
    });
    expect(result.current.toast).toBeNull();
  });
});
