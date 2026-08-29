import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

// mock 全部骨架子件：AppShell 只做组合，本测试断言「装配与透传」而非子件行为。
// DockLayout mock 透传 slot 内容，验证 toolbarFooterLeft / buttons / children 注入路径。
// ToolbarFooter 的 settings 高亮行为（自订阅 appViewStore）在 ToolbarFooter.test 覆盖。
vi.mock('@/layout', () => ({
  TitleBar: ({ actions }: { actions?: ReactNode }) => <div data-testid="titlebar">{actions}</div>,
  DockLayout: ({
    children,
    toolbarFooterLeft,
    leftButtons,
    rightButtons,
  }: {
    children?: ReactNode;
    toolbarFooterLeft?: ReactNode;
    leftButtons?: ReactNode[];
    rightButtons?: ReactNode[];
  }) => (
    <div data-testid="dock-layout">
      <div data-testid="dock-toolbar-footer">{toolbarFooterLeft}</div>
      <div data-testid="dock-left-buttons">{leftButtons}</div>
      <div data-testid="dock-right-buttons">{rightButtons}</div>
      {children}
    </div>
  ),
}));
vi.mock('@/features/status-bar', () => ({ StatusBar: () => <div data-testid="status-bar" /> }));
vi.mock('@/features/quick-open', () => ({
  QuickOpenPalette: () => <div data-testid="quick-open" />,
}));
vi.mock('@/features/symbol-nav', () => ({
  SymbolNavPalette: () => <div data-testid="symbol-nav" />,
}));
vi.mock('../../AppModals', () => ({ default: () => <div data-testid="app-modals" /> }));
vi.mock('../../components/AppCenter', () => ({ default: () => <div data-testid="app-center" /> }));
vi.mock('../../components/ToolbarFooter', () => ({
  default: () => <div data-testid="toolbar-footer" />,
}));
vi.mock('../../panels/TitleBarActions', () => ({
  default: () => <div data-testid="titlebar-actions" />,
}));
vi.mock('../../panels/PanelHost', () => ({
  default: () => <div data-testid="panel-host-bottom" />,
}));

import AppShell from '../AppShell';

function makeButton(tag: string): ReactNode {
  return <span data-testid={tag} />;
}

function renderShell() {
  return render(
    <AppShell
      toolbarProps={{
        onAddProject: vi.fn(),
        onAddWsl: vi.fn(),
        onAddRemote: vi.fn(),
        onOpenSettings: vi.fn(),
      }}
      appModalsProps={{} as never}
      leftButtons={[makeButton('left-btn')]}
      rightButtons={[makeButton('right-btn')]}
    />,
  );
}

describe('AppShell 骨架装配', () => {
  it('渲染完整骨架：TitleBar(actions) + DockLayout(ToolbarFooter slot) + PanelHost(bottom) + 浮层 + StatusBar', () => {
    renderShell();
    expect(screen.getByTestId('titlebar-actions')).toBeInTheDocument();
    expect(screen.getByTestId('toolbar-footer')).toBeInTheDocument();
    expect(screen.getByTestId('app-center')).toBeInTheDocument();
    expect(screen.getByTestId('panel-host-bottom')).toBeInTheDocument();
    expect(screen.getByTestId('app-modals')).toBeInTheDocument();
    expect(screen.getByTestId('quick-open')).toBeInTheDocument();
    expect(screen.getByTestId('symbol-nav')).toBeInTheDocument();
    expect(screen.getByTestId('status-bar')).toBeInTheDocument();
  });

  it('dock 按钮 slot 透传 DockLayout（左/右）', () => {
    renderShell();
    expect(screen.getByTestId('left-btn')).toBeInTheDocument();
    expect(screen.getByTestId('right-btn')).toBeInTheDocument();
  });

  it('固定面板宿主渲染在 DockLayout 之外（骨架内兄弟槽位，非布局子节点）', () => {
    renderShell();
    const layout = screen.getByTestId('dock-layout');
    expect(layout.contains(screen.getByTestId('panel-host-bottom'))).toBe(false);
  });
});
