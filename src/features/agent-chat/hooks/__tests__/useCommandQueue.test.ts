import { renderHook, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useCommandQueue } from '../useCommandQueue';

describe('useCommandQueue', () => {
  it('初始状态为空队列', () => {
    const { result } = renderHook(() => useCommandQueue());
    expect(result.current.queue).toEqual([]);
  });

  it('enqueue 添加消息到队列', () => {
    const { result } = renderHook(() => useCommandQueue());

    act(() => result.current.enqueue('第一条'));
    act(() => result.current.enqueue('第二条'));

    expect(result.current.queue).toHaveLength(2);
    expect(result.current.queue[0].text).toBe('第一条');
    expect(result.current.queue[1].text).toBe('第二条');
    expect(result.current.queue[0].status).toBe('queued');
  });

  it('消息有唯一 ID', () => {
    const { result } = renderHook(() => useCommandQueue());

    act(() => result.current.enqueue('第一条'));
    act(() => result.current.enqueue('第二条'));

    expect(result.current.queue[0].id).toBeTruthy();
    expect(result.current.queue[1].id).toBeTruthy();
    expect(result.current.queue[0].id).not.toBe(result.current.queue[1].id);
  });

  it('队列消息按 FIFO 顺序排列', () => {
    const { result } = renderHook(() => useCommandQueue());

    act(() => result.current.enqueue('first'));
    act(() => result.current.enqueue('second'));
    act(() => result.current.enqueue('third'));

    expect(result.current.queue.map((m) => m.text)).toEqual(['first', 'second', 'third']);
  });

  it('同一 session 多次 hook 调用独立', () => {
    const { result: r1 } = renderHook(() => useCommandQueue());
    const { result: r2 } = renderHook(() => useCommandQueue());

    act(() => r1.current.enqueue('msg-s1'));
    act(() => r2.current.enqueue('msg-s2'));

    expect(r1.current.queue).toHaveLength(1);
    expect(r2.current.queue).toHaveLength(1);
    expect(r1.current.queue[0].text).toBe('msg-s1');
    expect(r2.current.queue[0].text).toBe('msg-s2');
  });
});
