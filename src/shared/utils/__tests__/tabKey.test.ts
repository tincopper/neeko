import { describe, it, expect } from 'vitest';

import { buildWorktreeTabKey, parseProjectIdFromTabKey, resolveTabKey } from '../tabKey';

describe('resolveTabKey', () => {
  it('无 worktree 时返回原始 projectId', () => {
    expect(resolveTabKey('proj-1', null)).toBe('proj-1');
  });

  it('worktree 激活时返回 worktree 专属 tab key（回归：diff tab 不应落到 local tab 组）', () => {
    const key = resolveTabKey('proj-1', '/tmp/proj-wt');
    expect(key).toBe(buildWorktreeTabKey('proj-1', '/tmp/proj-wt'));
    expect(key).toContain(':wt:');
    expect(key).not.toBe('proj-1');
  });

  it('空 worktree 路径视为未激活', () => {
    expect(resolveTabKey('proj-1', '')).toBe('proj-1');
  });
});

describe('tabKey helpers', () => {
  it('buildWorktreeTabKey 拼接 projectId 与 worktree 路径', () => {
    expect(buildWorktreeTabKey('p1', '/a/b')).toBe('p1:wt:/a/b');
  });

  it('parseProjectIdFromTabKey 解析出真实 projectId', () => {
    expect(parseProjectIdFromTabKey('p1:wt:/a/b')).toBe('p1');
    expect(parseProjectIdFromTabKey('p1')).toBe('p1');
  });
});
