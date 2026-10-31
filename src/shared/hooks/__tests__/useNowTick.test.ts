import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useNowTick } from '@/shared/hooks/useNowTick';

const START = Date.parse('2026-10-31T10:00:00.000Z');

describe('useNowTick', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(START));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('初值是当前时刻，之后按间隔推进', () => {
    const { result } = renderHook(() => useNowTick(10_000));
    expect(result.current).toBe(START);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current).toBe(START + 10_000);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current).toBe(START + 20_000);
  });

  it('卸载后不再推进（定时器必须清理）', () => {
    const { result, unmount } = renderHook(() => useNowTick(10_000));
    unmount();
    const frozen = result.current;
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe(frozen);
  });
});
