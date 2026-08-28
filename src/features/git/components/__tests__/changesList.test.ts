import { describe, expect, it } from 'vitest';

import type { FileChange } from '@/shared/types';

import { expandUntrackedEntries } from '../../hooks/useUntrackedDirExpansion';

function fc(path: string, status: FileChange['status'] = 'Untracked'): FileChange {
  return { path, status, additions: 0, deletions: 0 };
}

describe('expandUntrackedEntries', () => {
  it('replaces collapsed dir entries with their child files', () => {
    const files = [
      fc('.trellis/tasks/08-27-file-tree-git-decoration/'),
      fc('src/new.ts'),
      fc('src/m.ts', 'Modified'),
    ];
    const map = {
      '.trellis/tasks/08-27-file-tree-git-decoration/': [
        '.trellis/tasks/08-27-file-tree-git-decoration/prd.md',
        '.trellis/tasks/08-27-file-tree-git-decoration/task.json',
      ],
    };
    const out = expandUntrackedEntries(files, map);
    expect(out.map((f) => f.path)).toEqual([
      '.trellis/tasks/08-27-file-tree-git-decoration/prd.md',
      '.trellis/tasks/08-27-file-tree-git-decoration/task.json',
      'src/new.ts',
      'src/m.ts',
    ]);
    // 目录替换出的条目为 Untracked；非目录条目保持原状态
    expect(out.find((f) => f.path.endsWith('prd.md'))?.status).toBe('Untracked');
    expect(out.find((f) => f.path.endsWith('task.json'))?.status).toBe('Untracked');
    expect(out.find((f) => f.path === 'src/m.ts')?.status).toBe('Modified');
  });

  it('keeps the dir entry as placeholder while children are not loaded yet', () => {
    const files = [fc('.trellis/tasks/x/')];
    const out = expandUntrackedEntries(files, {});
    expect(out).toEqual(files);
  });

  it('keeps empty dir expansion as nothing (fetched empty = no untracked files inside)', () => {
    const files = [fc('.trellis/tasks/x/')];
    const out = expandUntrackedEntries(files, { '.trellis/tasks/x/': [] });
    expect(out).toEqual([]);
  });

  it('passes through files without trailing slash untouched', () => {
    const files = [fc('a.ts'), fc('b/c.md', 'Modified')];
    expect(expandUntrackedEntries(files, {})).toEqual(files);
  });
});
