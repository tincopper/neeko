import { describe, it, expect } from 'vitest';

import type { Worktree } from '../../types/git';
import { filterWorktreeBranches } from '../git';

describe('filterWorktreeBranches', () => {
  it('worktree 为空时返回全部分支', () => {
    const branches = ['main', 'dev', 'feature/a'];
    const worktrees: Worktree[] = [];
    expect(filterWorktreeBranches(branches, worktrees)).toEqual(branches);
  });

  it('排除已关联 worktree 的分支', () => {
    const branches = ['main', 'dev', 'feature/a'];
    const worktrees: Worktree[] = [{ path: '/wt', branch: 'dev', head: 'abc' }];
    expect(filterWorktreeBranches(branches, worktrees)).toEqual(['main', 'feature/a']);
  });

  it('排除多个 worktree 关联的多个分支', () => {
    const branches = ['main', 'dev', 'feature/a', 'feature/b'];
    const worktrees: Worktree[] = [
      { path: '/wt1', branch: 'dev', head: 'abc' },
      { path: '/wt2', branch: 'feature/a', head: 'def' },
    ];
    expect(filterWorktreeBranches(branches, worktrees)).toEqual(['main', 'feature/b']);
  });

  it('不修改原始数组', () => {
    const branches = ['main', 'dev', 'feature/a'];
    const worktrees: Worktree[] = [{ path: '/wt', branch: 'dev', head: 'abc' }];
    const original = [...branches];
    filterWorktreeBranches(branches, worktrees);
    expect(branches).toEqual(original);
  });
});
