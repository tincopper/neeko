// @vitest-environment node
/**
 * `viewModel`：本地工作项与 GitHub PR 共用的视图模型（纯函数 100% 覆盖是仓库红线）。
 *
 * 这里钉的不是「能不能渲染」，而是**两条来源的映射契约**：
 * 1. `toLocalTask` 只加 `source`，一个字段都不许动（本地那套 stage / 撤销 / 执行全按原样工作）；
 * 2. `prToTask` 的 id 形状、stage 落点（OPEN ⇒ Review，不是 In Progress）、以及「同一输入两次
 *    映射结果相等」—— 最后这条是 `React.memo` 与「刷新 ≠ 数据变了」的前提，任何时间/随机成分
 *    都会让它失败，所以它必须被钉住。
 */
import { describe, expect, it } from 'vitest';

import type { PRListItem } from '@/shared/types/git';

import type { WorkItem } from '../types';
import { GITHUB_PR_ID_PREFIX, prStage, prToTask, toLocalTask } from '../viewModel';

function localItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'wi_1',
    projectId: 'p1',
    title: '修复登录',
    body: '正文',
    stage: 'Ready',
    priority: 'p1',
    labels: ['bug'],
    assignee: 'tincopper',
    createdAt: 11,
    updatedAt: 22,
    ...overrides,
  };
}

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
    labels: [{ name: 'enhancement', color: 'a2eeef' }],
    assignees: [{ login: 'tincopper' }],
    ...overrides,
  };
}

describe('toLocalTask', () => {
  it('保字段：只加 source，其余逐个相等', () => {
    const source = localItem();
    const task = toLocalTask(source);

    expect(task).toEqual({ ...source, source: 'local' });
    expect(task.source).toBe('local');
    // 映射不得回写 DTO：源对象没有被加上 `source`（纯函数不该有副作用）。
    expect(source).not.toHaveProperty('source');
  });
});

describe('prStage', () => {
  it('OPEN 落在 Review —— 开着的 PR 是「等 review」，不是「还没开始」', () => {
    expect(prStage('OPEN')).toBe('Review');
  });

  it('MERGED / CLOSED 落在 Done', () => {
    expect(prStage('MERGED')).toBe('Done');
    expect(prStage('CLOSED')).toBe('Done');
  });

  it('大小写与空白不改变判据（provider 的原始值是 `OPEN`，但契约不该依赖它）', () => {
    expect(prStage(' open ')).toBe('Review');
    expect(prStage('Merged')).toBe('Done');
  });

  it('未知状态落 In Progress，不掉出看板（掉出去的卡片与「不存在」无法区分）', () => {
    expect(prStage('DRAFT')).toBe('In Progress');
    expect(prStage('')).toBe('In Progress');
  });
});

describe('prToTask', () => {
  it('id 形状是 `github:pr:<number>`（provider 原始 id，不换算）', () => {
    const task = prToTask(pr(), 'neeko');
    expect(task.id).toBe(`${GITHUB_PR_ID_PREFIX}128`);
    expect(task.id).toBe('github:pr:128');
  });

  it('labels 只取名字、assignee 取第一个、正文与优先级留空（列表里就是没有）', () => {
    const task = prToTask(
      pr({
        labels: [
          { name: 'bug', color: 'd73a4a' },
          { name: 'auth', color: 'ededed' },
        ],
        assignees: [{ login: 'alice' }, { login: 'bob' }],
      }),
      'neeko',
    );

    expect(task.labels).toEqual(['bug', 'auth']);
    expect(task.assignee).toBe('alice');
    expect(task.body).toBe('');
    expect(task.priority).toBeNull();
    // 外部工作项不属于任何本地项目的库：`''` = 不适用，不是某个项目。
    expect(task.projectId).toBe('');
  });

  it('没有 assignee 时是 null（不是空串、不是 undefined）', () => {
    expect(prToTask(pr({ assignees: [] }), 'neeko').assignee).toBeNull();
  });

  it('时间映射成 epoch 毫秒；updatedAt = createdAt（列表没有 updatedAt，不拿「现在」充数）', () => {
    const task = prToTask(pr({ createdAt: '2026-11-02T10:00:00Z' }), 'neeko');
    const expected = Date.parse('2026-11-02T10:00:00Z');

    expect(task.createdAt).toBe(expected);
    expect(task.updatedAt).toBe(expected);
  });

  it('时间解析不出来时是 0（不抛、不回落当前时间）', () => {
    expect(prToTask(pr({ createdAt: '不是时间' }), 'neeko').createdAt).toBe(0);
  });

  it('PR 摘要带 repo / state / 分支，url 留空（列表里没有，只能按需经 viewPr 补）', () => {
    const task = prToTask(pr(), 'neeko');

    expect(task.source).toBe('github');
    expect(task.pr).toEqual({
      number: 128,
      headRefName: 'feat/x',
      baseRefName: 'main',
      author: 'tincopper',
      repo: 'neeko',
      state: 'OPEN',
    });
    expect(task.pr?.url).toBeUndefined();
  });

  it('同一 PR 两次映射结果相等（不依赖时间 / 随机）', () => {
    const source = pr();
    expect(prToTask(source, 'neeko')).toEqual(prToTask(source, 'neeko'));
  });
});
