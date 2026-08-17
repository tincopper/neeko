import { fireEvent, render, screen } from '@testing-library/react';
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
