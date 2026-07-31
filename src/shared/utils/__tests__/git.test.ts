import { describe, it, expect } from 'vitest';

import type { GitInfo, Worktree } from '../../types/git';
import { filterWorktreeBranches, isActiveWorktree, mergeGitInfoForStore } from '../git';

describe('isActiveWorktree', () => {
  it('null 视为未激活', () => {
    expect(isActiveWorktree(null)).toBe(false);
  });

  it('空字符串视为未激活（与 resolveTabKey 语义一致）', () => {
    expect(isActiveWorktree('')).toBe(false);
  });

  it('undefined 视为未激活', () => {
    expect(isActiveWorktree(undefined)).toBe(false);
  });

  it('有效路径视为激活', () => {
    expect(isActiveWorktree('/tmp/proj-wt')).toBe(true);
  });
});

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

const baseGitInfo = (overrides: Partial<GitInfo> = {}): GitInfo => ({
  current_branch: 'main',
  branches: ['main', 'feature-x'],
  worktrees: [],
  changed_files: [],
  is_clean: true,
  git_provider: '',
  ...overrides,
});

describe('mergeGitInfoForStore', () => {
  it('worktree 未激活时直接使用新数据（current_branch 正常更新）', () => {
    const existing = baseGitInfo({ current_branch: 'old-main' });
    const incoming = baseGitInfo({ current_branch: 'new-main' });
    const merged = mergeGitInfoForStore(existing, incoming, false);
    expect(merged.current_branch).toBe('new-main');
  });

  it('worktree 激活时保留 local 主分支名，不被 worktree 分支覆盖（回归：local 入口分支名跟随 worktree 变动）', () => {
    const existing = baseGitInfo({ current_branch: 'main' });
    const incoming = baseGitInfo({ current_branch: 'feature-x' }); // worktree 的 git_info
    const merged = mergeGitInfoForStore(existing, incoming, true);
    expect(merged.current_branch).toBe('main');
  });

  it('worktree 激活时仍更新其余字段（changed_files 等来自 worktree 数据）', () => {
    const existing = baseGitInfo({ current_branch: 'main', changed_files: [] });
    const incoming = baseGitInfo({
      current_branch: 'feature-x',
      changed_files: [{ path: 'a.ts', status: 'Modified', additions: 1, deletions: 0 }],
      is_clean: false,
    });
    const merged = mergeGitInfoForStore(existing, incoming, true);
    expect(merged.current_branch).toBe('main');
    expect(merged.changed_files).toHaveLength(1);
    expect(merged.is_clean).toBe(false);
  });
});
