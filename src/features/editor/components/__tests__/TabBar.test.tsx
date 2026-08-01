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
