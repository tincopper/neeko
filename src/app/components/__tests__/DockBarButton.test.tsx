import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useAppViewStore } from '@/shared/store/appViewStore';
import { TooltipProvider } from '@/ui/Tooltip';

import DockBarButton from '../DockBarButton';

function renderLibraryButton(): void {
  render(
    <TooltipProvider>
      <DockBarButton panelId="library" side="left" />
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
