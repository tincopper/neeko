import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { CommitDetail, CommitEntry, CommitFileChange } from '@/features/git/types';

import CommitList from '../CommitList';

// jsdom 无 IO/RO，测试内 stub（afterEach 会恢复全局，故放 beforeEach）
class IOMock {
  static instances: IOMock[] = [];
  callback: IntersectionObserverCallback;
  observed: Element[] = [];
  disconnected = false;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    IOMock.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
}

class ROMock {
  static instances: ROMock[] = [];
  callback: ResizeObserverCallback;
  observed: Element[] = [];
  disconnected = false;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ROMock.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
}

// CommitGraph overlay 替换为可观测 hoveredHash 的桩，防悬停高亮回归
vi.mock('../CommitGraph', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../CommitGraph')>();
  return {
    ...actual,
    default: ({ hoveredHash }: { hoveredHash: string | null }) => (
      <div data-testid="graph-overlay" data-hovered={hoveredHash ?? ''} />
    ),
  };
});

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', IOMock);
  vi.stubGlobal('ResizeObserver', ROMock);
});

afterEach(() => {
  IOMock.instances = [];
  ROMock.instances = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function makeCommits(n: number): CommitEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    hash: `h${i}`,
    short_hash: `h${i}`,
    author: 'Alice',
    timestamp: `2026-07-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z`,
    message: `fix: item ${i}`,
    refs: '',
    parents: [],
  }));
}

const detail: CommitDetail = {
  hash: 'h0',
  short_hash: 'h0',
  author: 'Alice',
  email: 'a@b.c',
  timestamp: '2026-07-01T10:00:00Z',
  message: 'fix: item 0',
  parents: [],
  refs: '',
};

const files: CommitFileChange[] = [{ path: 'src/foo.ts', status: 'M', additions: 2, deletions: 1 }];

function baseProps(overrides: Partial<Parameters<typeof CommitList>[0]> = {}) {
  return {
    commits: makeCommits(20),
    selectedHash: null,
    selectedExpanded: false,
    detail: null,
    files: [],
    detailLoading: false,
    detailError: null,
    onSelectCommit: vi.fn(),
    onOpenDiff: vi.fn(),
    onPinFile: vi.fn(),
    loading: false,
    hasMore: false,
    onLoadMore: vi.fn(),
    loadingMore: false,
    searchQuery: '',
    focusedFileIndex: -1,
    onClearSearch: vi.fn(),
    ...overrides,
  };
}

