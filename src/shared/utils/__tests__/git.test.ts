// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { Worktree } from '@/shared/types';

import { filterWorktreeBranches, isActiveWorktree } from '../git';
import { WorkspaceSession, isMainCheckout } from '../workspaceRef';

/**
 * `shared/utils/git` 纯函数。
 *
 * 迁移说明：本文件此前覆盖 `mergeGitInfoForStore`（「worktree 激活时保留主分支 /
 * 保留 changed_files」的合并特例）。该函数已随 per-repo-unit 改造整体删除 —— 那份
 * 特例存在的唯一原因是「per-project 只有一个 status 槽、且分支名与主仓共用」；现在
 * status 与分支各按 `WorkspaceKey` 定址（`projectStore.applyStatus`），合并语义退化为
 * 「元数据 = per-project 字段覆盖」，不再需要工具函数。此处不留等价用例，改由
 * `shared/store/__tests__/projectStore.test.ts` 的投影用例守住同一批回归。
 */

const wt = (path: string, branch: string): Worktree => ({ path, branch, head: 'abc1234' });

describe('filterWorktreeBranches — 分支下拉须排除被 worktree 占用的分支', () => {
  it('剔除已被某个 worktree checkout 的分支，其余原序保留', () => {
    const branches = ['main', 'feat-a', 'feat-b', 'release'];
    const worktrees = [wt('/wt/a', 'feat-a'), wt('/wt/b', 'feat-b')];

    expect(filterWorktreeBranches(branches, worktrees)).toEqual(['main', 'release']);
  });

  it('无 worktree 时原样返回（主仓独占所有分支）', () => {
    const branches = ['main', 'dev'];
    expect(filterWorktreeBranches(branches, [])).toEqual(['main', 'dev']);
  });

  it('worktree 分支不在本地分支清单里也不报错（外部 worktree / 刚删分支）', () => {
    expect(filterWorktreeBranches(['main'], [wt('/wt/x', 'gone')])).toEqual(['main']);
  });

  it('同分支重复出现在清单中时一并剔除（不会漏一个）', () => {
    expect(filterWorktreeBranches(['main', 'main', 'dev'], [wt('/wt/a', 'main')])).toEqual(['dev']);
  });

  it('detached worktree 条目的空分支名只会剔除同样为空的项', () => {
    // `git worktree list --porcelain` 的 detached 条目 branch 为空串；
    // 分支清单里的空串同样无意义（detached HEAD 的展示形态），一并剔除是期望行为。
    expect(filterWorktreeBranches(['', 'main'], [wt('/wt/detached', '')])).toEqual(['main']);
  });
});

describe('isActiveWorktree — 「是否 linked worktree 单元」', () => {
  it('null / undefined / 空串都是主仓单元', () => {
    expect(isActiveWorktree(null)).toBe(false);
    expect(isActiveWorktree(undefined)).toBe(false);
    expect(isActiveWorktree('')).toBe(false);
  });

  it('非空路径才是 worktree 单元', () => {
    expect(isActiveWorktree('/repo/.worktrees/dev')).toBe(true);
    expect(isActiveWorktree('relative/wt')).toBe(true);
  });

  it('与 workspaceKeyOf / isMainCheckout 的主仓判定一致（同一份「主仓」语义不能有两个答案）', () => {
    // 只覆盖后端真能产出的形态（canonical 路径 / null）：`workspaceKeyOf` 额外把
    // 「纯空白串」也归为主仓，而本函数按非空字符串判为 worktree —— 该分叉已作为
    // 不一致点上报（空白路径现实中不会由后端 canonicalize 产出），故不在此固化。
    for (const path of [null, undefined, ''] as const) {
      expect(isActiveWorktree(path)).toBe(
        !isMainCheckout(WorkspaceSession.of('p1', path ?? null).key),
      );
    }
    expect(isActiveWorktree('/wt/a')).toBe(!isMainCheckout(WorkspaceSession.of('p1', '/wt/a').key));
  });
});
