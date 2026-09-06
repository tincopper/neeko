import { describe, expect, it } from 'vitest';

import type { FileChange } from '@/shared/types';

import { buildGitStatusGroups, isUnversionedEntry } from '../gitStatusGroups';

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

describe('buildGitStatusGroups — G6 四组真实语义', () => {
  it('staged / unstaged / unversioned / conflicted 各归其组', () => {
    const groups = buildGitStatusGroups([
      fc('a.txt', 'Modified', { x: 'M', y: ' ' }), // staged-only
      fc('b.txt', 'Modified', { x: ' ', y: 'M' }), // wt-only
      fc('c.txt', 'Untracked', { x: '?', y: '?' }), // unversioned
      fc('d.txt', 'Modified', { x: 'U', y: 'U' }), // conflict
    ]);
    expect(groups.staged.map((f) => f.path)).toEqual(['a.txt']);
    expect(groups.unstaged.map((f) => f.path)).toEqual(['b.txt']);
    expect(groups.unversioned.map((f) => f.path)).toEqual(['c.txt']);
    expect(groups.conflicted.map((f) => f.path)).toEqual(['d.txt']);
  });

  it('同一文件 XY 双非空时同时进入 staged 与 unstaged（VSCode 同款）', () => {
    const groups = buildGitStatusGroups([fc('readme.md', 'Modified', { x: 'M', y: 'M' })]);
    expect(groups.staged.map((f) => f.path)).toEqual(['readme.md']);
    expect(groups.unstaged.map((f) => f.path)).toEqual(['readme.md']);
  });

  it('AA / DD / AU / UD 等未合并组合全部归 conflicted（独占，不进其他组）', () => {
    const groups = buildGitStatusGroups([
      fc('aa.txt', 'Modified', { x: 'A', y: 'A' }),
      fc('dd.txt', 'Deleted', { x: 'D', y: 'D' }),
      fc('au.txt', 'Added', { x: 'A', y: 'U' }),
      fc('ud.txt', 'Deleted', { x: 'U', y: 'D' }),
    ]);
    expect(groups.conflicted).toHaveLength(4);
    expect(groups.staged).toHaveLength(0);
    expect(groups.unstaged).toHaveLength(0);
  });

  it('缺 XY 的旧 payload：Untracked → unversioned，其余 → unstaged（现行为回退）', () => {
    const groups = buildGitStatusGroups([
      fc('new.ts', 'Untracked'),
      fc('m.ts', 'Modified'),
      fc('d.ts', 'Deleted'),
    ]);
    expect(groups.unversioned.map((f) => f.path)).toEqual(['new.ts']);
    expect(groups.unstaged.map((f) => f.path)).toEqual(['m.ts', 'd.ts']);
    expect(groups.staged).toHaveLength(0);
  });

  it('XY 侧字符为空格不进 staged（? 仅属 unversioned）；双侧空的畸形条目防御性归 unstaged', () => {
    const groups = buildGitStatusGroups([
      fc('x.bin', 'Modified', { x: ' ', y: ' ' }), // 真实 porcelain 不会产生；条目不得静默消失
      fc('y.txt', 'Modified', { x: 'A', y: ' ' }),
    ]);
    expect(groups.staged.map((f) => f.path)).toEqual(['y.txt']);
    expect(groups.unstaged.map((f) => f.path)).toEqual(['x.bin']);
  });

  it('isUnversionedEntry：XY 判定优先，缺 XY 回退 status', () => {
    expect(isUnversionedEntry(fc('a', 'Untracked', { x: '?', y: '?' }))).toBe(true);
    expect(isUnversionedEntry(fc('a', 'Untracked'))).toBe(true);
    expect(isUnversionedEntry(fc('a', 'Modified', { x: 'M', y: ' ' }))).toBe(false);
    expect(isUnversionedEntry(fc('a', 'Modified'))).toBe(false);
  });
});
