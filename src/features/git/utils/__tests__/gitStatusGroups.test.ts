// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { FileChange } from '@/shared/types';

import { buildGitStatusGroups, isConflictedEntry, isUnversionedEntry } from '../gitStatusGroups';

/** fc: 可选 porcelain XY（G6 契约） */
function fc(
  path: string,
  status: FileChange['status'] = 'Modified',
  xy?: { x?: string; y?: string; renamedFrom?: string },
): FileChange {
  return {
    path,
    status,
    additions: 0,
    deletions: 0,
    ...(xy?.x !== undefined ? { index_status: xy.x } : {}),
    ...(xy?.y !== undefined ? { worktree_status: xy.y } : {}),
    ...(xy?.renamedFrom !== undefined ? { renamed_from: xy.renamedFrom } : {}),
  };
}

describe('buildGitStatusGroups — G6 简化契约（tracked / unversioned 两组）', () => {
  it('tracked（staged-only / wt-only / XY 双非空）与 unversioned 各归其组', () => {
    const groups = buildGitStatusGroups([
      fc('a.txt', 'Modified', { x: 'M', y: ' ' }), // staged-only → tracked
      fc('b.txt', 'Modified', { x: ' ', y: 'M' }), // wt-only → tracked
      fc('c.txt', 'Modified', { x: 'M', y: 'M' }), // 双非空 → tracked（单条，不重复）
      fc('d.txt', 'Untracked', { x: '?', y: '?' }), // unversioned
    ]);
    expect(groups.tracked.map((f) => f.path)).toEqual(['a.txt', 'b.txt', 'c.txt']);
    expect(groups.unversioned.map((f) => f.path)).toEqual(['d.txt']);
  });

  it('AA / DD / AU / UD 等未合并组合归入 tracked（不再独占分组，仍可见）', () => {
    const groups = buildGitStatusGroups([
      fc('aa.txt', 'Modified', { x: 'A', y: 'A' }),
      fc('dd.txt', 'Deleted', { x: 'D', y: 'D' }),
      fc('au.txt', 'Added', { x: 'A', y: 'U' }),
      fc('ud.txt', 'Deleted', { x: 'U', y: 'D' }),
    ]);
    expect(groups.tracked).toHaveLength(4);
    expect(groups.unversioned).toHaveLength(0);
  });

  it('缺 XY 的旧 payload：Untracked → unversioned，其余 → tracked（现行为回退）', () => {
    const groups = buildGitStatusGroups([
      fc('new.ts', 'Untracked'),
      fc('m.ts', 'Modified'),
      fc('d.ts', 'Deleted'),
    ]);
    expect(groups.unversioned.map((f) => f.path)).toEqual(['new.ts']);
    expect(groups.tracked.map((f) => f.path)).toEqual(['m.ts', 'd.ts']);
  });

  it('双侧空的畸形条目防御性归 tracked（条目不得静默消失）', () => {
    const groups = buildGitStatusGroups([
      fc('x.bin', 'Modified', { x: ' ', y: ' ' }), // 真实 porcelain 不会产生
    ]);
    expect(groups.tracked.map((f) => f.path)).toEqual(['x.bin']);
    expect(groups.unversioned).toHaveLength(0);
  });

  it('isUnversionedEntry：XY 判定优先，缺 XY 回退 status', () => {
    expect(isUnversionedEntry(fc('a', 'Untracked', { x: '?', y: '?' }))).toBe(true);
    expect(isUnversionedEntry(fc('a', 'Untracked'))).toBe(true);
    expect(isUnversionedEntry(fc('a', 'Modified', { x: 'M', y: ' ' }))).toBe(false);
    expect(isUnversionedEntry(fc('a', 'Modified'))).toBe(false);
  });

  it('isConflictedEntry：U 任一侧或 AA / DD 为 true，其余为 false', () => {
    expect(isConflictedEntry(fc('a', 'Modified', { x: 'U', y: 'U' }))).toBe(true);
    expect(isConflictedEntry(fc('a', 'Modified', { x: 'A', y: 'U' }))).toBe(true);
    expect(isConflictedEntry(fc('a', 'Modified', { x: 'U', y: 'D' }))).toBe(true);
    expect(isConflictedEntry(fc('a', 'Added', { x: 'A', y: 'A' }))).toBe(true);
    expect(isConflictedEntry(fc('a', 'Deleted', { x: 'D', y: 'D' }))).toBe(true);
    // 非冲突组合与缺 XY 均判 false
    expect(isConflictedEntry(fc('a', 'Modified', { x: 'M', y: 'M' }))).toBe(false);
    expect(isConflictedEntry(fc('a', 'Untracked', { x: '?', y: '?' }))).toBe(false);
    expect(isConflictedEntry(fc('a', 'Modified', { x: ' ', y: 'M' }))).toBe(false);
    expect(isConflictedEntry(fc('a', 'Modified'))).toBe(false);
  });
});
