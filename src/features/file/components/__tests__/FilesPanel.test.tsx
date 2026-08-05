import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import FilesPanel, { displayHomePath } from '@/features/file/components/FilesPanel';
import type { FileChange, FileNode } from '@/shared/types';

const tree: FileNode[] = [
  {
    name: 'src',
    path: 'src',
    is_dir: true,
    children: [{ name: 'a.ts', path: 'src/a.ts', is_dir: false, children: [] }],
  },
  { name: 'b.ts', path: 'b.ts', is_dir: false, children: [] },
];

const baseProps = {
  projectName: 'demo',
  projectPath: '/demo',
  projectId: 'p1',
  fileTree: tree,
  isLoading: false,
  activeFilePath: null,
  onSelectFile: vi.fn(),
  onRefresh: vi.fn(),
  onExpandDir: vi.fn().mockResolvedValue(undefined),
  projectType: 'Local' as const,
};

describe('FilesPanel 文件管理', () => {
  it('头部按钮创建文件：输入文件名后回车提交到根目录', () => {
    const onCreateFile = vi.fn().mockResolvedValue(undefined);
    render(<FilesPanel {...baseProps} onCreateFile={onCreateFile} />);

    fireEvent.click(screen.getByTitle('New File'));
    const input = screen.getByPlaceholderText('filename');
    fireEvent.change(input, { target: { value: 'new.ts' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCreateFile).toHaveBeenCalledWith('', 'new.ts');
  });

  it('头部按钮创建目录：输入目录名后回车提交', () => {
    const onCreateDirectory = vi.fn().mockResolvedValue(undefined);
    render(<FilesPanel {...baseProps} onCreateDirectory={onCreateDirectory} />);

    fireEvent.click(screen.getByTitle('New Folder'));
    const input = screen.getByPlaceholderText('folder name');
    fireEvent.change(input, { target: { value: 'lib' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCreateDirectory).toHaveBeenCalledWith('', 'lib');
  });

  it('选中目录后头部按钮在该目录内新建文件', () => {
    const onCreateFile = vi.fn().mockResolvedValue(undefined);
    render(<FilesPanel {...baseProps} onCreateFile={onCreateFile} />);

    // 选中 src 目录
    fireEvent.click(screen.getByText('src'));
    // 头部 New File 应在选中目录内创建
    fireEvent.click(screen.getByTitle('New File'));
    const input = screen.getByPlaceholderText('filename');
    fireEvent.change(input, { target: { value: 'new.ts' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCreateFile).toHaveBeenCalledWith('src', 'new.ts');
  });

  it('选中文件后头部按钮在该文件所在目录新建', () => {
    const onCreateFile = vi.fn().mockResolvedValue(undefined);
    render(<FilesPanel {...baseProps} onCreateFile={onCreateFile} />);

    // 展开 src 并选中 a.ts
    fireEvent.click(screen.getByText('src'));
    fireEvent.click(screen.getByText('a.ts'));
    fireEvent.click(screen.getByTitle('New File'));
    const input = screen.getByPlaceholderText('filename');
    fireEvent.change(input, { target: { value: 'x.ts' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCreateFile).toHaveBeenCalledWith('src', 'x.ts');
  });

  it('右键目录 → New File 时提交到该目录', () => {
    const onCreateFile = vi.fn().mockResolvedValue(undefined);
    render(<FilesPanel {...baseProps} onCreateFile={onCreateFile} />);

    fireEvent.contextMenu(screen.getByText('src'));
    fireEvent.click(screen.getByText('New File'));
    const input = screen.getByPlaceholderText('filename');
    fireEvent.change(input, { target: { value: 'b.ts' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCreateFile).toHaveBeenCalledWith('src', 'b.ts');
  });

  it('右键 Delete 需确认后才执行删除', async () => {
    const onDeletePath = vi.fn().mockResolvedValue(undefined);
    render(<FilesPanel {...baseProps} onDeletePath={onDeletePath} />);

    fireEvent.contextMenu(screen.getByText('b.ts'));
    fireEvent.click(screen.getByText('Delete'));
    // 确认对话框弹出，此时尚未执行删除
    expect(screen.getByText('Delete File')).toBeInTheDocument();
    expect(onDeletePath).not.toHaveBeenCalled();

    // 点击确认按钮后执行删除（异步 handler resolve 后更新选中态，需 waitFor 包裹）
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onDeletePath).toHaveBeenCalledWith('b.ts', false));
  });

  it('取消删除时不执行删除操作', () => {
    const onDeletePath = vi.fn().mockResolvedValue(undefined);
    render(<FilesPanel {...baseProps} onDeletePath={onDeletePath} />);

    fireEvent.contextMenu(screen.getByText('b.ts'));
    fireEvent.click(screen.getByText('Delete'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onDeletePath).not.toHaveBeenCalled();
  });

  it('右键 Rename 内联重命名文件', async () => {
    const onRenamePath = vi.fn().mockResolvedValue(undefined);
    render(<FilesPanel {...baseProps} onRenamePath={onRenamePath} />);

    fireEvent.contextMenu(screen.getByText('b.ts'));
    fireEvent.click(screen.getByText('Rename'));
    // 输入框预填当前名字
    const input = screen.getByDisplayValue('b.ts');
    fireEvent.change(input, { target: { value: 'c.ts' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // 异步 handler resolve 后更新选中节点，需 waitFor 包裹
    await waitFor(() => expect(onRenamePath).toHaveBeenCalledWith('b.ts', 'c.ts'));
  });

  it('重命名 Esc 取消不调用 onRenamePath', () => {
    const onRenamePath = vi.fn().mockResolvedValue(undefined);
    render(<FilesPanel {...baseProps} onRenamePath={onRenamePath} />);

    fireEvent.contextMenu(screen.getByText('b.ts'));
    fireEvent.click(screen.getByText('Rename'));
    const input = screen.getByDisplayValue('b.ts');
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onRenamePath).not.toHaveBeenCalled();
  });

  it('点击文件节点后显示选中高亮', () => {
    render(<FilesPanel {...baseProps} />);

    // 初始无选中态
    expect(screen.queryByRole('treeitem', { selected: true })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('b.ts'));
    const selected = screen.getByRole('treeitem', { selected: true });
    expect(selected).toHaveTextContent('b.ts');
  });

  it('头部折叠全部按钮收起所有已展开目录', () => {
    render(<FilesPanel {...baseProps} />);

    // 初始 src 目录未展开，a.ts 不可见
    expect(screen.queryByText('a.ts')).not.toBeInTheDocument();

    // 展开 src 目录
    fireEvent.click(screen.getByText('src'));
    expect(screen.getByText('a.ts')).toBeInTheDocument();

    // 折叠全部后子文件不可见
    fireEvent.click(screen.getByTitle('Collapse All'));
    expect(screen.queryByText('a.ts')).not.toBeInTheDocument();
  });

  it('被 .gitignore 忽略的文件显示灰色', () => {
    const treeWithIgnored: FileNode[] = [
      ...tree,
      { name: '.env', path: '.env', is_dir: false, children: [] },
    ];
    render(<FilesPanel {...baseProps} fileTree={treeWithIgnored} ignoredFiles={['.env']} />);

    expect(screen.getByText('.env')).toHaveClass('text-text-muted');
    // 普通文件不受影响
    expect(screen.getByText('b.ts')).toHaveClass('text-text-primary');
  });

  it('被忽略的目录显示灰色', () => {
    render(<FilesPanel {...baseProps} ignoredFiles={['src']} />);
    expect(screen.getByText('src')).toHaveClass('text-text-muted');
  });

  it('被忽略目录的子文件也显示灰色（忽略状态沿树传播）', () => {
    render(<FilesPanel {...baseProps} ignoredFiles={['src']} />);

    // 展开 src 后，子文件应继承父目录的忽略状态
    fireEvent.click(screen.getByText('src'));
    expect(screen.getByText('a.ts')).toHaveClass('text-text-muted');
  });

  it('多级嵌套子目录继承忽略状态', () => {
    const deepTree: FileNode[] = [
      {
        name: 'a',
        path: 'a',
        is_dir: true,
        children: [
          {
            name: 'b',
            path: 'a/b',
            is_dir: true,
            children: [{ name: 'c.txt', path: 'a/b/c.txt', is_dir: false, children: [] }],
          },
        ],
      },
    ];
    render(<FilesPanel {...baseProps} fileTree={deepTree} ignoredFiles={['a']} />);

    fireEvent.click(screen.getByText('a'));
    fireEvent.click(screen.getByText('b'));
    expect(screen.getByText('b')).toHaveClass('text-text-muted');
    expect(screen.getByText('c.txt')).toHaveClass('text-text-muted');
  });

  it('部分忽略的目录自身不灰，仅被忽略的子项灰显', () => {
    const partialTree: FileNode[] = [
      {
        name: 'sub',
        path: 'sub',
        is_dir: true,
        children: [
          {
            name: 'deep',
            path: 'sub/deep',
            is_dir: true,
            children: [
              { name: 'cache.dat', path: 'sub/deep/cache.dat', is_dir: false, children: [] },
            ],
          },
          { name: 'keep.txt', path: 'sub/keep.txt', is_dir: false, children: [] },
        ],
      },
    ];
    render(<FilesPanel {...baseProps} fileTree={partialTree} ignoredFiles={['sub/deep']} />);

    fireEvent.click(screen.getByText('sub'));
    // sub 只有部分内容被忽略 → 自身与未忽略项不灰
    expect(screen.getByText('sub')).toHaveClass('text-text-primary');
    expect(screen.getByText('keep.txt')).toHaveClass('text-text-primary');
    // 被忽略的 deep 目录灰，展开后其子文件继承灰
    fireEvent.click(screen.getByText('deep'));
    expect(screen.getByText('deep')).toHaveClass('text-text-muted');
    expect(screen.getByText('cache.dat')).toHaveClass('text-text-muted');
  });

  it('变更文件状态优先于继承的忽略状态', () => {
    const changed: FileChange[] = [
      { path: 'src/a.ts', status: 'Modified', additions: 1, deletions: 0 },
    ];
    render(<FilesPanel {...baseProps} ignoredFiles={['src']} changedFiles={changed} />);

    fireEvent.click(screen.getByText('src'));
    expect(screen.getByText('a.ts')).toHaveClass('text-accent-blue');
  });

  it('变更文件状态优先于忽略灰色', () => {
    const treeWithIgnored: FileNode[] = [
      ...tree,
      { name: '.env', path: '.env', is_dir: false, children: [] },
    ];
    const changed: FileChange[] = [
      { path: '.env', status: 'Modified', additions: 1, deletions: 0 },
    ];
    render(
      <FilesPanel
        {...baseProps}
        fileTree={treeWithIgnored}
        ignoredFiles={['.env']}
        changedFiles={changed}
      />,
    );

    expect(screen.getByText('.env')).toHaveClass('text-accent-blue');
  });

  it('未提供创建回调时不渲染创建按钮', () => {
    render(<FilesPanel {...baseProps} />);
    expect(screen.queryByTitle('New File')).not.toBeInTheDocument();
    expect(screen.queryByTitle('New Folder')).not.toBeInTheDocument();
  });

  it('头部不渲染删除按钮，删除仅保留在右键菜单', () => {
    render(<FilesPanel {...baseProps} onDeletePath={vi.fn().mockResolvedValue(undefined)} />);
    expect(screen.queryByTitle('Delete')).not.toBeInTheDocument();
    // 右键菜单删除入口仍可用
    fireEvent.contextMenu(screen.getByText('b.ts'));
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });
});

describe('displayHomePath', () => {
  it('mac/linux 下将 home 前缀替换为 ~', () => {
    expect(displayHomePath('/Users/tomgs/workspaces/pigo', '/Users/tomgs', false)).toBe(
      '~/workspaces/pigo',
    );
  });

  it('home 目录本身显示为 ~', () => {
    expect(displayHomePath('/Users/tomgs', '/Users/tomgs', false)).toBe('~');
  });

  it('非 home 前缀路径保持不变', () => {
    expect(displayHomePath('/opt/project', '/Users/tomgs', false)).toBe('/opt/project');
  });

  it('Windows 平台不替换', () => {
    expect(displayHomePath('C:\\Users\\tomgs\\proj', 'C:\\Users\\tomgs', true)).toBe(
      'C:\\Users\\tomgs\\proj',
    );
  });

  it('home 目录未知时保持完整路径', () => {
    expect(displayHomePath('/Users/tomgs/x', '', false)).toBe('/Users/tomgs/x');
  });
});
