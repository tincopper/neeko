import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useLocalDispatch } from '../useLocalDispatch';

describe('useLocalDispatch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('返回 serverAcknowledged 方法用于确认 dispatch', () => {
    const { result } = renderHook(() => useLocalDispatch());

    const dispatch = result.current.beginLocalDispatch('msg-1');
    expect(dispatch).toHaveProperty('serverAcknowledged');
    expect(typeof dispatch.serverAcknowledged).toBe('function');
  });

  it('在 ACK 超时（10s）后调用 onAckTimeout', () => {
    const onAckTimeout = vi.fn();
    const { result } = renderHook(() => useLocalDispatch());

    result.current.beginLocalDispatch('msg-1', { onAckTimeout });

    // 9s 时不应触发
    act(() => vi.advanceTimersByTime(9_000));
    expect(onAckTimeout).not.toHaveBeenCalled();

    // 10s 时应触发
    act(() => vi.advanceTimersByTime(1_000));
    expect(onAckTimeout).toHaveBeenCalledWith('msg-1');
  });

  it('在接管超时（60s）后调用 onTakeoverTimeout', () => {
    const onTakeoverTimeout = vi.fn();
    const { result } = renderHook(() => useLocalDispatch());

    result.current.beginLocalDispatch('msg-1', { onTakeoverTimeout });

    act(() => vi.advanceTimersByTime(60_000));
    expect(onTakeoverTimeout).toHaveBeenCalledWith('msg-1');
  });

  it('serverAcknowledged 后清除所有超时计时器', () => {
    const onAckTimeout = vi.fn();
    const onTakeoverTimeout = vi.fn();
    const { result } = renderHook(() => useLocalDispatch());

    const dispatch = result.current.beginLocalDispatch('msg-1', {
      onAckTimeout,
      onTakeoverTimeout,
    });

    // 在 5s 时确认 — 不应触发任何超时
    act(() => vi.advanceTimersByTime(5_000));
    act(() => dispatch.serverAcknowledged());

    act(() => vi.advanceTimersByTime(60_000));
    expect(onAckTimeout).not.toHaveBeenCalled();
    expect(onTakeoverTimeout).not.toHaveBeenCalled();
  });

  it('每个 beginLocalDispatch 是独立的', () => {
    const onAck1 = vi.fn();
    const onAck2 = vi.fn();
    const { result } = renderHook(() => useLocalDispatch());

    result.current.beginLocalDispatch('msg-1', { onAckTimeout: onAck1 });
    result.current.beginLocalDispatch('msg-2', { onAckTimeout: onAck2 });

    act(() => vi.advanceTimersByTime(10_000));
    expect(onAck1).toHaveBeenCalledWith('msg-1');
    expect(onAck2).toHaveBeenCalledWith('msg-2');
  });
});
