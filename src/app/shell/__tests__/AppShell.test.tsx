import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// mock 全部骨架子件：AppShell 只做组合，本测试断言「装配与透传」而非子件行为。
// DockLayout mock 透传 slot 内容，验证 toolbarFooterLeft / buttons / children 注入路径。
// ToolbarFooter 的 settings 高亮行为（自订阅 appViewStore）在 ToolbarFooter.test 覆盖。
vi.mock('@/layout', () => ({
  TitleBar: ({ actions }: { actions?: ReactNode }) => <div data-testid="titlebar">{actions}</div>,
  DockLayout: ({
    children,
    toolbarFooterLeft,
    leftBarItems,
    rightBarItems,
    tabHostTabCounts,
  }: {
    children?: ReactNode;
    toolbarFooterLeft?: ReactNode;
    leftBarItems?: { view: string; node: ReactNode }[];
    rightBarItems?: { view: string; node: ReactNode }[];
    tabHostTabCounts?: { left: number; right: number };
  }) => (
    <div
      data-testid="dock-layout"
      data-left-host-tabs={String(tabHostTabCounts?.left)}
      data-right-host-tabs={String(tabHostTabCounts?.right)}
    >
      <div data-testid="dock-toolbar-footer">{toolbarFooterLeft}</div>
      <div data-testid="dock-left-buttons">{leftBarItems?.map((item) => item.node)}</div>
      <div data-testid="dock-right-buttons">{rightBarItems?.map((item) => item.node)}</div>
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
  ReferencesPeekDialog: () => <div data-testid="references-peek" />,
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

import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { Tab } from '@/shared/types';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';
import { createProject } from '@/testing/factories';

import AppShell from '../AppShell';

function makeEntry(tag: string): { view: string; node: ReactNode } {
  return { view: `panel:${tag}`, node: <span data-testid={tag} /> };
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
      leftBarItems={[makeEntry('left-btn')]}
      rightBarItems={[makeEntry('right-btn')]}
      onMoveView={vi.fn()}
    />,
  );
}

describe('AppShell 骨架装配', () => {
  // 注入端口的用例会写 store：每个用例从空状态开始（测试必须独立，不依赖执行顺序）
  afterEach(() => {
    useEditorStore.setState({ tabs: {}, editorLayout: {} });
    useWorkspaceStore.setState({ byProject: {} });
    useProjectStore.setState({ activeProjectId: null, activeProject: null });
  });
  it('渲染完整骨架：TitleBar(actions) + DockLayout(ToolbarFooter slot) + PanelHost(bottom) + 浮层 + StatusBar', () => {
    renderShell();
    expect(screen.getByTestId('titlebar-actions')).toBeInTheDocument();
    expect(screen.getByTestId('toolbar-footer')).toBeInTheDocument();
    expect(screen.getByTestId('app-center')).toBeInTheDocument();
    expect(screen.getByTestId('panel-host-bottom')).toBeInTheDocument();
    expect(screen.getByTestId('app-modals')).toBeInTheDocument();
    expect(screen.getByTestId('quick-open')).toBeInTheDocument();
    expect(screen.getByTestId('symbol-nav')).toBeInTheDocument();
    expect(screen.getByTestId('references-peek')).toBeInTheDocument();
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

  it('把「各槽宿主有几条停靠 tab」注入 DockLayout（计数：1 → 2 必须可观测）', () => {
    const session = WorkspaceSession.of('p1', null);
    useProjectStore.setState({
      activeProjectId: 'p1',
      activeProject: createProject({ id: 'p1' }),
    });
    useWorkspaceStore.setState({ byProject: {} });
    useEditorStore.setState({ tabs: {}, editorLayout: {} });
    const tab: Tab = {
      id: 't1',
      scope: { kind: 'workspace', session },
      title: 'zsh',
      data: { kind: 'terminal', agentId: null },
    };
    useEditorStore.getState().addTab(tab);
    useEditorStore.getState().dockTab(session.key, tab.id, 'right');

    renderShell();

    const layout = screen.getByTestId('dock-layout');
    expect(layout).toHaveAttribute('data-right-host-tabs', '1');
    expect(layout).toHaveAttribute('data-left-host-tabs', '0');
  });
});
