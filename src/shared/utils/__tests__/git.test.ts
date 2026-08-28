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
    const existing = makeGitInfo();
    const incoming = makeGitInfo({
      changed_files: [{ path: 'a.ts', status: 'Modified', additions: 1, deletions: 0 }],
      is_clean: false,
    });

    const merged = mergeGitInfoForStore(existing, incoming, false);
    // incoming 的 changed_files 生效（着色新增/修改）
    expect(merged.changed_files).toEqual(incoming.changed_files);
    expect(merged.is_clean).toBe(false);
  });
});
