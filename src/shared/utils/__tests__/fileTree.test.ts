import { describe, expect, it } from 'vitest';

import type { FileNode, Tab, FileTabData } from '@/shared/types';
import {
  buildFileTreeView,
  getTabDisplayName,
  isDirtyFileTab,
  isImageFile,
  isJsonFile,
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
    expect(view).toEqual([
      { ...dirNode('src', 'src', [fileNode('a.ts', 'src/a.ts')]), is_expanded: true },
    ]);
  });

  it('展开但目录缓存缺失（未加载）：children 为空（由 loadStates 显示加载态）', () => {
    const dirs = { '': [dirNode('src', 'src')] };
    const view = buildFileTreeView(dirs, new Set(['src']));
    expect(view).toEqual([{ ...dirNode('src', 'src'), is_expanded: true }]);
  });

  it('深层目录：沿展开路径递归组装', () => {
    const dirs = {
      '': [dirNode('a', 'a', [dirNode('b', 'a/b')])],
      a: [dirNode('b', 'a/b')],
      'a/b': [fileNode('c.ts', 'a/b/c.ts')],
    };
    const view = buildFileTreeView(dirs, new Set(['a', 'a/b']));
    expect(view).toEqual([
      {
        ...dirNode('a', 'a', [
          { ...dirNode('b', 'a/b', [fileNode('c.ts', 'a/b/c.ts')]), is_expanded: true },
        ]),
        is_expanded: true,
      },
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
    expect(view).toEqual([{ ...dirNode('a', 'a', [dirNode('b', 'a/b')]), is_expanded: true }]);
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
      { ...dirNode('src', 'src', [fileNode('a.ts', 'src/a.ts')]), is_expanded: true },
      fileNode('new.md', 'new.md'),
    ]);
    expect(before).not.toEqual(after);
  });
});

describe('buildFileTreeView git 状态盖章（S3 组装期 join）', () => {
  type NodeGitStatus = { status: string | null; ignored: boolean };

  it('decorate 返回的字段落到对应视图节点（文件与目录）', () => {
    const dirs = {
      '': [dirNode('src', 'src'), fileNode('b.ts', 'b.ts')],
      src: [fileNode('a.ts', 'src/a.ts')],
    };
    const statusByPath = new Map<string, NodeGitStatus>([
      ['src', { status: 'modified', ignored: false }],
      ['src/a.ts', { status: 'added', ignored: false }],
      ['b.ts', { status: null, ignored: true }],
    ]);
    const view = buildFileTreeView(
      dirs,
      new Set(['src']),
      {},
      (path) => statusByPath.get(path) ?? null,
    );

    expect(view[0]).toMatchObject({ path: 'src', git_status: 'modified' });
    // 非 ignored 节点不写 is_ignored 键（字段只在 true 时存在）
    expect('is_ignored' in view[0]!).toBe(false);
    // 展开目录的子节点同样被盖章
    expect(view[0]?.children[0]).toMatchObject({
      path: 'src/a.ts',
      git_status: 'added',
    });
    // 无状态但 ignored：仅 is_ignored 落节点（git_status 键不存在）
    expect('git_status' in view[1]!).toBe(false);
    expect(view[1]).toMatchObject({ path: 'b.ts', is_ignored: true });
  });

  it('逐节点视图状态盖章：is_active / is_selected / is_expanded / dir_state / creating_input', () => {
    const dirs = {
      '': [dirNode('src', 'src'), fileNode('b.ts', 'b.ts')],
      src: [fileNode('a.ts', 'src/a.ts')],
    };
    const view = buildFileTreeView(
      dirs,
      new Set(['src']),
      {
        activeFilePath: 'src/a.ts',
        selectedPath: 'b.ts',
        dirLoadStates: { src: 'loading' },
        creating: { dirPath: 'src', kind: 'file' },
        creatingValue: 'new.ts',
      },
      () => null,
    );

    // 展开/加载/内联新建仅命中目录携带；激活命中子文件
    expect(view[0]).toMatchObject({
      path: 'src',
      is_expanded: true,
      dir_state: 'loading',
      creating_input: { kind: 'file', value: 'new.ts' },
    });
    expect('is_active' in view[0]!).toBe(false);
    expect(view[0]?.children[0]).toMatchObject({ path: 'src/a.ts', is_active: true });
    // b.ts：选中态；文件节点无 dir_state / creating_input / is_expanded
    expect(view[1]).toMatchObject({ path: 'b.ts', is_selected: true });
    expect('is_expanded' in view[1]!).toBe(false);
    expect('dir_state' in view[1]!).toBe(false);
  });

  it('重命名命中节点盖章 renaming_name（行替换为输入框）', () => {
    const dirs = { '': [fileNode('b.ts', 'b.ts')] };
    const view = buildFileTreeView(
      dirs,
      new Set(),
      { renaming: { path: 'b.ts', isDir: false, name: 'c.ts' } },
      () => null,
    );
    expect(view[0]).toMatchObject({ path: 'b.ts', renaming_name: 'c.ts' });
  });

  it('未提供 decorate/input：视图节点不携带任何投影字段（其他消费方零感知）', () => {
    const dirs = { '': [fileNode('a.ts', 'a.ts')] };
    const view = buildFileTreeView(dirs, new Set());
    expect(view[0]).toEqual(fileNode('a.ts', 'a.ts'));
    expect('git_status' in view[0]!).toBe(false);
  });

  it('decorate 返回 null 的路径不写字段', () => {
    const dirs = { '': [fileNode('a.ts', 'a.ts')] };
    const view = buildFileTreeView(dirs, new Set(), {}, () => null);
    expect(view[0]).toEqual(fileNode('a.ts', 'a.ts'));
  });

  it('未展开目录（children 截断）同样被盖章', () => {
    const dirs = { '': [dirNode('src', 'src', [fileNode('a.ts', 'src/a.ts')])] };
    const view = buildFileTreeView(dirs, new Set(), {}, (path) =>
      path === 'src' ? { status: 'untracked', ignored: false } : null,
    );
    expect(view[0]).toMatchObject({ path: 'src', git_status: 'untracked' });
    expect(view[0]?.children).toEqual([]);
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

describe('isJsonFile', () => {
  it('.json 大小写不敏感，.jsonc 不算（无法 JSON.parse）', () => {
    expect(isJsonFile('config.json')).toBe(true);
    expect(isJsonFile('DATA.JSON')).toBe(true);
    expect(isJsonFile('config.jsonc')).toBe(false);
    expect(isJsonFile('a.ts')).toBe(false);
  });
});
