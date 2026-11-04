import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 槽位 tab 宿主（P1）的渲染契约。
 *
 * 判据选在「用户能看到什么」上：有停靠 tab 就渲染出 tab 条；没有/没有 workspace 就渲染
 * 空态文案（不是空白死区，I4）；`chrome="dock"` 下**不出现**分屏控件与 Action Menu 入口
 * （R8：停靠区不是中心编辑器，露出那些入口会误导向无效操作）。
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
import { panelView, tabHostView } from '@/shared/dock';
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

/** 往已存在的空间里再加一条停靠 tab（不重置 store，用于「已非空」类跃迁）。 */
function addDockedRightTab(tab: Tab): void {
  useEditorStore.getState().addTab(tab);
  useEditorStore.getState().dockTab(SPACE, tab.id, 'right');
}

describe('DockTabHost — 渲染与空态', () => {
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

  it('槽内没有停靠 tab → 空态文案（不是空白死区）', () => {
    render(wrap(<DockTabHost slot="right" tabKey={SPACE} buildLayoutId={() => 'l1'} />));

    expect(screen.getByText(/No docked tabs/)).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('无 tabKey（没有激活 workspace）→ 空态文案', () => {
    render(wrap(<DockTabHost slot="right" tabKey={null} buildLayoutId={() => 'l1'} />));

    expect(screen.getByText(/Open a project to dock tabs here/)).toBeInTheDocument();
  });

  it('左/右宿主只投影自己那一组（同一 tabKey 的另一槽为空）', () => {
    seedDockedRightTab();
    render(wrap(<DockTabHost slot="left" tabKey={SPACE} buildLayoutId={() => 'l1'} />));

    expect(screen.getByText(/No docked tabs/)).toBeInTheDocument();
  });
});

describe('DockTabHost — 关掉最后一条停靠 tab 时收起该槽（不留空岛）', () => {
  beforeEach(() => {
    mockCheckAgentsInstalled.mockResolvedValue({});
    useEditorStore.setState({ tabs: {}, editorLayout: {} });
    useDockStore.setState(createDefaultDockState());
    // 宿主要可见才谈得上「关掉最后一条 → 收起」：这等价于用户点图标把宿主展开
    useDockStore.getState().activateView(tabHostView('right'));
  });

  it('非空 → 空：该槽自动收起（用户看到的是「页面关掉了」，不是一座空岛）', () => {
    seedDockedRightTab();
    render(wrap(<DockTabHost slot="right" tabKey={SPACE} buildLayoutId={() => 'l1'} />));

    act(() => {
      useEditorStore.getState().closeTab(SPACE, TERMINAL_TAB.id);
    });

    expect(useDockStore.getState().zones.right.expanded).toBe(false);
  });

  it('本来就空（首次展开的引导态）→ 不被立刻收起（否则那个图标永远打不开）', () => {
    render(wrap(<DockTabHost slot="right" tabKey={SPACE} buildLayoutId={() => 'l1'} />));

    expect(screen.getByText(/No docked tabs/)).toBeInTheDocument();
    expect(useDockStore.getState().zones.right.expanded).toBe(true);
  });

  it('宿主不是该槽前台视图 → 不动布局（别的面板在用时不得被连带收起）', () => {
    useDockStore.getState().activateView(panelView('files'));
    seedDockedRightTab();
    render(wrap(<DockTabHost slot="right" tabKey={SPACE} buildLayoutId={() => 'l1'} />));

    act(() => {
      useEditorStore.getState().closeTab(SPACE, TERMINAL_TAB.id);
    });

    expect(useDockStore.getState().zones.right.expanded).toBe(true);
    expect(useDockStore.getState().zones.right.activeView).toBe(panelView('files'));
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

describe('DockTabHost — 空 → 非空时揭示宿主（新内容进宿主就该被看见）', () => {
  const SECOND_TAB: Tab = {
    ...TERMINAL_TAB,
    id: 'tab-term-2',
    title: 'bash',
  };

  beforeEach(() => {
    mockCheckAgentsInstalled.mockResolvedValue({});
    useEditorStore.setState({ tabs: {}, editorLayout: {} });
    useDockStore.setState(createDefaultDockState());
  });

  it('0 → 1 条停靠 tab：该槽被激活展开（否则新 tab 停在收起的槽里，等于点图标没反应）', () => {
    render(wrap(<DockTabHost slot="right" tabKey={SPACE} buildLayoutId={() => 'l1'} />));
    // 右槽默认收起：此时宿主渲染的是引导态
    expect(useDockStore.getState().zones.right.expanded).toBe(false);

    act(() => {
      seedDockedRightTab();
    });

    expect(useDockStore.getState().zones.right).toEqual({
      expanded: true,
      activeView: tabHostView('right'),
    });
    expect(screen.getByText('zsh')).toBeInTheDocument();
  });

  it('已非空时再加一条：不改布局（用户手动收起后不得被这条路径重新展开）', () => {
    seedDockedRightTab();
    render(wrap(<DockTabHost slot="right" tabKey={SPACE} buildLayoutId={() => 'l1'} />));
    // 用户手动收起宿主（D6：再点一次图标 = 先藏起来）
    act(() => {
      useDockStore.getState().setSlotExpanded('right', false);
    });

    act(() => {
      addDockedRightTab(SECOND_TAB);
    });

    expect(useDockStore.getState().zones.right.expanded).toBe(false);
    expect(screen.getByText('bash')).toBeInTheDocument();
  });
});
