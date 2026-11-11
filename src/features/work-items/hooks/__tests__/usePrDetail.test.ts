/**
 * `usePrDetail`：详情的 `view_pr` 拉取（**只在真的要用它的字段时才拉**）。
 *
 * 钉住三件事：
 * 1. 没有 PR 号（本地工作项 / 详情没打开）就**不拉** —— 列表页 N 次 `viewPr` 是几百毫秒的
 *    外部进程 × N，是最容易悄悄发生的一类性能事故；
 * 2. 拿到了就是 `info`（详情要用它的 `url`）；
 * 3. 失败时 `info` 保持 `null`、原因可读 —— 不能把"读失败"当"没有地址"，两者要能分辨。
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const gitApi = vi.hoisted(() => ({ viewPr: vi.fn() }));

vi.mock('../../../git/api/gitApi', () => gitApi);

import type { PRInfo } from '@/shared/types/git';

import { usePrDetail } from '../usePrDetail';

function info(overrides: Partial<PRInfo> = {}): PRInfo {
  return {
    number: 128,
    title: '统一任务中心',
    state: 'OPEN',
    body: '正文',
    author: 'tincopper',
    headRefName: 'feat/x',
    baseRefName: 'main',
    url: 'https://github.com/tincopper/neeko/pull/128',
    createdAt: '2026-11-02T10:00:00Z',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    isDraft: false,
    isCrossRepository: false,
    statusCheckRollup: null,
    ...overrides,
  };
}

beforeEach(() => {
  gitApi.viewPr.mockReset();
  gitApi.viewPr.mockResolvedValue(info());
});

describe('usePrDetail', () => {
  it('没有 PR 号就不拉（本地工作项 / 详情没打开）', () => {
    const { result } = renderHook(() => usePrDetail('p1', null));

    expect(gitApi.viewPr).not.toHaveBeenCalled();
    expect(result.current.info).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('拿到详情：url 与正文就位，loading 归零', async () => {
    const { result } = renderHook(() => usePrDetail('p1', 128));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.info).not.toBeNull());
    expect(result.current.info?.url).toBe('https://github.com/tincopper/neeko/pull/128');
    expect(result.current.info?.body).toBe('正文');
    expect(result.current.loading).toBe(false);
    expect(gitApi.viewPr).toHaveBeenCalledWith(expect.anything(), 128);
  });

  it('失败：info 为 null、错误可读（不能把「读失败」当成「没有地址」）', async () => {
    gitApi.viewPr.mockRejectedValue('gh: no such PR');
    const { result } = renderHook(() => usePrDetail('p1', 128));

    await waitFor(() => expect(result.current.error).toBe('gh: no such PR'));
    expect(result.current.info).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('重试：再拉一次（失败不是终局）', async () => {
    const { result } = renderHook(() => usePrDetail('p1', 128));
    await waitFor(() => expect(result.current.info).not.toBeNull());

    act(() => result.current.reload());

    await waitFor(() => expect(gitApi.viewPr).toHaveBeenCalledTimes(2));
  });
});