describe('CommitList 集成', () => {
  it('初始窗口渲染 0..overscan 行（20 行数据 → 11 行可见）', () => {
    render(<CommitList {...baseProps()} />);
    expect(screen.getAllByTestId('commit-row')).toHaveLength(11);
  });

  it('搜索过滤减少可见行', () => {
    render(<CommitList {...baseProps({ searchQuery: 'item 1' })} />);
    // 匹配 item 1 与 item 10..19 共 11 行；窗口 0..10 全渲染
    expect(screen.getAllByTestId('commit-row')).toHaveLength(11);
    expect(screen.getByText('item 1')).toBeInTheDocument();
    expect(screen.queryByText('item 0')).not.toBeInTheDocument();
  });

  it('行点击触发 onSelectCommit', () => {
    const onSelectCommit = vi.fn();
    render(<CommitList {...baseProps({ onSelectCommit })} />);
    fireEvent.click(screen.getAllByTestId('commit-row')[0]!);
    expect(onSelectCommit).toHaveBeenCalledWith('h0');
  });

  it('选中展开后显示详情面板与文件行', () => {
    render(
      <CommitList
        {...baseProps({
          selectedHash: 'h0',
          selectedExpanded: true,
          detail,
          files,
          detailLoading: false,
        })}
      />,
    );
    expect(screen.getByText('foo.ts')).toBeInTheDocument();
    expect(screen.getByText(/parents: —/)).toBeInTheDocument();
  });

  it('展开面板点击文件行触发 onOpenDiff，双击触发 onPinFile', () => {
    const onOpenDiff = vi.fn();
    const onPinFile = vi.fn();
    render(
      <CommitList
        {...baseProps({
          selectedHash: 'h0',
          selectedExpanded: true,
          detail,
          files,
          detailLoading: false,
          onOpenDiff,
          onPinFile,
        })}
      />,
    );
    const fileRow = screen.getByTestId('commit-file-src/foo.ts');
    fireEvent.click(fileRow);
    expect(onOpenDiff).toHaveBeenCalledWith('src/foo.ts');
    fireEvent.doubleClick(fileRow);
    expect(onPinFile).toHaveBeenCalledWith('src/foo.ts');
  });

  it('悬停行 → CommitGraph overlay 收到 hoveredHash（防高亮回归）', () => {
    render(<CommitList {...baseProps()} />);
    const overlay = screen.getByTestId('graph-overlay');
    expect(overlay).toHaveAttribute('data-hovered', '');
    fireEvent.mouseEnter(screen.getAllByTestId('commit-row')[0]!);
    expect(overlay).toHaveAttribute('data-hovered', 'h0');
    fireEvent.mouseLeave(screen.getAllByTestId('commit-row')[0]!);
    expect(overlay).toHaveAttribute('data-hovered', '');
  });

  it('无限滚动：hasMore 时 sentinel 触发 onLoadMore', () => {
    const onLoadMore = vi.fn();
    render(<CommitList {...baseProps({ hasMore: true, onLoadMore })} />);
    expect(IOMock.instances).toHaveLength(1);
    const io = IOMock.instances[0]!;
    expect(io.observed).toHaveLength(1);
    act(() => {
      io.callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        io as unknown as IntersectionObserver,
      );
    });
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('回归：数据异步到达后容器才出现，仍须附着 ResizeObserver 测量视口（修复首屏空白需滚动）', async () => {
    // 首帧骨架：容器未渲染，RO 不应创建
    const { rerender } = render(<CommitList {...baseProps({ loading: true, commits: [] })} />);
    expect(ROMock.instances).toHaveLength(0);
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();

    // 数据到达 → 容器出现 → 必须创建 RO 并观察容器（此前依赖 [] 只在挂载时测量，容器晚到则永不测量）
    rerender(<CommitList {...baseProps({ commits: makeCommits(20) })} />);
    // flush useExpandPanel 的 Promise.resolve().then(setExpandHeight(0)) 微任务，避免 act 警告
    await act(async () => {
      await Promise.resolve();
    });
    expect(ROMock.instances).toHaveLength(1);
    const ro = ROMock.instances[0]!;
    expect(ro.observed).toHaveLength(1);

    // 模拟真实浏览器：容器有实际高度时 RO 回调 → 视口高度生效 → 窗口扩大补全列表
    const container = ro.observed[0]!;
    Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true });
    act(() => {
      ro.callback([{} as ResizeObserverEntry], ro as unknown as ResizeObserver);
    });
    // 400px 视口 → 20 行全部渲染（不再只有 overscan 的 11 行，下方空白）
    expect(screen.getAllByTestId('commit-row')).toHaveLength(20);
  });

  it('首屏加载显示骨架', () => {
    render(<CommitList {...baseProps({ loading: true, commits: [] })} />);
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
  });

  it('空列表显示空态；搜索无结果显示清除按钮', () => {
    const { unmount } = render(<CommitList {...baseProps({ commits: [] })} />);
    expect(screen.getByText('No commits yet')).toBeInTheDocument();
    unmount();
    const onClearSearch = vi.fn();
    render(<CommitList {...baseProps({ commits: [], searchQuery: 'zzz', onClearSearch })} />);
    expect(screen.getByText('No matching commits')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Clear filter'));
    expect(onClearSearch).toHaveBeenCalled();
  });
});
