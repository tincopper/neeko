import { fireEvent, render as renderRTL, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import FilesPanel, { displayHomePath } from '@/features/file/components/FilesPanel';
// Mock setDragFile to verify it's called for directories
vi.mock('@/features/file/hooks/useFileDrop', () => ({
  setDragFile: vi.fn(),
  useFileDrop: vi.fn(),
}));
import { setDragFile } from '@/features/file/hooks/useFileDrop';
import { useFileStore } from '@/features/file/store';
import type { FileChange, FileNode } from '@/shared/types';
import { createAppProviderWrapper } from '@/testing/AppProviderTestUtils';

/** FilesPanel 内部 hook（useFilePanelState）依赖 useAppContext 的 toast */
const render = (ui: Parameters<typeof renderRTL>[0]) =>
  renderRTL(ui, { wrapper: createAppProviderWrapper() });

const tree: FileNode[] = [
  {
    name: 'src',
    path: 'src',
    is_dir: true,
    children: [{ name: 'a.ts', path: 'src/a.ts', is_dir: false, children: [] }],
  },
  { name: 'b.ts', path: 'b.ts', is_dir: false, children: [] },
];

const OWNER = 'p1:/demo';

/** 把嵌套树摊平成扁平目录缓存（dirPath → 一级条目），与 store 的 stripChildren 语义一致 */
function flattenTree(nodes: FileNode[]): Record<string, FileNode[]> {
  const dirs: Record<string, FileNode[]> = {};
  const strip = (list: FileNode[]): FileNode[] => list.map((n) => ({ ...n, children: [] }));
  dirs[''] = strip(nodes);
  const walk = (list: FileNode[], prefix: string) => {
    for (const n of list) {
      if (!n.is_dir) continue;
      const path = prefix ? `${prefix}/${n.name}` : n.name;
      // 解构 pattern 而非属性访问：规避 testing-library/no-node-access 对纯数据结构的误报
      const { children: kids } = n;
      dirs[path] = strip(kids);
      walk(kids, path);
    }
  };
  walk(nodes, '');
  return dirs;
}

/** 重置 store 并注入目录缓存（模拟根目录与子目录均已加载） */
function seedDirs(nodes: FileNode[]) {
  useFileStore.getState().reset();
  const dirs = flattenTree(nodes);
  useFileStore.setState({
    owner: OWNER,
    dirs,
    loadStates: Object.fromEntries(Object.keys(dirs).map((k) => [k, 'loaded' as const])),
  });
}

const baseProps = {
  projectName: 'demo',
  projectPath: '/demo',
  projectId: 'p1',
  activeFilePath: null,
  onSelectFile: vi.fn(),
  onRefresh: vi.fn(),
  onExpandDir: vi.fn().mockResolvedValue(undefined),
  projectType: 'Local' as const,
};

// virtual-core 挂载时同步测量 scrollRect（jsdom 恒 0）→ mock 非零尺寸让虚拟化渲染行
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(1200);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('FilesPanel 文件管理', () => {
  beforeEach(() => {
    seedDirs(tree);
  });

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

  it('点击树空白区域选中项目根：新建文件/目录目标回到根', () => {
    const onCreateFile = vi.fn().mockResolvedValue(undefined);
    render(<FilesPanel {...baseProps} onCreateFile={onCreateFile} />);

    // 先选中 src 目录 → 新建目标为 src 内
    fireEvent.click(screen.getByText('src'));
    fireEvent.click(screen.getByTitle('New File'));
    const input1 = screen.getByPlaceholderText('filename');
    fireEvent.change(input1, { target: { value: 'inner.ts' } });
    fireEvent.keyDown(input1, { key: 'Enter' });
    expect(onCreateFile).toHaveBeenCalledWith('src', 'inner.ts');

    // 点击树空白区域 → 选中项目根
    fireEvent.click(screen.getByTestId('file-tree-empty-area'));

    // 新建文件 → 目标回到根（''）
    fireEvent.click(screen.getByTitle('New File'));
    const input2 = screen.getByPlaceholderText('filename');
    fireEvent.change(input2, { target: { value: 'root.ts' } });
    fireEvent.keyDown(input2, { key: 'Enter' });
    expect(onCreateFile).toHaveBeenCalledWith('', 'root.ts');
  });

  it('点击文件面板头部空白区域取消节点选中：新建目标回到根', () => {
    const onCreateFile = vi.fn().mockResolvedValue(undefined);
    render(<FilesPanel {...baseProps} onCreateFile={onCreateFile} />);

    // 选中 src → 新建目标为 src 内
    fireEvent.click(screen.getByText('src'));
    fireEvent.click(screen.getByTitle('New File'));
    const input1 = screen.getByPlaceholderText('filename');
    fireEvent.change(input1, { target: { value: 'inner.ts' } });
    fireEvent.keyDown(input1, { key: 'Enter' });
    expect(onCreateFile).toHaveBeenCalledWith('src', 'inner.ts');

    // 点击头部项目名（非交互区域）→ 取消选中，新建目标回根
    fireEvent.click(screen.getByText('demo'));
    fireEvent.click(screen.getByTitle('New File'));
    const input2 = screen.getByPlaceholderText('filename');
    fireEvent.change(input2, { target: { value: 'root.ts' } });
    fireEvent.keyDown(input2, { key: 'Enter' });
    expect(onCreateFile).toHaveBeenCalledWith('', 'root.ts');
  });

  it('点击文件面板外任意处取消节点选中：新建目标回到根', () => {
    const onCreateFile = vi.fn().mockResolvedValue(undefined);
    render(<FilesPanel {...baseProps} onCreateFile={onCreateFile} />);

    // 选中 src → 新建目标为 src 内
    fireEvent.click(screen.getByText('src'));
    fireEvent.click(screen.getByTitle('New File'));
    const input1 = screen.getByPlaceholderText('filename');
    fireEvent.change(input1, { target: { value: 'inner.ts' } });
    fireEvent.keyDown(input1, { key: 'Enter' });
    expect(onCreateFile).toHaveBeenCalledWith('src', 'inner.ts');

    // 点击面板外（document.body 空白）→ 取消选中，新建目标回根
    fireEvent.click(document.body);
    fireEvent.click(screen.getByTitle('New File'));
    const input2 = screen.getByPlaceholderText('filename');
    fireEvent.change(input2, { target: { value: 'root.ts' } });
    fireEvent.keyDown(input2, { key: 'Enter' });
    expect(onCreateFile).toHaveBeenCalledWith('', 'root.ts');
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

  // ── S5：ignored 灰显由后端读层原生标注（FileNode.ignored），平行数组退役 ──

  it('被 .gitignore 忽略的文件（后端标注 ignored）显示灰色', () => {
    const treeWithIgnored: FileNode[] = [
      ...tree,
      { name: '.env', path: '.env', is_dir: false, children: [], ignored: true },
    ];
    seedDirs(treeWithIgnored);
    render(<FilesPanel {...baseProps} />);

    expect(screen.getByText('.env')).toHaveClass('text-text-muted');
    // 普通文件不受影响
    expect(screen.getByText('b.ts')).toHaveClass('text-text-primary');
  });

  it('被忽略的目录显示灰色', () => {
    const treeIgnoredDir: FileNode[] = [
      { name: 'src', path: 'src', is_dir: true, children: [], ignored: true },
    ];
    seedDirs(treeIgnoredDir);
    render(<FilesPanel {...baseProps} />);
    expect(screen.getByText('src')).toHaveClass('text-text-muted');
  });

  it('部分忽略：命中的子目录灰显，未命中项保持默认色', () => {
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
            children: [],
            ignored: true,
          },
          { name: 'keep.txt', path: 'sub/keep.txt', is_dir: false, children: [] },
        ],
      },
    ];
    seedDirs(partialTree);
    render(<FilesPanel {...baseProps} />);

    fireEvent.click(screen.getByText('sub'));
    // sub 自身未命中 → 不灰；被忽略的 deep 灰
    expect(screen.getByText('sub')).toHaveClass('text-text-primary');
    expect(screen.getByText('deep')).toHaveClass('text-text-muted');
    expect(screen.getByText('keep.txt')).toHaveClass('text-text-primary');
  });

  it('变更文件状态优先于忽略灰色（Modified→blue，词表唯一源）', () => {
    const treeWithIgnored: FileNode[] = [
      ...tree,
      { name: '.env', path: '.env', is_dir: false, children: [], ignored: true },
    ];
    const changed: FileChange[] = [
      { path: '.env', status: 'Modified', additions: 1, deletions: 0 },
    ];
    seedDirs(treeWithIgnored);
    render(<FilesPanel {...baseProps} changedFiles={changed} />);

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

  it('文件图标不使用半透明样式（浅色背景下保持彩色可见）', () => {
    render(<FilesPanel {...baseProps} />);

    // b.ts → /icons/typescript.svg（彩色 SVG；图标 alt="" 装饰性图片）
    const fileIcon = screen
      .getAllByAltText('')
      .find((img) => img.getAttribute('src') === '/icons/typescript.svg');
    expect(fileIcon).toBeDefined();
    expect(fileIcon!.className).not.toMatch(/opacity/);
  });

  it('选中文件节点时滚动到可见（定位/点击复用同一选中逻辑）', () => {
    const scrollIntoView = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    try {
      render(<FilesPanel {...baseProps} />);
      // 点击文件 → handleSelectNode → selectedPath 命中 → isSelected 滚动
      fireEvent.click(screen.getByText('b.ts'));
      expect(scrollIntoView).toHaveBeenCalled();
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });

  it('切换 file tab（locateTargetPath 变化）时自动定位：展开父目录并选中目标文件', () => {
    const { rerender } = render(
      <FilesPanel {...baseProps} locateTargetPath="src/a.ts" canLocateFile />,
    );

    // 无需点击定位按钮：locateTargetPath 变化即自动执行定位（复用选中逻辑）
    expect(screen.getByRole('treeitem', { selected: true })).toHaveTextContent('a.ts');

    // 切换到另一个文件 tab → 自动定位到新目标
    rerender(<FilesPanel {...baseProps} locateTargetPath="b.ts" canLocateFile />);
    expect(screen.getByRole('treeitem', { selected: true })).toHaveTextContent('b.ts');
  });

  it('关闭 autoLocateFileOnTabSwitch 后切换 tab 不自动定位，定位按钮仍可用', () => {
    const { rerender } = render(
      <FilesPanel
        {...baseProps}
        locateTargetPath="src/a.ts"
        canLocateFile
        autoLocateFileOnTabSwitch={false}
      />,
    );

    // 关闭自动定位：locateTargetPath 变化不选中任何节点
    expect(screen.queryByRole('treeitem', { selected: true })).not.toBeInTheDocument();

    // 手动点击定位按钮 → 仍可定位（按钮与自动定位共用同一选中逻辑）
    rerender(
      <FilesPanel
        {...baseProps}
        locateTargetPath="src/a.ts"
        canLocateFile
        autoLocateFileOnTabSwitch={false}
      />,
    );
    fireEvent.click(screen.getByTitle('Locate current file'));
    expect(screen.getByRole('treeitem', { selected: true })).toHaveTextContent('a.ts');
  });

  it('定位深于初始深度的文件：未加载祖先目录触发懒加载后选中目标（回归）', async () => {
    // 只 seed 根与 src —— 模拟初始加载（DEFAULT_TREE_DEPTH=3）后 src/deep 因
    // children 为空未被 flattenNestedDirs seed，dirs['src/deep'] 缓存缺失。
    useFileStore.getState().reset();
    useFileStore.setState({
      owner: OWNER,
      dirs: {
        '': [{ name: 'src', path: 'src', is_dir: true, children: [] }],
        src: [{ name: 'deep', path: 'src/deep', is_dir: true, children: [] }],
      },
      loadStates: { '': 'loaded', src: 'loaded' },
    });

    // onExpandDir 模拟 store.loadDir 的幂等语义：已加载目录跳过，缺失目录填充一级条目
    const onExpandDir = vi.fn(async (dirPath: string) => {
      const s = useFileStore.getState();
      if (s.dirs[dirPath]) return;
      useFileStore.setState({
        dirs: {
          ...s.dirs,
          [dirPath]: [{ name: 'foo.ts', path: `${dirPath}/foo.ts`, is_dir: false, children: [] }],
        },
        loadStates: { ...s.loadStates, [dirPath]: 'loaded' },
      });
    });

    try {
      render(
        <FilesPanel
          {...baseProps}
          onExpandDir={onExpandDir}
          locateTargetPath="src/deep/foo.ts"
          canLocateFile
          autoLocateFileOnTabSwitch={false}
        />,
      );

      fireEvent.click(screen.getByTitle('Locate current file'));

      // 未加载祖先目录被触发懒加载（从浅到深）
      await waitFor(() => expect(onExpandDir).toHaveBeenCalledWith('src'));
      expect(onExpandDir).toHaveBeenCalledWith('src/deep');

      // 加载完成后目标行出现并被选中（修复前只展开 expandedDirs、无内容 → 永不选中）
      await waitFor(() => {
        expect(screen.getByRole('treeitem', { selected: true })).toHaveTextContent('foo.ts');
      });
    } finally {
      // 恢复基态：后续「目录 git 状态装饰」describe 依赖 seedDirs(tree) 的残留
      seedDirs(tree);
    }
  });
});

describe('目录 git 状态装饰（P1：目录级着色；需求演进：不渲染行尾徽标）', () => {
  const fc = (path: string, status: FileChange['status']): FileChange => ({
    path,
    status,
    additions: 0,
    deletions: 0,
  });

  it('折叠目录显示聚合状态：深层变更文件的祖先目录着色（无需展开）', () => {
    // 变更位于未加载的深层路径：folderSummary 基于 changed 全集而非展开态
    render(<FilesPanel {...baseProps} changedFiles={[fc('src/features/git/a.ts', 'Modified')]} />);

    expect(screen.getByText('src')).toHaveClass('text-accent-blue');
  });

  it('Untracked 聚合为砖红（JetBrains Unversioned）', () => {
    render(<FilesPanel {...baseProps} changedFiles={[fc('src/new-file.ts', 'Untracked')]} />);

    expect(screen.getByText('src')).toHaveClass('text-accent-brick');
  });

  it('Renamed 聚合为黄色', () => {
    render(<FilesPanel {...baseProps} changedFiles={[fc('src/moved.ts', 'Renamed')]} />);

    expect(screen.getByText('src')).toHaveClass('text-accent-blue');
  });

  it('deleted 文件不向目录传播：父目录无着色', () => {
    render(<FilesPanel {...baseProps} changedFiles={[fc('src/gone.ts', 'Deleted')]} />);

    expect(screen.getByText('src')).toHaveClass('text-text-primary');
  });

  it('多状态共存时 modified 优先于 added', () => {
    // 目录摘要同时含 Added + Modified → 主导状态取 modified（黄色）
    render(
      <FilesPanel
        {...baseProps}
        changedFiles={[fc('src/a.ts', 'Added'), fc('src/deep/other.ts', 'Modified')]}
      />,
    );

    expect(screen.getByText('src')).toHaveClass('text-accent-blue');
  });

  it('展开后子文件按自身 status 着色，且无变更的目录不携带徽标', () => {
    render(<FilesPanel {...baseProps} changedFiles={[fc('src/a.ts', 'Modified')]} />);

    fireEvent.click(screen.getByText('src'));
    expect(screen.getByText('a.ts')).toHaveClass('text-accent-blue');
    // b.ts 所在根列表无目录徽标污染：普通文件保持默认色
    expect(screen.getByText('b.ts')).toHaveClass('text-text-primary');
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

describe('FileTreeNode draggable（目录拖拽）', () => {
  beforeEach(() => {
    seedDirs(tree);
    vi.clearAllMocks();
  });

  /**
   * 获取 treeitem 节点：通过文本找到 span，再向上找到 [role="treeitem"]。
   * 使用 getByRole('treeitem') + 文本匹配，避免 testing-library/no-node-access。
   */
  function getTreeitemByText(text: string): HTMLElement {
    const allItems = screen.getAllByRole('treeitem');
    const found = allItems.find((el) => el.textContent?.includes(text));
    if (!found) throw new Error(`treeitem containing "${text}" not found`);
    return found;
  }

  it('目录节点应具有 draggable 属性', () => {
    render(<FilesPanel {...baseProps} />);

    // 展开 src 目录
    fireEvent.click(screen.getByText('src'));

    // src 目录节点应可拖拽
    const srcNode = getTreeitemByText('src');
    expect(srcNode).toHaveAttribute('draggable', 'true');
  });

  it('拖拽目录时应调用 setDragFile', () => {
    render(<FilesPanel {...baseProps} />);

    // 展开 src 目录
    fireEvent.click(screen.getByText('src'));

    const srcNode = getTreeitemByText('src');

    // 模拟 dragStart 事件
    fireEvent.dragStart(srcNode, {
      dataTransfer: { effectAllowed: 'copy', setData: vi.fn() },
    });

    // 验证 setDragFile 被调用，传入目录路径
    expect(setDragFile).toHaveBeenCalledWith('src', 'p1');
  });

  it('文件节点拖拽时也应调用 setDragFile', () => {
    render(<FilesPanel {...baseProps} />);

    // 展开 src 目录
    fireEvent.click(screen.getByText('src'));

    const fileNode = getTreeitemByText('a.ts');

    fireEvent.dragStart(fileNode, {
      dataTransfer: { effectAllowed: 'copy', setData: vi.fn() },
    });

    expect(setDragFile).toHaveBeenCalledWith('src/a.ts', 'p1');
  });

  it('projectId 为空时节点不可拖拽', () => {
    render(<FilesPanel {...baseProps} projectId={null} />);

    // 展开 src 目录
    fireEvent.click(screen.getByText('src'));

    const srcNode = getTreeitemByText('src');
    expect(srcNode).toHaveAttribute('draggable', 'false');
  });
});

describe('Java 包视图压行 + 链自动展开（方案A）', () => {
  const javaChain: FileNode[] = [
    {
      name: 'src',
      path: 'src',
      is_dir: true,
      children: [
        {
          name: 'main',
          path: 'src/main',
          is_dir: true,
          children: [
            {
              name: 'java',
              path: 'src/main/java',
              is_dir: true,
              children: [
                {
                  name: 'com',
                  path: 'src/main/java/com',
                  is_dir: true,
                  children: [
                    {
                      name: 'tomgs',
                      path: 'src/main/java/com/tomgs',
                      is_dir: true,
                      children: [
                        {
                          name: 'algorithm',
                          path: 'src/main/java/com/tomgs/algorithm',
                          is_dir: true,
                          children: [
                            {
                              name: 'array',
                              path: 'src/main/java/com/tomgs/algorithm/array',
                              is_dir: true,
                              children: [
                                {
                                  name: 'ArrayTest.java',
                                  path: 'src/main/java/com/tomgs/algorithm/array/ArrayTest.java',
                                  is_dir: false,
                                  children: [],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ];

  function treeitemByText(text: string): HTMLElement | null {
    return screen.getAllByRole('treeitem').find((el) => el.textContent?.includes(text)) ?? null;
  }

  it('源根 java 点击后：单子目录链自动展开 + 压行显示，叶子可见', async () => {
    seedDirs(javaChain);
    render(<FilesPanel {...baseProps} />);

    fireEvent.click(screen.getByText('src'));
    fireEvent.click(screen.getByText('main'));
    fireEvent.click(screen.getByText('java'));

    // 自动逐级展开 com→tomgs→algorithm→array，压成一行（path 取叶子）
    await waitFor(() => expect(treeitemByText('com.tomgs.algorithm.array')).toBeInTheDocument());
    expect(treeitemByText('ArrayTest.java')).toBeInTheDocument();
  });

  it('非 java 目录不压行（src 原样展开）', async () => {
    seedDirs(tree);
    render(<FilesPanel {...baseProps} />);

    fireEvent.click(screen.getByText('src'));
    expect(screen.getByText('src')).toBeInTheDocument();
    expect(screen.getByText('a.ts')).toBeInTheDocument();
  });
});
