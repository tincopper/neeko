import { renderHook, act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as searchApi from '@/features/search/api/searchApi';

import { useSearch } from '../useSearch';

vi.mock('@/features/search/api/searchApi', async () => {
  const actual = await vi.importActual<typeof searchApi>('@/features/search/api/searchApi');
  return {
    ...actual,
    runSearch: vi.fn(),
    stopSearch: vi.fn(),
  };
});

const runMock = vi.mocked(searchApi.runSearch);
const stopMock = vi.mocked(searchApi.stopSearch);

function mockPage(requestId = 'req-1') {
  return {
    requestId,
    query: 'foo',
    projectId: 'p-1',
    matches: [],
    cursor: { offset: 0, totalPages: 1 },
    truncated: false,
  };
}

describe('useSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runMock.mockResolvedValue(mockPage());
    stopMock.mockResolvedValue(undefined);
  });

  it('防抖：输入停顿 300ms 后才触发搜索', async () => {
    const { result } = renderHook(() => useSearch('p-1'));

    act(() => result.current.setQuery('foo'));
    expect(runMock).not.toHaveBeenCalled();

    await act(async () => {
      await new Promise((r) => setTimeout(r, 320));
    });
    await waitFor(() => expect(runMock).toHaveBeenCalledTimes(1));
    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p-1',
        query: 'foo',
        options: { mode: 'Content' },
        offset: 0,
        limit: 100,
      }),
    );
  });

  it('空 query 不触发搜索', async () => {
    const { result } = renderHook(() => useSearch('p-1'));

    act(() => result.current.setQuery('   '));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });

    expect(runMock).not.toHaveBeenCalled();
  });

  it('无 project 时不触发搜索', async () => {
    const { result } = renderHook(() => useSearch(null));

    act(() => result.current.setQuery('foo'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });

    expect(runMock).not.toHaveBeenCalled();
  });

  it('卸载时取消进行中的搜索', async () => {
    const { result, unmount } = renderHook(() => useSearch('p-1'));

    act(() => result.current.setQuery('foo'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 320));
    });

    unmount();
    expect(stopMock).toHaveBeenCalled();
  });
});
