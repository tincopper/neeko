import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { useAppViewStore } from '@/shared/store/appViewStore';
import { useDockStore } from '@/shared/store/dockStore';
import { TooltipProvider } from '@/ui/Tooltip';

import DockBarButton from '../DockBarButton';

function renderLibraryButton(): void {
  render(
    <TooltipProvider>
      <DockBarButton panelId="library" side="left" />
    </TooltipProvider>,
  );
}

function renderTasksButton(): void {
  render(
    <TooltipProvider>
      <DockBarButton panelId="tasks" side="left" />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  useAppViewStore.setState({ appView: 'normal' });
});

describe('DockBarButton — tab-mode 选中态', () => {
  it('library 中心视图激活时高亮（tab 面板永不进 zone）', () => {
    useAppViewStore.setState({ appView: 'library' });
    renderLibraryButton();
    const target = screen.getByRole('button', { name: 'Library' });
    // 高亮类在装饰性内层 span 上，无 Testing Library 等价查询
    // eslint-disable-next-line testing-library/no-node-access
    expect(target.querySelector('span')?.className).toContain('bg-bg-selected');
  });

  it('normal 视图下不高亮', () => {
    renderLibraryButton();
    const target = screen.getByRole('button', { name: 'Library' });
    // eslint-disable-next-line testing-library/no-node-access
    expect(target.querySelector('span')?.className).not.toContain('bg-bg-selected');
  });
});

describe('DockBarButton — 左栏 Tasks 入口', () => {
  beforeEach(() => {
    localStorage.clear();
    useAppViewStore.setState({ appView: 'normal' });
    useDockStore.setState((state) => ({
      zones: {
        ...state.zones,
        left: state.zones.left ? { ...state.zones.left, expanded: true } : state.zones.left,
      },
      leftZoneExpandedBeforeTabView: null,
    }));
  });

  it('点一下 → 打开 tasks 中心视图（左栏保持展开）；再点一下 → 退出', async () => {
    const user = userEvent.setup();
    renderTasksButton();

    await user.click(screen.getByRole('button', { name: 'Tasks' }));
    expect(useAppViewStore.getState().appView).toBe('tasks');
    // Tasks 只占中间区：左栏 Projects 是「切项目」的入口（`collapseLeftZone: false`），
    // 收起它等于把上下文藏起来（design §4.2c）。
    expect(useDockStore.getState().zones.left?.expanded).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Tasks' }));
    expect(useAppViewStore.getState().appView).toBe('normal');
    expect(useDockStore.getState().zones.left?.expanded).toBe(true);
  });

  it('tasks 中心视图激活时高亮', () => {
    useAppViewStore.setState({ appView: 'tasks' });
    renderTasksButton();
    const target = screen.getByRole('button', { name: 'Tasks' });
    // eslint-disable-next-line testing-library/no-node-access
    expect(target.querySelector('span')?.className).toContain('bg-bg-selected');
  });
});
