/**
 * `useGithubPrs`：可用性 + 开关 + 列表的因果链。
 *
 * 只 mock **api 层**（`features/git/api/gitApi`）：`gh` 探测与 `list_prs` 都是外部进程调用，
 * 在这一层替换即可，`invoke` 不必也不该 mock。
 *
 * 钉住的五条（每一条的反面都是一类真实的坏行为）：
 * 1. 开关**默认关**：不勾就不许打 `gh`（默认打开 = 替用户接受外部依赖，design §8.3）；
 * 2. `gh` 不可用 ⇒ 不请求 + 给原因（沉默的 disabled 勾选框等同于坏了；把探测失败当"已登录"
 *    会让用户以为自己配错了）；
 * 3. 勾上 ⇒ 拉一次；
 * 4. **同一 workspace 重复开只拉一次**（关掉不清缓存，勾回来不再打 `gh`）；
 * 5. 失败保留旧列表 + 记 error（一次网络抖动不该清空看板，也不该让 PR 看起来"被合掉"）。
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const gitApi = vi.hoisted(() => ({
  isGhInstalled: vi.fn(),
  isGhAuthenticated: vi.fn(),
  listPrs: vi.fn(),
}));

vi.mock('../../../git/api/gitApi', () => gitApi);

import type { PRListItem } from '@/shared/types/git';

import { PROVIDER_STORAGE_KEY } from '../../utils/providerPreference';
import { useGithubPrs } from '../useGithubPrs';

function pr(overrides: Partial<PRListItem> = {}): PRListItem {
  return {
    number: 128,
    title: '统一任务中心',
    state: 'OPEN',
    author: 'tincopper',
    headRefName: 'feat/x',
    baseRefName: 'main',
    createdAt: '2026-11-02T10:00:00Z',
    isCrossRepository: false,
    headRepositoryOwner: 'tincopper',
    labels: [],
    assignees: [],
    ...overrides,
  };
}

/** 装载 hook 并等到 `gh` 探测落地（不等的话后续断言会与探测抢时序）。 */
async function mount(projectId: string | null = 'p1') {
  const rendered = renderHook(() => useGithubPrs(projectId, 'neeko'));
  if (projectId !== null) {
    // 探测结果是 `ready` 还是 `blocked` 由各用例决定，这里只等它离开 `checking`。
    await waitFor(() => expect(rendered.result.current.availability).not.toBe('checking'));
  }
  return rendered;
}

beforeEach(() => {
  window.localStorage.clear();
  gitApi.isGhInstalled.mockReset();
  gitApi.isGhAuthenticated.mockReset();
  gitApi.listPrs.mockReset();
  gitApi.isGhInstalled.mockResolvedValue(true);
  gitApi.isGhAuthenticated.mockResolvedValue(true);
  gitApi.listPrs.mockResolvedValue([]);
});

describe('useGithubPrs — 开关默认关', () => {
  it('挂载时不发 PR 请求（默认关闭，design §8.3）', async () => {
    const { result } = await mount();

    expect(result.current.enabled).toBe(false);
    expect(result.current.items).toEqual([]);
    expect(gitApi.listPrs).not.toHaveBeenCalled();
  });

  it('偏好里是 true 时自动拉一次（用户上次显式打开过）', async () => {
    window.localStorage.setItem(PROVIDER_STORAGE_KEY, 'true');
    gitApi.listPrs.mockResolvedValue([pr()]);

    const { result } = await mount();

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.enabled).toBe(true);
    expect(gitApi.listPrs).toHaveBeenCalledTimes(1);
  });

  it('勾选 / 取消都落 localStorage（下次挂载仍按用户的选择）', async () => {
    const { result } = await mount();

    act(() => result.current.setEnabled(true));
    expect(window.localStorage.getItem(PROVIDER_STORAGE_KEY)).toBe('true');

    act(() => result.current.setEnabled(false));
    expect(window.localStorage.getItem(PROVIDER_STORAGE_KEY)).toBe('false');
  });
});

