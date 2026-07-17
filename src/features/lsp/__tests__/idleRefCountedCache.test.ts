import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IdleRefCountedCache } from '../idleRefCountedCache';

describe('IdleRefCountedCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should_reuse_the_same_value_while_referenced', () => {
    let creates = 0;
    const cache = new IdleRefCountedCache<string>({ destroyDelayMs: 1000 });

    const a = cache.acquire('go', () => {
      creates += 1;
      return 'client-1';
    });
    const b = cache.acquire('go', () => {
      creates += 1;
      return 'client-2';
    });

    expect(a).toBe('client-1');
    expect(b).toBe('client-1');
    expect(creates).toBe(1);
  });

  it('should_not_destroy_immediately_on_release_to_zero', () => {
    const destroyed: string[] = [];
    const cache = new IdleRefCountedCache<string>({
      destroyDelayMs: 1000,
      onDestroy: (key, value) => destroyed.push(`${key}:${value}`),
    });

    cache.acquire('go', () => 'c1');
    cache.release('go');

    expect(destroyed).toEqual([]);
    expect(cache.has('go')).toBe(true);
  });

  it('should_cancel_pending_destroy_when_reacquired', () => {
    const destroyed: string[] = [];
    let creates = 0;
    const cache = new IdleRefCountedCache<string>({
      destroyDelayMs: 1000,
      onDestroy: (key, value) => destroyed.push(`${key}:${value}`),
    });

    cache.acquire('go', () => {
      creates += 1;
      return 'c1';
    });
    cache.release('go'); // schedule destroy

    // Re-acquire before timer fires (tab switch A → B)
    const again = cache.acquire('go', () => {
      creates += 1;
      return 'c2';
    });

    vi.advanceTimersByTime(1000);

    expect(again).toBe('c1');
    expect(creates).toBe(1);
    expect(destroyed).toEqual([]);
  });

  it('should_destroy_after_idle_delay_when_not_reacquired', () => {
    const destroyed: string[] = [];
    const cache = new IdleRefCountedCache<string>({
      destroyDelayMs: 500,
      onDestroy: (key, value) => destroyed.push(`${key}:${value}`),
    });

    cache.acquire('go', () => 'c1');
    cache.release('go');

    vi.advanceTimersByTime(499);
    expect(destroyed).toEqual([]);
    expect(cache.has('go')).toBe(true);

    vi.advanceTimersByTime(1);
    expect(destroyed).toEqual(['go:c1']);
    expect(cache.has('go')).toBe(false);
  });
});
