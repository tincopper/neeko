// @vitest-environment node
/**
 * `fetchGithubPrs`：`listPrs` → `TaskItem[]` 的加载层。
 *
 * 只 mock **api 层**（`features/git/api/gitApi`），不 mock `invoke`：这样断言的是「我们到底让
 * 后端做了什么」（`state` / `limit` 如实传下去），而不是「我们怎么拼的 invoke 载荷」。
 *
 * 两条错误契约必须钉住，因为它们的反面都是「面板上一句没有信息量的话」：
 * 1. 后端 `AppError` 的原句要保留（`gh: Not logged in` 比「读取失败」有用一百倍）；
 * 2. 后端什么也没说时才回落固定文案。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const gitApi = vi.hoisted(() => ({ listPrs: vi.fn() }));

vi.mock('../../../git/api/gitApi', () => gitApi);

import type { PRListItem } from '@/shared/types/git';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import { fetchGithubPrs, PR_LIST_LIMIT, PR_LIST_STATE } from '../githubPr';

const WORKSPACE = WorkspaceSession.of('p1', null);

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

beforeEach(() => {
  gitApi.listPrs.mockReset();
  gitApi.listPrs.mockResolvedValue([]);
});

describe('fetchGithubPrs', () => {
  it('把 workspace / state / limit 如实交给 listPrs（本期固定 all + 50，与旧面板同档）', async () => {
    await fetchGithubPrs(WORKSPACE, 'neeko');

    expect(gitApi.listPrs).toHaveBeenCalledTimes(1);
    expect(gitApi.listPrs).toHaveBeenCalledWith(WORKSPACE, PR_LIST_STATE, PR_LIST_LIMIT);
    expect(PR_LIST_STATE).toBe('all');
    expect(PR_LIST_LIMIT).toBe(50);
  });

  it('返回映射后的 TaskItem（id 形状 + 仓库标签由入参注入）', async () => {
    gitApi.listPrs.mockResolvedValue([pr(), pr({ number: 129, state: 'MERGED', title: '第二条' })]);

    const tasks = await fetchGithubPrs(WORKSPACE, 'neeko');

    expect(tasks.map((task) => task.id)).toEqual(['github:pr:128', 'github:pr:129']);
    expect(tasks.map((task) => task.stage)).toEqual(['Review', 'Done']);
    expect(tasks[0].pr?.repo).toBe('neeko');
  });

  it('空列表就是空数组（不是错误）', async () => {
    await expect(fetchGithubPrs(WORKSPACE, 'neeko')).resolves.toEqual([]);
  });

  it('失败时错误可读：保留后端原句', async () => {
    gitApi.listPrs.mockRejectedValue('gh: Not logged in to any GitHub hosts');

    await expect(fetchGithubPrs(WORKSPACE, 'neeko')).rejects.toThrow(
      'gh: Not logged in to any GitHub hosts',
    );
  });

  it('后端什么也没说时回落固定文案（不让空消息冒到横幅上）', async () => {
    gitApi.listPrs.mockRejectedValue(null);

    await expect(fetchGithubPrs(WORKSPACE, 'neeko')).rejects.toThrow('Failed to load GitHub PRs');
  });
});
