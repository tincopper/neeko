import { describe, expect, it } from 'vitest';

import type { GitInfo } from '@/shared/types';

import { mergeGitInfoForStore } from '../git';

function makeGitInfo(overrides: Partial<GitInfo> = {}): GitInfo {
  return {
    current_branch: 'main',
    branches: ['main'],
    worktrees: [],
    changed_files: [],
    is_clean: true,
    git_provider: 'GitHub',
    ...overrides,
  };
}

describe('mergeGitInfoForStore', () => {
  it('非 worktree 时以 incoming 为准（含 changed_files 更新）', () => {
    const existing = makeGitInfo({ ignored_files: ['.env', 'dist'] });
    const incoming = makeGitInfo({
      changed_files: [{ path: 'a.ts', status: 'Modified', additions: 1, deletions: 0 }],
      is_clean: false,
    });

    const merged = mergeGitInfoForStore(existing, incoming, false);
    // incoming 的 changed_files 生效（着色新增/修改）
    expect(merged.changed_files).toEqual(incoming.changed_files);
    expect(merged.is_clean).toBe(false);
  });

  it('回归：incoming（get_git_info）不返回 ignored_files 时，保留 existing 的 ignored_files（文件树灰色状态）', () => {
    const existing = makeGitInfo({ ignored_files: ['.env', 'dist', 'node_modules'] });
    // get_git_info 返回的 GitInfo 不含 ignored_files 字段
    const incoming = makeGitInfo();

    const merged = mergeGitInfoForStore(existing, incoming, false);
    expect(merged.ignored_files).toEqual(['.env', 'dist', 'node_modules']);
  });

  it('回归：worktree 激活时同样保留 ignored_files，并保留主分支名', () => {
    const existing = makeGitInfo({
      current_branch: 'main',
      ignored_files: ['dist'],
    });
    const incoming = makeGitInfo({
      current_branch: 'feature/wt',
      branches: ['main', 'feature/wt'],
    });

    const merged = mergeGitInfoForStore(existing, incoming, true);
    // 主分支名不被 worktree 分支污染
    expect(merged.current_branch).toBe('main');
    // ignored_files 不被丢弃
    expect(merged.ignored_files).toEqual(['dist']);
  });

  it('existing 无 ignored_files 时，merged 不引入该字段', () => {
    const existing = makeGitInfo();
    const incoming = makeGitInfo();

    const merged = mergeGitInfoForStore(existing, incoming, false);
    expect(merged.ignored_files).toBeUndefined();
  });
});
