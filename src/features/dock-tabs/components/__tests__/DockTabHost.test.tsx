import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 槽位 tab 宿主（P1）的渲染契约。
 *
 * 判据选在「用户能看到什么」上：有停靠 tab 就渲染出 tab 条；没有 tab / 没有 workspace
 * 就**渲染为空**（宿主是内容的投影 —— 空宿主既不占位，也不用文案解释自己为什么空）；
 * `chrome="dock"` 下**不出现**分屏控件与 Action Menu 入口（R8：停靠区不是中心编辑器，
 * 露出那些入口会误导向无效操作）。
 *
 * 对照组（`paneId="left"` + 默认 chrome）证明这些断言有判别力 —— 同样的 tab 在中心
 * 编辑器里确实会渲染分屏控件。
 */

vi.mock('@/features/terminal', () => ({
  closeEditorTab: vi.fn(),
  closeAllEditorTabs: vi.fn(),
}));

const mockCheckAgentsInstalled = vi.fn();
vi.mock('@/features/agent/api/agentApi', () => ({
  checkAgentsInstalled: (...args: unknown[]) => mockCheckAgentsInstalled(...args),
}));

// PaneContent 隔离：本测试断言的是 tab 条与工具栏变体，不测各 kind 的编辑器内容
vi.mock('@/features/editor/components/PaneContent', () => ({ default: () => null }));

vi.mock('@dnd-kit/core', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
}));

import DockTabHost from '@/features/dock-tabs/components/DockTabHost';
import { EditorGroupPane, FileActionsProvider } from '@/features/editor';
import type { EditorContextValue } from '@/shared/contexts';
import { AppProvider, EditorProvider } from '@/shared/contexts';
import { tabHostView } from '@/shared/dock';
import { createDefaultDockState, useDockStore } from '@/shared/store/dockStore';
import { useEditorStore } from '@/shared/store/editorStore';
import type { AgentConfig, Tab } from '@/shared/types';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

const SPACE = WorkspaceSession.of('p1', null).key;

const AGENTS: AgentConfig[] = [];

const appValue = {
  config: {} as never,
  customThemes: [],
  agents: AGENTS,
  agentInstalledMap: {},
  loading: false,
  ideCommandOverrides: {},
  showToast: vi.fn(),
  saveConfig: async () => {},
};

const editorValue: EditorContextValue = {
  tabs: [],
  onActivateTab: vi.fn(),
  onCloseTab: vi.fn(),
  onAddTab: vi.fn(),
  agents: AGENTS,
  compactMode: false,
  showAgentBar: false,
  hiddenAgentIds: [],
  onToggleHiddenAgent: vi.fn(),
  onAgentClick: vi.fn(),
};

const fileActionsValue = {
  onFileSelect: vi.fn().mockResolvedValue(true),
  onFileRefresh: vi.fn(),
  onFileCloseTab: vi.fn(),
  onFileActivateTab: vi.fn(),
  onFileSave: vi.fn().mockResolvedValue(true),
  onFileSaveTab: vi.fn().mockResolvedValue(true),
  onFileContentChange: vi.fn(),
  onLoadFileTree: vi.fn(),
  onExpandDir: vi.fn().mockResolvedValue(undefined),
};

function wrap(children: React.ReactNode) {
  return (
    <AppProvider value={appValue}>
      <EditorProvider value={editorValue}>
        <FileActionsProvider value={fileActionsValue}>{children}</FileActionsProvider>
      </EditorProvider>
    </AppProvider>
  );
}

/** 终端 tab：中心 chrome 会渲染分屏控件（Agent Bar 行），dock chrome 必须隐藏它们。 */
const TERMINAL_TAB: Tab = {
  id: 'tab-term',
  scope: { kind: 'workspace', session: WorkspaceSession.of('p1', null) },
  title: 'zsh',
  data: { kind: 'terminal', agentId: null },
};

function seedDockedRightTab(): void {
  useEditorStore.setState({ tabs: {}, editorLayout: {} });
  useEditorStore.getState().addTab(TERMINAL_TAB);
  useEditorStore.getState().dockTab(SPACE, TERMINAL_TAB.id, 'right');
}

