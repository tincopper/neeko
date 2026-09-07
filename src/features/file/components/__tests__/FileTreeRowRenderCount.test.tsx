import { act, fireEvent, render as renderRTL, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * S3/S4 渲染隔离验收（扁平行结构）：git 快照 / 桶重载 / tab 切换 / 击键期间，
 * 未受影响行不重渲染（render count 断言兜底）。memo 边界复用真实比较器
 * （areFileTreeRowPropsEqual）——被测对象就是这个边界本身。
 */
const harness = vi.hoisted(() => ({
  counts: new Map<string, number>(),
}));

// 异步工厂：动态 import 真实比较器与词表函数（避免 import/order 重排的初始化顺序风险）
vi.mock('@/features/file/components/FileTreeRow', async () => {
  const { areFileTreeRowPropsEqual } = await import('@/features/file/components/fileTreeRowProps');
  const { statusToNameColorClass } = await import('@/shared/utils/gitFileDecoration');

  function FakeFileTreeRow(props: {
    row: {
      kind: 'node' | 'renaming' | 'creating';
      node: FileTreeViewNode;
      depth: number;
    };
    onToggleDir?: (path: string) => void;
    onSelectNode?: (path: string, isDir: boolean) => void;
    onSelectFile?: (path: string) => void;
    onCreatingValueChange?: (value: string) => void;
    [key: string]: unknown;
  }) {
    const { row } = props;
    const node = row.node;
    harness.counts.set(node.path, (harness.counts.get(node.path) ?? 0) + 1);
    const color = statusToNameColorClass(
      node.git_status,
      node.is_ignored === true,
      node.is_active === true,
    );
    if (row.kind === 'creating') {
      return (
        <input
          aria-label="filename"
          value={node.creating_input?.value ?? ''}
          onChange={(e) => props.onCreatingValueChange?.(e.target.value)}
        />
      );
    }
    if (row.kind === 'renaming') {
      return <input aria-label="rename-input" value={node.renaming_name ?? ''} readOnly />;
    }
    const handleClick = (e: React.MouseEvent) => {
      // 与真实 FileTreeRow 契约一致：节点点击不冒泡到树容器（容器空白才选根）
      e.stopPropagation();
      props.onSelectNode?.(node.path, node.is_dir);
      if (node.is_dir) {
        props.onToggleDir?.(node.path);
      } else {
        props.onSelectFile?.(node.path);
      }
    };
    return (
      <div
        role="button"
        tabIndex={0}
        className={color}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') handleClick(e);
        }}
      >
        {node.name}
      </div>
    );
  }
  const MemoFake = React.memo(FakeFileTreeRow, areFileTreeRowPropsEqual);
  return { default: MemoFake };
});

import FilesPanel from '@/features/file/components/FilesPanel';
import { useFileStore } from '@/features/file/store';
import type { FileChange, FileNode } from '@/shared/types';
import { createAppProviderWrapper } from '@/testing/AppProviderTestUtils';

const render = (ui: Parameters<typeof renderRTL>[0]) =>
  renderRTL(ui, { wrapper: createAppProviderWrapper() });

const OWNER = 'p1:/demo';

const tree: FileNode[] = [
  {
    name: 'src',
    path: 'src',
    is_dir: true,
    children: [{ name: 'a.ts', path: 'src/a.ts', is_dir: false, children: [] }],
  },
  { name: 'b.ts', path: 'b.ts', is_dir: false, children: [] },
];

function seedDirs(nodes: FileNode[]) {
  const dirs: Record<string, FileNode[]> = {
    '': nodes.map((n) => ({ ...n, children: [] })),
    src: [{ name: 'a.ts', path: 'src/a.ts', is_dir: false, children: [] }],
  };
  useFileStore.getState().reset();
  useFileStore.setState({
    owner: OWNER,
    dirs,
    loadStates: Object.fromEntries(Object.keys(dirs).map((k) => [k, 'loaded' as const])),
  });
}

const fc = (path: string, status: FileChange['status']): FileChange => ({
  path,
  status,
  additions: 0,
  deletions: 0,
});

const baseProps = {
  projectName: 'demo',
  projectPath: '/demo',
  projectId: 'p1',
  activeFilePath: null as string | null,
  onSelectFile: vi.fn(),
  onRefresh: vi.fn(),
  onExpandDir: vi.fn().mockResolvedValue(undefined),
  projectType: 'Local' as const,
  onCreateFile: vi.fn().mockResolvedValue(undefined),
};

const totalRenders = () => [...harness.counts.values()].reduce((a, b) => a + b, 0);

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

