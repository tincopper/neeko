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

  it('should_reuse_a_pending_promise_by_default', async () => {
    const fetchFn = vi.fn().mockResolvedValue(result());
    const key = 'proj||file:///a.rs||0||1';

    const p1 = getOrFetchDefinition(key, fetchFn);
    const p2 = getOrFetchDefinition(key, fetchFn);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
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

  it('should_reuse_a_completed_cache_entry_even_with_skip_pending', async () => {
    const fetchFn = vi.fn().mockResolvedValue(result());
    const key = 'proj||file:///a.rs||0||1';

    await getOrFetchDefinition(key, fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    const cached = await getOrFetchDefinition(key, fetchFn, { skipPending: true });
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
