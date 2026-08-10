import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as searchApi from '@/features/search/api/searchApi';
import type { SearchResponse } from '@/shared/types/search';

import { useSearchStore, resetSearchState } from '../searchStore';

function makeResponse(overrides: Partial<SearchResponse> = {}): SearchResponse {
  return {
    requestId: 'req-1',
    query: 'foo',
    projectId: 'p-1',
    matches: [
      {
        path: 'src/a.rs',
        matches: [{ path: 'src/a.rs', line: 3, column: 1, lineText: 'foo bar' }],
      },
    ],
    cursor: { offset: 10, totalPages: -1 },
    truncated: false,
    ...overrides,
  };
}

describe('searchStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSearchState();
  });

  it('run: fresh start writes results and cursor', async () => {
    vi.spyOn(searchApi, 'runSearch').mockResolvedValue(makeResponse());

    await useSearchStore.getState().run('p-1', 'foo', { regex: false });

    const s = useSearchStore.getState();
    expect(s.requestId).toBe('req-1');
    expect(s.fileGroups).toHaveLength(1);
    expect(s.fileGroups[0].matches[0].lineText).toBe('foo bar');
    expect(s.offset).toBe(10);
    expect(s.status).toBe('idle');
    expect(s.query).toBe('foo');
  });

  it('run: sends options with a default mode so the backend can deserialize', async () => {
    const runSpy = vi.spyOn(searchApi, 'runSearch').mockResolvedValue(makeResponse());

    await useSearchStore.getState().run('p-1', 'foo', {});

    const arg = runSpy.mock.calls[0][0];
    expect(arg.options).toBeDefined();
    expect(arg.options.mode).toBe('Content');
  });

  it('next: pagination appends without overwriting', async () => {
    const page1 = makeResponse({ cursor: { offset: 1, totalPages: -1 } });
    const page2 = makeResponse({
      requestId: 'req-2',
      matches: [
        { path: 'src/b.rs', matches: [{ path: 'src/b.rs', line: 9, column: 0, lineText: 'zzz' }] },
      ],
      cursor: { offset: 2, totalPages: -1 },
    });
    vi.spyOn(searchApi, 'runSearch').mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);

    await useSearchStore.getState().run('p-1', 'foo', {});
    await useSearchStore.getState().next('p-1');

    const s = useSearchStore.getState();
    expect(s.fileGroups.map((f) => f.path)).toEqual(['src/a.rs', 'src/b.rs']);
    expect(s.offset).toBe(2);
  });

  it('same query repeated run clears old results', async () => {
    const page1 = makeResponse();
    vi.spyOn(searchApi, 'runSearch')
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(makeResponse({ requestId: 'req-2', matches: [] }));
    await useSearchStore.getState().run('p-1', 'foo', {});
    await useSearchStore.getState().run('p-1', 'foo', {});

    expect(useSearchStore.getState().fileGroups).toHaveLength(0);
  });

  it('switching query resets pagination', async () => {
    const runSpy = vi.spyOn(searchApi, 'runSearch').mockResolvedValue(makeResponse());

    await useSearchStore.getState().run('p-1', 'aaa', {});
    await useSearchStore.getState().run('p-1', 'bbb', {});

    expect(runSpy).toHaveBeenCalledTimes(2);
    // Second call should start from offset 0.
    expect(runSpy.mock.calls[1][0].offset).toBe(0);
  });

  it('run failure: enters error state', async () => {
    vi.spyOn(searchApi, 'runSearch').mockRejectedValue(new Error('boom'));

    await useSearchStore.getState().run('p-1', 'foo', {});

    const s = useSearchStore.getState();
    expect(s.status).toBe('error');
    expect(s.error).toContain('boom');
  });

  it('stop: cancels in-flight search and calls backend', async () => {
    useSearchStore.setState({ requestId: 'req-live' });
    const stopSpy = vi.spyOn(searchApi, 'stopSearch').mockResolvedValue(undefined);

    await useSearchStore.getState().stop();

    expect(stopSpy).toHaveBeenCalledWith('req-live');
    expect(useSearchStore.getState().status).toBe('idle');
    expect(useSearchStore.getState().requestId).toBeNull();
  });

  it('clear: resets all state', () => {
    useSearchStore.setState({ fileGroups: [], query: 'foo', status: 'error' });
    useSearchStore.getState().clear();
    expect(useSearchStore.getState().query).toBe('');
    expect(useSearchStore.getState().status).toBe('idle');
    expect(useSearchStore.getState().fileGroups).toEqual([]);
  });
});