describe('DockTabHost — 空宿主不占位（可见性从内容派生）', () => {
  beforeEach(() => {
    mockCheckAgentsInstalled.mockResolvedValue({});
    useEditorStore.setState({ tabs: {}, editorLayout: {} });
  });

  it('有停靠 tab → 渲染 tab 条（复用中心 EditorGroupPane 管线）', () => {
    seedDockedRightTab();
    render(wrap(<DockTabHost slot="right" tabKey={SPACE} buildLayoutId={() => 'l1'} />));

    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByText('zsh')).toBeInTheDocument();
  });

  it('槽内没有停靠 tab → 渲染为空（不解释为什么是空的）', () => {
    const { container } = render(
      wrap(<DockTabHost slot="right" tabKey={SPACE} buildLayoutId={() => 'l1'} />),
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('无 tabKey（没有激活 workspace）→ 渲染为空', () => {
    const { container } = render(
      wrap(<DockTabHost slot="right" tabKey={null} buildLayoutId={() => 'l1'} />),
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('左/右宿主只投影自己那一组（另一槽为空 → 空渲染）', () => {
    seedDockedRightTab();
    const { container } = render(
      wrap(<DockTabHost slot="left" tabKey={SPACE} buildLayoutId={() => 'l1'} />),
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe('DockTabHost — 关光最后一条 ≠ 写布局 intent（P5 退役了 N→0 收起）', () => {
  beforeEach(() => {
    mockCheckAgentsInstalled.mockResolvedValue({});
    useEditorStore.setState({ tabs: {}, editorLayout: {} });
    useDockStore.setState(createDefaultDockState());
    // 宿主要可见才谈得上「关光」：这等价于用户点图标 / 拖 tab 把宿主展开
    useDockStore.getState().activateView(tabHostView('right'));
  });

  it('关光最后一条：expanded / activeView 一字不动（空宿主是否占位由派生判据回答）', () => {
    seedDockedRightTab();
    render(wrap(<DockTabHost slot="right" tabKey={SPACE} buildLayoutId={() => 'l1'} />));

    act(() => {
      useEditorStore.getState().closeTab(SPACE, TERMINAL_TAB.id);
    });

    // 旧行为：这里会被改成 expanded=false（写 intent 掩盖「容器比内容活得久」）。
    // 现在容器可见性从内容派生，所以关闭动作不需要也不能替布局做决定。
    expect(useDockStore.getState().zones.right).toEqual({
      expanded: true,
      activeView: tabHostView('right'),
    });
  });

  it('本来就空：不写 intent（首次展开的引导态不存在了 —— 空宿主不占位）', () => {
    const { container } = render(
      wrap(<DockTabHost slot="right" tabKey={SPACE} buildLayoutId={() => 'l1'} />),
    );

    expect(container).toBeEmptyDOMElement();
    expect(useDockStore.getState().zones.right.expanded).toBe(true);
  });
});

describe('DockTabHost — chrome="dock" 不露出中心编辑器入口（R8）', () => {
  beforeEach(() => {
    mockCheckAgentsInstalled.mockResolvedValue({});
    seedDockedRightTab();
  });

  it('dock 宿主：无分屏控件、无 Action Menu（+）入口', () => {
    render(wrap(<DockTabHost slot="right" tabKey={SPACE} buildLayoutId={() => 'l1'} />));

    expect(screen.queryByTitle('Split Horizontal')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Split Vertical')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('New action')).not.toBeInTheDocument();
  });

  it('对照组：同一 tab 在中心 pane（full chrome）确实渲染这些控件', () => {
    // 同一条终端 tab 放回中心（不是 docked）：证明断言面有判别力
    useEditorStore.setState({ tabs: {}, editorLayout: {} });
    useEditorStore.getState().addTab(TERMINAL_TAB);

    render(
      wrap(
        <EditorGroupPane
          paneId="left"
          tabKey={SPACE}
          onFocusGroup={vi.fn()}
          layoutId="l1"
          onAddTerminalTab={vi.fn()}
        />,
      ),
    );

    expect(screen.getByTitle('Split Horizontal')).toBeInTheDocument();
    expect(screen.getByLabelText('New action')).toBeInTheDocument();
  });
});
