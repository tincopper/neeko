import { describe, expect, it } from 'vitest';

import type { FileNode, Tab, FileTabData } from '@/shared/types';
import {
  buildFileTreeView,
  getTabDisplayName,
  isDirtyFileTab,
  isImageFile,
  isSvgFile,
} from '@/shared/utils/fileTree';

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

describe('isDirtyFileTab / getTabDisplayName', () => {
  function fileTab(overrides: Partial<FileTabData> = {}): Tab {
    return {
      id: 't1',
      projectId: 'p1',
      title: 't1',
      order: 0,
      data: {
        kind: 'file',
        filePath: 'a.ts',
        fileName: 'a.ts',
        content: { path: 'a.ts', content: '', size: 0, is_binary: false },
        isDirty: false,
        ...overrides,
      },
    };
  }

  function terminalTab(): Tab {
    return {
      id: 'term',
      projectId: 'p1',
      title: 'term',
      order: 0,
      data: { kind: 'terminal', agentId: null, status: 'Idle' },
    };
  }

  it('isDirtyFileTab：仅 dirty 文件 tab 为 true', () => {
    expect(isDirtyFileTab(fileTab())).toBe(false);
    expect(isDirtyFileTab(fileTab({ isDirty: true }))).toBe(true);
    expect(isDirtyFileTab(terminalTab())).toBe(false);
  });

  it('getTabDisplayName：untitledName 优先，其次 fileName', () => {
    expect(getTabDisplayName(fileTab())).toBe('a.ts');
    expect(getTabDisplayName(fileTab({ untitledName: 'Untitled-1' }))).toBe('Untitled-1');
  });

  it('getTabDisplayName：fileName 缺失（undefined）时兜底 Untitled', () => {
    expect(getTabDisplayName(fileTab({ fileName: undefined as unknown as string }))).toBe(
      'Untitled',
    );
  });
});

describe('isSvgFile / isImageFile', () => {
  it('isSvgFile：.svg 大小写不敏感', () => {
    expect(isSvgFile('assets/diagram.svg')).toBe(true);
    expect(isSvgFile('LOGO.SVG')).toBe(true);
    expect(isSvgFile('index.html')).toBe(false);
    expect(isSvgFile('diagram.svgx')).toBe(false);
  });

  it('isImageFile：常见二进制图片扩展名大小写不敏感', () => {
    expect(isImageFile('a.png')).toBe(true);
    expect(isImageFile('b.JPG')).toBe(true);
    expect(isImageFile('c.jpeg')).toBe(true);
    expect(isImageFile('d.gif')).toBe(true);
    expect(isImageFile('e.webp')).toBe(true);
    expect(isImageFile('f.bmp')).toBe(true);
    expect(isImageFile('g.avif')).toBe(true);
    expect(isImageFile('h.ico')).toBe(true);
    expect(isImageFile('i.txt')).toBe(false);
    expect(isImageFile('j.svg')).toBe(false);
    expect(isImageFile('k.ts')).toBe(false);
  });
});
