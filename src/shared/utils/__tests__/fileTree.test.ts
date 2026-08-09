import { describe, expect, it } from 'vitest';

import type { FileNode } from '@/shared/types';
import { buildFileTreeView } from '@/shared/utils/fileTree';

function dirNode(name: string, path: string, children: FileNode[] = []): FileNode {
  return { name, path, is_dir: true, children };
}
function fileNode(name: string, path: string): FileNode {
  return { name, path, is_dir: false, children: [] };
}

describe('buildFileTreeView 扁平缓存 → 嵌套视图', () => {
  it('无根缓存时返回空视图', () => {
    expect(buildFileTreeView({}, new Set())).toEqual([]);
  });

  it('未展开任何目录：children 一律截断为空', () => {
    const dirs = { '': [dirNode('src', 'src', [fileNode('a.ts', 'src/a.ts')])] };
    const view = buildFileTreeView(dirs, new Set());
    expect(view).toEqual([dirNode('src', 'src')]);
  });

  it('展开目录：从该目录缓存组装 children', () => {
    const dirs = {
      '': [dirNode('src', 'src', [fileNode('a.ts', 'src/a.ts')])],
      src: [fileNode('a.ts', 'src/a.ts')],
    };
    const view = buildFileTreeView(dirs, new Set(['src']));
    expect(view).toEqual([dirNode('src', 'src', [fileNode('a.ts', 'src/a.ts')])]);
  });

  it('展开但目录缓存缺失（未加载）：children 为空（由 loadStates 显示加载态）', () => {
    const dirs = { '': [dirNode('src', 'src')] };
    const view = buildFileTreeView(dirs, new Set(['src']));
    expect(view).toEqual([dirNode('src', 'src')]);
  });

  it('深层目录：沿展开路径递归组装', () => {
    const dirs = {
      '': [dirNode('a', 'a', [dirNode('b', 'a/b')])],
      a: [dirNode('b', 'a/b')],
      'a/b': [fileNode('c.ts', 'a/b/c.ts')],
    };
    const view = buildFileTreeView(dirs, new Set(['a', 'a/b']));
    expect(view).toEqual([
      dirNode('a', 'a', [dirNode('b', 'a/b', [fileNode('c.ts', 'a/b/c.ts')])]),
    ]);
  });

  it('中间层未展开：深层不进入视图', () => {
    const dirs = {
      '': [dirNode('a', 'a', [dirNode('b', 'a/b')])],
      a: [dirNode('b', 'a/b')],
      'a/b': [fileNode('c.ts', 'a/b/c.ts')],
    };
    // a 展开但 a/b 未展开 → c.ts 不可见
    const view = buildFileTreeView(dirs, new Set(['a']));
    expect(view).toEqual([dirNode('a', 'a', [dirNode('b', 'a/b')])]);
  });

  it('根刷新后已展开子目录仍从各自缓存取内容（根替换不影响子树）', () => {
    const before = buildFileTreeView(
      { '': [dirNode('src', 'src')], src: [fileNode('a.ts', 'src/a.ts')] },
      new Set(['src']),
    );
    // 根被替换为全新对象，src 缓存保持独立
    const after = buildFileTreeView(
      {
        '': [dirNode('src', 'src'), fileNode('new.md', 'new.md')],
        src: [fileNode('a.ts', 'src/a.ts')],
      },
      new Set(['src']),
    );
    expect(after).toEqual([
      dirNode('src', 'src', [fileNode('a.ts', 'src/a.ts')]),
      fileNode('new.md', 'new.md'),
    ]);
    expect(before).not.toEqual(after);
  });
});
