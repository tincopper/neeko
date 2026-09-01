import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import TabBar from '@/features/editor/components/TabBar';
import type { Tab } from '@/shared/types/tab';

const makeTab = (id: string, title: string): Tab => ({
  id,
  projectId: 'p1',
  title,
  order: 0,
  data: {
    kind: 'file',
    filePath: title,
    fileName: title,
    content: { path: title, content: '', size: 0, is_binary: false },
    isDirty: false,
  },
});

const makeTerminalTab = (id: string, title: string): Tab => ({
  id,
  projectId: 'p1',
  title,
  order: 0,
  data: { kind: 'terminal', agentId: null, status: 'Idle' },
});

const renderTabBar = (onNewFileTab?: () => void) =>
  render(
    <TabBar
      tabs={[makeTab('t1', 'a.ts')]}
      activeTabId="t1"
      onActivateTab={vi.fn()}
      onCloseTab={vi.fn()}
      onNewFileTab={onNewFileTab}
    />,
  );

describe('TabBar 双击新建文件', () => {
  it('双击 tab 栏空白区域触发 onNewFileTab', () => {
    const onNewFileTab = vi.fn();
    renderTabBar(onNewFileTab);

    fireEvent.doubleClick(screen.getByRole('tablist'));
    expect(onNewFileTab).toHaveBeenCalledTimes(1);
  });

  it('双击 tab 项本身不触发 onNewFileTab', () => {
    const onNewFileTab = vi.fn();
    renderTabBar(onNewFileTab);

    fireEvent.doubleClick(screen.getByRole('tab'));
    expect(onNewFileTab).not.toHaveBeenCalled();
  });

  it('未提供 onNewFileTab 时双击空白区域不报错', () => {
    renderTabBar();

    expect(() => fireEvent.doubleClick(screen.getByRole('tablist'))).not.toThrow();
  });
});

describe('TabBar + 按钮（New action）', () => {
  it('终端 tab 达到 10 个时 + 按钮仍然显示（不再受数量门控）', () => {
    const tabs = Array.from({ length: 10 }, (_, i) =>
      makeTerminalTab(`t${i}`, `Terminal ${i + 1}`),
    );
    const onActionMenuOpen = vi.fn();

    render(
      <TabBar
        tabs={tabs}
        activeTabId="t0"
        onActivateTab={vi.fn()}
        onCloseTab={vi.fn()}
        onActionMenuOpen={onActionMenuOpen}
      />,
    );

    const addBtn = screen.getByLabelText('New action');
    expect(addBtn).toBeInTheDocument();
    fireEvent.click(addBtn);
    expect(onActionMenuOpen).toHaveBeenCalledTimes(1);
  });

  it('未提供 onAddTerminalTab / onActionMenuOpen 时不渲染 + 按钮', () => {
    renderTabBar();

    expect(screen.queryByLabelText('New action')).not.toBeInTheDocument();
  });
});

describe('TabBar 溢出收纳', () => {
  const makeFileTabs = () => [
    makeTab('one', 'one.ts'),
    makeTab('two', 'two.ts'),
    makeTab('three', 'three.ts'),
  ];

  /** 模拟布局：容器 clientWidth 固定，tab 自然宽度按标题区分 */
  const mockLayout = (containerWidth: number) => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(containerWidth);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const text = this.textContent ?? '';
      const width = text.includes('three.ts') ? 150 : text.includes('two.ts') ? 100 : 100;
      return {
        width,
        height: 24,
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: width,
        bottom: 24,
        toJSON: () => ({}),
      } as DOMRect;
    });
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('全部放得下 → 不渲染溢出按钮', () => {
    mockLayout(600);
    render(
      <TabBar
        tabs={makeFileTabs()}
        activeTabId="one"
        onActivateTab={vi.fn()}
        onCloseTab={vi.fn()}
      />,
    );

    expect(screen.getByRole('tab', { name: /one\.ts/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /two\.ts/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('Hidden tabs')).not.toBeInTheDocument();
  });

  it('放不下 → 溢出 tab 从 tab 栏移除并出现「⋯」按钮', () => {
    mockLayout(200);
    render(
      <TabBar
        tabs={makeFileTabs()}
        activeTabId="one"
        onActivateTab={vi.fn()}
        onCloseTab={vi.fn()}
      />,
    );

    // one 为激活 tab 强制可见；two/three 放不下进下拉
    expect(screen.getByRole('tab', { name: /one\.ts/ })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /two\.ts/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /three\.ts/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Hidden tabs')).toBeInTheDocument();
  });

  it('点击「⋯」打开下拉，点击隐藏 tab 触发激活', () => {
    mockLayout(200);
    const onActivateTab = vi.fn();
    render(
      <TabBar
        tabs={makeFileTabs()}
        activeTabId="one"
        onActivateTab={onActivateTab}
        onCloseTab={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText('Hidden tabs'));
    const menuItem = screen.getByRole('menuitem', { name: /two\.ts/ });
    fireEvent.click(menuItem);
    expect(onActivateTab).toHaveBeenCalledWith('two');
  });

  it('下拉中点击 × 直接关闭隐藏 tab', () => {
    mockLayout(200);
    const onCloseTab = vi.fn();
    render(
      <TabBar
        tabs={makeFileTabs()}
        activeTabId="one"
        onActivateTab={vi.fn()}
        onCloseTab={onCloseTab}
      />,
    );

    fireEvent.click(screen.getByLabelText('Hidden tabs'));
    const menuItem = screen.getByRole('menuitem', { name: /three\.ts/ });
    const closeBtn = within(menuItem).getByTitle('Close tab');
    fireEvent.click(closeBtn);
    expect(onCloseTab).toHaveBeenCalledWith('three');
  });
});
