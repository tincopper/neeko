// EditorGroupPane 组合层：Action Menu（+ 按钮下拉）的 agents 数据源必须
// 与 AgentBar 同源 —— 复用 installedEnabledAgents（enabled && !hidden && installed）。
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/terminal', () => ({
  closeEditorTab: vi.fn(),
  closeAllEditorTabs: vi.fn(),
}));

const mockCheckAgentsInstalled = vi.fn();
vi.mock('@/features/agent/api/agentApi', () => ({
  checkAgentsInstalled: (...args: unknown[]) => mockCheckAgentsInstalled(...args),
}));

// 捕获 PaneTabBar 收到的 props（actionMenuCtx 是断言面）；PaneContent 隔离重渲染噪音。
const captured = vi.hoisted(() => ({
  paneTabBarProps: [] as Array<Record<string, unknown>>,
}));
vi.mock('../PaneTabBar', () => ({
  default: (props: Record<string, unknown>) => {
    captured.paneTabBarProps.push(props);
    return <div data-testid="pane-tab-bar" />;
  },
}));
vi.mock('../PaneContent', () => ({ default: () => null }));

vi.mock('@dnd-kit/core', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
}));

import { FileActionsProvider } from '@/features/editor/FileActionsContext';
import type { EditorContextValue } from '@/shared/contexts';
import { AppProvider, EditorProvider } from '@/shared/contexts';
import { useEditorStore } from '@/shared/store/editorStore';
import type { AgentConfig } from '@/shared/types';

import EditorGroupPane from '../EditorGroupPane';

const AGENTS: AgentConfig[] = [
  { id: 'opencode', name: 'OpenCode', enabled: true, command: 'opencode' },
  { id: 'claude', name: 'Claude Code', enabled: true, command: 'claude' },
];

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
  activeTabId: null,
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

function renderPane(editorCtx: Partial<EditorContextValue> = {}) {
  return render(
    <AppProvider value={appValue}>
      <EditorProvider value={{ ...editorValue, ...editorCtx }}>
        <FileActionsProvider value={fileActionsValue}>
          <EditorGroupPane groupId="left" tabKey="p1" onFocusGroup={vi.fn()} layoutId="l1" />
        </FileActionsProvider>
      </EditorProvider>
    </AppProvider>,
  );
}

/** 播种一个 file tab，令 PaneTabBar（tabs.length > 0）渲染。 */
function seedFileTab() {
  useEditorStore.setState({ tabs: {}, editorLayout: {}, activeTabId: null });
  useEditorStore.getState().addTab('p1', {
    id: 'tab1',
    projectId: 'p1',
    title: 'a.ts',
    order: 0,
    data: {
      kind: 'file',
      filePath: 'a.ts',
      fileName: 'a.ts',
      content: { path: 'a.ts', content: '', size: 0, is_binary: false },
      isDirty: false,
    },
  });
}

function latestActionMenuAgents(): AgentConfig[] {
  const props = captured.paneTabBarProps.at(-1);
  const ctx = props?.actionMenuCtx as { agents: AgentConfig[] } | undefined;
  expect(ctx).toBeDefined();
  return ctx!.agents;
}

describe('EditorGroupPane — Action Menu agents 过滤', () => {
  beforeEach(() => {
    captured.paneTabBarProps.length = 0;
    vi.clearAllMocks();
    seedFileTab();
  });

  it('安装检测返回后，actionMenuCtx.agents 只保留已安装 agent', async () => {
    mockCheckAgentsInstalled.mockResolvedValue({ opencode: true, claude: false });

    renderPane();

    await waitFor(() => {
      expect(mockCheckAgentsInstalled).toHaveBeenCalledWith(['opencode', 'claude'], 'p1');
    });
    await waitFor(() => {
      expect(latestActionMenuAgents().map((a) => a.id)).toEqual(['opencode']);
    });
  });

  it('hiddenAgentIds 中的 agent 不进入 actionMenuCtx.agents', async () => {
    mockCheckAgentsInstalled.mockResolvedValue({ opencode: true, claude: true });

    renderPane({ hiddenAgentIds: ['claude'] });

    await waitFor(() => {
      expect(latestActionMenuAgents().map((a) => a.id)).toEqual(['opencode']);
    });
  });

  it('安装检测未返回前宽松放行（菜单不闪空）', async () => {
    let resolveCheck: (v: Record<string, boolean>) => void = () => {};
    mockCheckAgentsInstalled.mockImplementation(
      () =>
        new Promise<Record<string, boolean>>((resolve) => {
          resolveCheck = resolve;
        }),
    );

    renderPane();

    await waitFor(() => {
      expect(latestActionMenuAgents().map((a) => a.id)).toEqual(['opencode', 'claude']);
    });

    resolveCheck({ opencode: true, claude: false });
    await waitFor(() => {
      expect(latestActionMenuAgents().map((a) => a.id)).toEqual(['opencode']);
    });
  });
});
