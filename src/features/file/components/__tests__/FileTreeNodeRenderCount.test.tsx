import { fireEvent, render as renderRTL, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P3 验收：git 状态刷新期间未受影响节点不重渲染（render count 断言兜底）。
 *
 * 用带计数的替身组件替换递归的 FileTreeNode（保留最小结构语义：
 * 点击 toggle/选中走真实回调链、装饰色供断言、expandedDirs 展开递归），
 * 在真实 FilesPanel/store/memo 边界上统计每个节点的渲染次数。
 */
const harness = vi.hoisted(() => ({
  /** 每个节点路径的实际渲染次数（由替身组件累加） */
  counts: new Map<string, number>(),
}));

vi.mock('@/features/file/components/FileTreeNode', () => ({
  // 必须 memo 包装：被测目标就是 memo 边界本身，裸函数会让整树无条件重渲染
  default: React.memo(function FakeFileTreeNode(props: {
    node: FileNode;
    expandedDirs: Set<string>;
    decoration?: { color?: string } | null;
    onToggleDir?: (path: string) => void;
    onSelectNode?: (path: string, isDir: boolean) => void;
    onSelectFile?: (path: string) => void;
    [key: string]: unknown;
  }) {
    const { node, decoration } = props;
    harness.counts.set(node.path, (harness.counts.get(node.path) ?? 0) + 1);
    // 保留最小交互语义：点击 toggle 与选中走真实回调链
    const handleClick = () => {
      props.onSelectNode?.(node.path, node.is_dir);
      if (node.is_dir) {
        props.onToggleDir?.(node.path);
      } else {
        props.onSelectFile?.(node.path);
      }
    };
    // 测试探针同样需要键盘可达（jsx-a11y）
    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleClick();
      }
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resolveFor = (props as any).resolveDecorationFor as
      | ((path: string, isDir: boolean, active: boolean) => { color?: string } | null)
      | undefined;
    if (!node.is_dir || !props.expandedDirs.has(node.path)) {
      return (
        <div
          role="button"
          tabIndex={0}
          className={decoration?.color ?? ''}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
        >
          {node.name}
        </div>
      );
    }
    return (
      <div>
        <div
          role="button"
          tabIndex={0}
          className={decoration?.color ?? ''}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
        >
          {node.name}
        </div>
        {/* 递归子节点：与真实组件一致，由父级为每个直接子节点解析装饰 */}
        {node.children.map((child) => {
          // 从递归上下文中取 activeFilePath（避免伪造新回调）
          const activeFilePath =
            (props as unknown as { activeFilePath?: string | null }).activeFilePath ?? null;
          const childDeco = resolveFor?.(child.path, child.is_dir, activeFilePath === child.path);
          return (
            <FakeFileTreeNode key={child.path} {...props} node={child} decoration={childDeco} />
          );
        })}
      </div>
    );
  }),
}));

import FilesPanel from '@/features/file/components/FilesPanel';
import { useFileStore } from '@/features/file/store';
import type { FileChange, FileNode } from '@/shared/types';
import { createAppProviderWrapper } from '@/testing/AppProviderTestUtils';

/** FilesPanel 内部 hook 依赖 useAppContext 的 toast */
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

/** 注入扁平目录缓存（根 + src 均已加载），与 store 的 stripChildren 语义一致 */
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
  activeFilePath: null,
  onSelectFile: vi.fn(),
  onRefresh: vi.fn(),
  onExpandDir: vi.fn().mockResolvedValue(undefined),
  projectType: 'Local' as const,
};

const totalRenders = () => [...harness.counts.values()].reduce((a, b) => a + b, 0);

describe('git 刷新期间未受影响节点不重渲染（P3 render count 兜底）', () => {
  beforeEach(() => {
    seedDirs(tree);
    harness.counts.clear();
    vi.clearAllMocks();
  });

  it('status 内容不变的高频刷新（新数组引用）：零节点重渲染', () => {
    const changed1 = [fc('src/a.ts', 'Modified')];
    const { rerender } = render(<FilesPanel {...baseProps} changedFiles={changed1} />);

    // 展开 src，让深层节点进入渲染树后再取基线
    fireEvent.click(screen.getByText('src'));
    harness.counts.clear();

    // git-changed 事件风暴模拟：内容相同的全新数组/对象引用
    rerender(<FilesPanel {...baseProps} changedFiles={[fc('src/a.ts', 'Modified')]} />);

    // 装饰实例经复用缓存结构等值 → 所有节点 props 浅比较命中 React.memo
    expect(totalRenders()).toBe(0);
  });

  it('单一路径 status 变化：仅受影响链路（src 与 a.ts）各重渲染一次', () => {
    const changed1 = [fc('src/a.ts', 'Modified')];
    const { rerender } = render(<FilesPanel {...baseProps} changedFiles={changed1} />);

    fireEvent.click(screen.getByText('src'));
    harness.counts.clear();

    // src/a.ts Modified → Added：目录聚合与文件自身装饰都真变
    rerender(<FilesPanel {...baseProps} changedFiles={[fc('src/a.ts', 'Added')]} />);

    expect(harness.counts.get('src')).toBe(1);
    expect(harness.counts.get('src/a.ts')).toBe(1);
    // 无关兄弟节点完全不重渲染
    expect(harness.counts.get('b.ts') ?? 0).toBe(0);
    // 变更经 memo 边界传播到了 DOM（a.ts 装饰色翻转为 Added 绿）
    expect(screen.getByText('a.ts')).toHaveClass('text-accent-green');
  });

  it('清空变更列表：颜色回退默认色且重渲染限定在受影响链路', () => {
    const changed1 = [fc('src/a.ts', 'Added')];
    const { rerender } = render(<FilesPanel {...baseProps} changedFiles={changed1} />);

    fireEvent.click(screen.getByText('src'));
    harness.counts.clear();

    rerender(<FilesPanel {...baseProps} changedFiles={[]} />);

    expect(harness.counts.get('src')).toBe(1);
    expect(harness.counts.get('src/a.ts')).toBe(1);
    expect(harness.counts.get('b.ts') ?? 0).toBe(0);
    expect(screen.getByText('a.ts')).toHaveClass('', { exact: true });
  });
});