describe('useGithubPrs — gh 可用性', () => {
  it('未安装：不可用 + 原因，且不请求（勾了也不请求）', async () => {
    gitApi.isGhInstalled.mockResolvedValue(false);
    const { result } = await mount();

    expect(result.current.availability).toBe('blocked');
    expect(result.current.blockedReason).toBe('GitHub CLI (gh) is not installed');

    act(() => result.current.setEnabled(true));
    await Promise.resolve();
    expect(gitApi.listPrs).not.toHaveBeenCalled();
    expect(result.current.items).toEqual([]);
  });

  it('未登录：不可用 + 指向 `gh auth login`', async () => {
    gitApi.isGhAuthenticated.mockResolvedValue(false);
    const { result } = await mount();

    expect(result.current.blockedReason).toBe(
      'GitHub CLI (gh) is not logged in (run: gh auth login)',
    );
    expect(gitApi.listPrs).not.toHaveBeenCalled();
  });

  it('探测失败按「不可用」处理（不把失败当成已登录）', async () => {
    gitApi.isGhInstalled.mockRejectedValue(new Error('spawn failed'));
    const { result } = await mount();

    expect(result.current.availability).toBe('blocked');
    expect(result.current.blockedReason).toBe(
      'Cannot confirm whether GitHub CLI (gh) is installed',
    );
  });

  it('登录探测失败同样不可用（此时不能保证能拉）', async () => {
    gitApi.isGhAuthenticated.mockRejectedValue(new Error('timeout'));
    const { result } = await mount();

    expect(result.current.blockedReason).toBe('Cannot confirm GitHub CLI (gh) login status');
  });

  it('No active project：不探测、不可用，原因是「No active project」', async () => {
    const { result } = await mount(null);

    expect(gitApi.isGhInstalled).not.toHaveBeenCalled();
    expect(result.current.availability).toBe('blocked');
    expect(result.current.blockedReason).toBe('No active project');
  });
});

describe('useGithubPrs — 拉取与去重', () => {
  it('勾上后拉一次：按 all + 50，结果映射成看板条目', async () => {
    gitApi.listPrs.mockResolvedValue([pr(), pr({ number: 129, title: '第二条' })]);
    const { result } = await mount();

    act(() => result.current.setEnabled(true));

    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(gitApi.listPrs).toHaveBeenCalledTimes(1);
    expect(gitApi.listPrs).toHaveBeenCalledWith(expect.anything(), 'all', 50);
    expect(result.current.items[0].id).toBe('github:pr:128');
    expect(result.current.loading).toBe(false);
  });

  it('同一 workspace 重复开只拉一次：关掉再勾回来直接复用上一次的结果', async () => {
    gitApi.listPrs.mockResolvedValue([pr()]);
    const { result } = await mount();

    act(() => result.current.setEnabled(true));
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    act(() => result.current.setEnabled(false));
    expect(result.current.items).toEqual([]);

    act(() => result.current.setEnabled(true));
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    expect(gitApi.listPrs).toHaveBeenCalledTimes(1);
  });

  it('刷新（显式动作）绕过去重再拉一次', async () => {
    gitApi.listPrs.mockResolvedValue([pr()]);
    const { result } = await mount();

    act(() => result.current.setEnabled(true));
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    act(() => result.current.refresh());

    await waitFor(() => expect(gitApi.listPrs).toHaveBeenCalledTimes(2));
  });

  it('失败保留旧列表 + 记可读错误（一次抖动不该清空看板）', async () => {
    gitApi.listPrs.mockResolvedValueOnce([pr()]);
    const { result } = await mount();

    act(() => result.current.setEnabled(true));
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    gitApi.listPrs.mockRejectedValueOnce('gh: connection reset');
    act(() => result.current.refresh());

    await waitFor(() => expect(result.current.error).toBe('gh: connection reset'));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.loading).toBe(false);
  });
});