describe('未受影响行不重渲染（S4 扁平行 render count 兜底）', () => {
  beforeEach(() => {
    seedDirs(tree);
    harness.counts.clear();
    vi.clearAllMocks();
  });

  it('status 内容不变的高频刷新（新数组引用）：零行重渲染', () => {
    const { rerender } = render(
      <FilesPanel {...baseProps} changedFiles={[fc('src/a.ts', 'Modified')]} />,
    );

    fireEvent.click(screen.getByText('src'));
    harness.counts.clear();

    rerender(<FilesPanel {...baseProps} changedFiles={[fc('src/a.ts', 'Modified')]} />);
    expect(totalRenders()).toBe(0);
  });

  it('单一路径 status 变化：仅受影响链路（src 与 a.ts）各重渲染一次', () => {
    const { rerender } = render(
      <FilesPanel {...baseProps} changedFiles={[fc('src/a.ts', 'Modified')]} />,
    );

    fireEvent.click(screen.getByText('src'));
    harness.counts.clear();

    rerender(<FilesPanel {...baseProps} changedFiles={[fc('src/a.ts', 'Added')]} />);

    expect(harness.counts.get('src')).toBe(1);
    expect(harness.counts.get('src/a.ts')).toBe(1);
    expect(harness.counts.get('b.ts') ?? 0).toBe(0);
    expect(screen.getByText('a.ts')).toHaveClass('text-accent-green');
  });

  it('清空变更列表：颜色回退默认色且重渲染限定在受影响链路', () => {
    const { rerender } = render(
      <FilesPanel {...baseProps} changedFiles={[fc('src/a.ts', 'Added')]} />,
    );

    fireEvent.click(screen.getByText('src'));
    harness.counts.clear();

    rerender(<FilesPanel {...baseProps} changedFiles={[]} />);

    expect(harness.counts.get('src')).toBe(1);
    expect(harness.counts.get('src/a.ts')).toBe(1);
    expect(harness.counts.get('b.ts') ?? 0).toBe(0);
    expect(screen.getByText('a.ts')).toHaveClass('text-text-primary');
  });

  it('目录桶重载但内容未变：零行重渲染（指纹等值）', () => {
    render(<FilesPanel {...baseProps} changedFiles={[fc('src/a.ts', 'Modified')]} />);

    fireEvent.click(screen.getByText('src'));
    harness.counts.clear();

    act(() => {
      seedDirs(tree);
    });

    expect(totalRenders()).toBe(0);
  });

  it('桶重载且内容变化：仅受影响链路重渲染', () => {
    render(<FilesPanel {...baseProps} changedFiles={[fc('src/a.ts', 'Modified')]} />);

    fireEvent.click(screen.getByText('src'));
    harness.counts.clear();

    const dirs: Record<string, FileNode[]> = {
      '': tree.map((n) => ({ ...n, children: [] })),
      src: [{ name: 'a2.ts', path: 'src/a2.ts', is_dir: false, children: [] }],
    };
    act(() => {
      useFileStore.setState({ dirs });
    });

    expect(harness.counts.get('src')).toBe(1);
    expect(harness.counts.get('src/a2.ts')).toBe(1);
    expect(harness.counts.get('b.ts') ?? 0).toBe(0);
  });

  it('tab 切换（activeFilePath 变化）：仅激活节点及其祖先链重渲染', () => {
    const { rerender } = render(<FilesPanel {...baseProps} activeFilePath={null} />);

    fireEvent.click(screen.getByText('src'));
    harness.counts.clear();

    rerender(<FilesPanel {...baseProps} activeFilePath="src/a.ts" />);

    expect(harness.counts.get('src/a.ts')).toBe(1);
    expect(harness.counts.get('src')).toBe(1);
    expect(harness.counts.get('b.ts') ?? 0).toBe(0);
    // 树行（fake 的 role=button）而非头部激活文件名 span
    expect(screen.getByRole('button', { name: 'a.ts' })).toHaveClass('text-accent');
  });

  it('窗口化：大目录仅挂载可见窗口行（O(可见行数)，S4 核心）', () => {
    // 200 个文件的展开目录 + 根，扁平行共 201 行
    const bigChildren: FileNode[] = Array.from({ length: 200 }, (_, i) => ({
      name: `f${i}.ts`,
      path: `big/f${i}.ts`,
      is_dir: false,
      children: [],
    }));
    const bigTree: FileNode[] = [{ name: 'big', path: 'big', is_dir: true, children: bigChildren }];
    const dirs: Record<string, FileNode[]> = {
      '': bigTree.map((n) => ({ ...n, children: [] })),
      big: bigChildren,
    };
    useFileStore.getState().reset();
    useFileStore.setState({
      owner: OWNER,
      dirs,
      loadStates: Object.fromEntries(Object.keys(dirs).map((k) => [k, 'loaded' as const])),
    });

    render(<FilesPanel {...baseProps} />);
    const listRows = () => within(screen.getByTestId('scroll-list')).getAllByRole('button');
    // big 未展开：仅根行挂载（查询限定滚动容器，排除头部按钮）
    expect(listRows().length).toBe(1);

    fireEvent.click(screen.getByText('big'));
    // 展开后 201 行中仅窗口行挂载（1200px 视口 + overscan << 201）
    const mounted = listRows().length;
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(201);
  });

  it('新建输入击键：仅输入行所在链路重渲染（node 行 + creating 行）', () => {
    render(<FilesPanel {...baseProps} />);

    fireEvent.click(screen.getByText('src'));
    fireEvent.click(screen.getByTitle('New File'));
    harness.counts.clear();

    fireEvent.change(screen.getByLabelText('filename'), { target: { value: 'x' } });

    // src 的 node 行与 creating 行共享同一 node 指纹，各重渲染一次
    expect(harness.counts.get('src')).toBe(2);
    expect(harness.counts.get('src/a.ts') ?? 0).toBe(0);
    expect(harness.counts.get('b.ts') ?? 0).toBe(0);
  });
});
