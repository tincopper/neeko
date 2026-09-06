import { describe, expect, it } from 'vitest';

import type { FileTreeViewNode } from '@/shared/types';
import { flattenFileTreeView, flatRowKey } from '@/shared/utils/fileTree';

function dir(path: string, children: FileTreeViewNode[] = []): FileTreeViewNode {
  return { name: path.split('/').pop()!, path, is_dir: true, children, is_expanded: true };
}
function file(path: string): FileTreeViewNode {
  return { name: path.split('/').pop()!, path, is_dir: false, children: [] };
}

describe('flattenFileTreeView — S4 扁平行', () => {
  it('按渲染顺序摊平（先本行，后 children），depth 正确递增', () => {
    const tree = [dir('src', [file('src/a.ts')]), file('b.ts')];
    const rows = flattenFileTreeView(tree);
    expect(rows.map((r) => `${r.kind}:${r.node.path}@${r.depth}`)).toEqual([
      'node:src@0',
      'node:src/a.ts@1',
      'node:b.ts@0',
    ]);
  });

  it('renaming 行替换本行且子树不渲染', () => {
    const tree = [dir('src', [file('src/a.ts')]), { ...file('b.ts'), renaming_name: 'c.ts' }];
    const rows = flattenFileTreeView(tree);
    expect(rows.map((r) => `${r.kind}:${r.node.path}`)).toEqual([
      'node:src',
      'node:src/a.ts',
      'renaming:b.ts',
    ]);
  });

  it('creating 行位于本行之后、children 之前', () => {
    const tree = [
      { ...dir('src', [file('src/a.ts')]), creating_input: { kind: 'file' as const, value: 'x' } },
    ];
    const rows = flattenFileTreeView(tree);
    expect(rows.map((r) => `${r.kind}:${r.node.path}`)).toEqual([
      'node:src',
      'creating:src',
      'node:src/a.ts',
    ]);
  });

  it('flatRowKey 稳定且区分种类', () => {
    const rows = flattenFileTreeView([
      { ...dir('src', []), creating_input: { kind: 'file' as const, value: '' } },
    ]);
    expect(rows.map(flatRowKey)).toEqual(['node:src', 'creating:src']);
  });
});
