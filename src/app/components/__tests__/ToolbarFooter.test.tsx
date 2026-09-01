import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAppViewStore } from '@/shared/store/appViewStore';

import ToolbarFooter from '../ToolbarFooter';

// AddProjectMenu 依赖点击展开，非本测试焦点
vi.mock('../AddProjectMenu', () => ({ default: () => <div data-testid="add-project-menu" /> }));

/** 按钮顺序固定：[0] Add Project（aria-haspopup），[1] Settings。 */
function getSettingsButton(): HTMLButtonElement {
  return screen.getAllByRole('button')[1];
}

function renderFooter() {
  return render(
    <ToolbarFooter
      onAddProject={vi.fn()}
      onCloneProject={vi.fn()}
      onAddWsl={vi.fn()}
      onAddRemote={vi.fn()}
      onOpenSettings={vi.fn()}
    />,
  );
}

describe('ToolbarFooter', () => {
  beforeEach(() => {
    useAppViewStore.setState({ appView: 'normal' });
  });

  it('appView=normal 时 Settings 按钮无激活高亮', () => {
    renderFooter();
    // toHaveClass 按 class token 精确匹配，不会被 hover:bg-bg-hover 子串误伤
    expect(screen.getByTestId('settings-icon')).not.toHaveClass('bg-bg-hover');
  });

  it('appView=settings 时 Settings 按钮高亮（组件内部自订阅 appViewStore，无需外部传参）', () => {
    renderFooter();
    act(() => {
      useAppViewStore.setState({ appView: 'settings' });
    });
    expect(screen.getByTestId('settings-icon')).toHaveClass('bg-bg-hover');
  });

  it('点击 Settings 按钮 → onOpenSettings 回调', () => {
    const onOpenSettings = vi.fn();
    render(
      <ToolbarFooter
        onAddProject={vi.fn()}
        onCloneProject={vi.fn()}
        onAddWsl={vi.fn()}
        onAddRemote={vi.fn()}
        onOpenSettings={onOpenSettings}
      />,
    );
    fireEvent.click(getSettingsButton());
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
