import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createDebouncedLatestRunner,
  LatestRequestTracker,
} from '../requestTracker';

describe('LatestRequestTracker', () => {
  it('should_treat_only_the_latest_token_as_current', () => {
    const tracker = new LatestRequestTracker();
    const first = tracker.next();
    const second = tracker.next();

    expect(tracker.isCurrent(first)).toBe(false);
    expect(tracker.isCurrent(second)).toBe(true);
  });

  it('should_invalidate_all_in_flight_tokens', () => {
    const tracker = new LatestRequestTracker();
    const token = tracker.next();
    tracker.invalidate();

    expect(tracker.isCurrent(token)).toBe(false);
  });

  it('should_return_null_result_when_stale_after_async_work', async () => {
    const tracker = new LatestRequestTracker();
    const token = tracker.next();

    // Newer request supersedes the first before it finishes
    tracker.next();

    const result = await tracker.runIfCurrent(token, async () => 'hover-data');
    expect(result).toBeNull();
  });

  it('should_return_value_when_still_current_after_async_work', async () => {
    const tracker = new LatestRequestTracker();
    const token = tracker.next();

    const result = await tracker.runIfCurrent(token, async () => 'hover-data');
    expect(result).toBe('hover-data');
  });
});

describe('createDebouncedLatestRunner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should_only_run_the_latest_call_after_debounce', async () => {
    const calls: number[] = [];
    const runner = createDebouncedLatestRunner<number>({ debounceMs: 100 });

    const p1 = runner.schedule(1, async (v) => {
      calls.push(v);
      return v;
    });
    const p2 = runner.schedule(2, async (v) => {
      calls.push(v);
      return v;
    });
    const p3 = runner.schedule(3, async (v) => {
      calls.push(v);
      return v;
    });

    await vi.advanceTimersByTimeAsync(100);

    await expect(p1).resolves.toBeNull();
    await expect(p2).resolves.toBeNull();
    await expect(p3).resolves.toBe(3);
    expect(calls).toEqual([3]);
  });

  it('should_cancel_pending_debounce_on_cancel', async () => {
    const calls: number[] = [];
    const runner = createDebouncedLatestRunner<number>({ debounceMs: 100 });

    const p = runner.schedule(1, async (v) => {
      calls.push(v);
      return v;
    });
    runner.cancel();

    await vi.advanceTimersByTimeAsync(100);
    await expect(p).resolves.toBeNull();
    expect(calls).toEqual([]);
  });
});
