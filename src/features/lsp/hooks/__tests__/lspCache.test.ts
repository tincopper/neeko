import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetDefinitionCachesForTests, getOrFetchDefinition } from '../lspCache';

function result(location = 'file:///target.rs') {
  return {
    lspResult: {
      uri: location,
      range: { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } },
    },
    fileContent: null,
  };
}

describe('getOrFetchDefinition', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetDefinitionCachesForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should_reuse_a_pending_promise_within_share_window', async () => {
    const fetchFn = vi.fn().mockResolvedValue(result());
    const key = 'proj||file:///a.rs||0||1';

    const p1 = getOrFetchDefinition(key, fetchFn);
    vi.advanceTimersByTime(500);
    const p2 = getOrFetchDefinition(key, fetchFn, { sharePendingWithinMs: 15_000 });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(result());
    expect(r2).toEqual(result());
  });

  it('should_share_a_recent_pending_for_an_explicit_jump', async () => {
    // 双击/跳转与 probe 同位（同 cache key）时共享新鲜 pending，消除双倍请求
    const fetchFn = vi.fn().mockResolvedValue(result());
    const key = 'proj||file:///a.rs||0||1';

    const p1 = getOrFetchDefinition(key, fetchFn);
    vi.advanceTimersByTime(400);
    const jump = getOrFetchDefinition(key, fetchFn, { sharePendingWithinMs: 1000 });

    const [, r2] = await Promise.all([p1, jump]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(r2).toEqual(result());
  });

  it('should_not_share_a_stale_pending_beyond_share_window', async () => {
    const fetchFn = vi.fn().mockResolvedValue(result());
    const key = 'proj||file:///a.rs||0||1';

    const p1 = getOrFetchDefinition(key, fetchFn);
    vi.advanceTimersByTime(2000);
    const fresh = getOrFetchDefinition(key, fetchFn, { sharePendingWithinMs: 1000 });

    const [, r2] = await Promise.all([p1, fresh]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(r2).toEqual(result());
  });

  it('should_fetch_fresh_when_no_share_window_is_given', async () => {
    const fetchFn = vi.fn().mockResolvedValue(result());
    const key = 'proj||file:///a.rs||0||1';

    // First call starts an in-flight (pending) request for this key.
    const pending = getOrFetchDefinition(key, fetchFn);

    // 未给共享窗口 → 永不等待在途请求（显式跳转需要全新结果的保守路径）。
    const fresh = getOrFetchDefinition(key, fetchFn);

    const [r1, r2] = await Promise.all([pending, fresh]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(r1).toEqual(result());
    expect(r2).toEqual(result());
  });

  it('should_fetch_fresh_when_skip_pending_and_previous_is_in_flight', async () => {
    const fetchFn = vi.fn().mockResolvedValue(result());
    const key = 'proj||file:///a.rs||0||1';

    // First call starts an in-flight (pending) request for this key.
    const pending = getOrFetchDefinition(key, fetchFn);

    // An explicit jump must NOT wait on the hover probe's pending promise:
    // that promise can resolve null when the probe is single-flight-cancelled.
    const fresh = getOrFetchDefinition(key, fetchFn, { skipPending: true });

    const [r1, r2] = await Promise.all([pending, fresh]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(r1).toEqual(result());
    expect(r2).toEqual(result());
  });

  it('should_reuse_a_completed_cache_entry_over_the_share_window', async () => {
    const fetchFn = vi.fn().mockResolvedValue(result());
    const key = 'proj||file:///a.rs||0||1';

    await getOrFetchDefinition(key, fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    const cached = await getOrFetchDefinition(key, fetchFn, { sharePendingWithinMs: 15_000 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(cached).toEqual(result());
  });

  it('should_not_cache_a_null_lsp_result', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ lspResult: null, fileContent: null })
      .mockResolvedValueOnce(result());
    const key = 'proj||file:///a.rs||0||1';

    const first = await getOrFetchDefinition(key, fetchFn);
    expect(first?.lspResult).toBeNull();

    const second = await getOrFetchDefinition(key, fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(second).toEqual(result());
  });
});
