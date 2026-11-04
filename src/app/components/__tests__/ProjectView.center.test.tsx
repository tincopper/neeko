import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { Tab } from '@/shared/types';
import { createDefaultEditorLayout } from '@/shared/types/editorGroup';
import { WorkspaceSession, type ProjectId } from '@/shared/utils/workspaceRef';
import { createProject } from '@/testing/factories';

/**
 * 中心区形态回归（P4）：**「注册表里有 tab」不等于「中心画面有东西可渲染」**。
 *
 * 用户实测缺陷：点右栏 Terminal 图标 → 新 tab 按 `docksNewTabs` 落 `layout.docked.right`，
 * 中心组的 `groups.left/right` 与 `pinnedTabIds` 全空 —— 而中心区判据是 `tabs[tabKey].tabs.length > 0`，
 * 于是渲染一个空 `EditorGroupLayout`（视觉空白岛），把引导页挤掉。
 *
 * 本文件只断言「选中哪个形态」：两个候选视图都换成带 `data-testid` 的桩，重依赖按需 mock，
 * 因此失败信息直接指向判据（而不是某个面板内部的渲染细节）。
 */

// ── 形态判据的两个候选：只做标记，不渲染任何业务 ────────────────────────────
vi.mock('@/features/project', () => ({
  ProjectGuidePage: () => <div data-testid="project-guide" />,
}));
vi.mock('@/features/editor', () => ({
  EditorGroupLayout: () => <div data-testid="editor-layout" />,
}));

// ── ProjectView 的重依赖（本用例不测它们的内部行为） ────────────────────────
vi.mock('@/features/action-menu', () => ({
  ActionPalette: () => null,
  SaveFileDialog: () => null,
}));
vi.mock('@/features/file', () => ({ useFileDrop: () => {} }));
vi.mock('@/features/terminal', () => ({ insertToSessionTerminal: vi.fn() }));
vi.mock('@/features/agent-chat/api/insertToSessionAgent', () => ({
  insertToSessionAgent: () => ({ ok: false }),
}));
vi.mock('@/features/agent-chat/api/openChatTab', () => ({ openAgentChatTab: vi.fn() }));
vi.mock('@/features/agent/api/agentApi', () => ({
  setProjectAgents: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/features/library/store/libraryNavigation', () => ({ openLibraryAt: vi.fn() }));
vi.mock('@/features/quick-open/store/quickOpenStore', () => ({
  useQuickOpenStore: { getState: () => ({ openPalette: vi.fn() }) },
}));
vi.mock('@/features/quick-open/store/recentFilesStore', () => ({
  useRecentFilesStore: { getState: () => ({ list: () => [] }) },
}));
vi.mock('@/shared/utils/createUntitledFileTab', () => ({ createUntitledFileTab: vi.fn() }));

// ── 组合根注入的端口与 Context（ProjectView 只是消费者） ────────────────────
vi.mock('@/app/hooks/useMoveTabToSlot', () => ({
  useMoveTabToSlot: () => ({ move: vi.fn(), canDock: () => false }),
}));
vi.mock('@/app/hooks/useProjectAgents', () => ({
  useProjectAgents: () => ({ installedMap: new Map(), handleAgentClick: () => false }),
}));
vi.mock('@/app/hooks/useRemoteProjectSession', () => ({
  useRemoteProjectSession: () => ({
    needsRemoteAuth: false,
    remoteProjectProp: null,
    onRemoteSessionReady: vi.fn(),
    handleEnterCredentials: vi.fn(),
  }),
}));
vi.mock('@/features/connection', () => ({
  useRemoteContext: () => ({
    remoteAuthStore: new Map(),
    activeRemoteCheckoutPath: null,
    setRemoteOpenSessions: vi.fn(),
    setPendingAuthEntry: vi.fn(),
  }),
}));
vi.mock('@/features/project/ProjectContext', () => ({
  useProjectActionsContext: () => ({
    onRemoveProject: vi.fn(),
    onSelectProject: vi.fn(),
    onAddProject: vi.fn(),
    onSelectFile: vi.fn(),
    onRefreshGit: vi.fn(),
    onBackToMainTerminal: vi.fn(),
  }),
}));
vi.mock('@/shared/contexts', () => ({
  useAppContext: () => ({ showToast: vi.fn() }),
  useEditorContext: () => ({ agents: [], onAgentClick: vi.fn() }),
  useTerminalInsert: () => ({ api: {}, register: () => () => {} }),
}));

import ProjectView from '../ProjectView';

const PROJECT_ID = 'p4-project' as ProjectId;
/** tab 空间键 = 当前单元身份（主仓）：唯一 mint 点是 `WorkspaceSession#key`，测试也不手拼。 */
const TAB_KEY = WorkspaceSession.of(PROJECT_ID, null).key;

function mkTerminalTab(id: string): Tab {
  return {
    id,
    scope: { kind: 'workspace', session: WorkspaceSession.of(PROJECT_ID, null) },
    title: id,
    data: { kind: 'terminal', agentId: null },
  };
}

/**
 * 直接种 store：`tabs` 是注册表（含停靠的 tab），`editorLayout` 才是归属。
 * layout 由 `createDefaultEditorLayout()` 派生，只改本用例关心的两个组。
 */
function seedTabs(args: { center?: string[]; dockedRight?: string[] }): void {
  const centerIds = args.center ?? [];
  const dockedRightIds = args.dockedRight ?? [];
  const layout = createDefaultEditorLayout();
  layout.groups.left = { tabIds: centerIds, activeTabId: centerIds[0] ?? null };
  layout.docked.right = { tabIds: dockedRightIds, activeTabId: dockedRightIds[0] ?? null };
  const tabs = [...centerIds, ...dockedRightIds].map(mkTerminalTab);
  useEditorStore.setState({
    tabs: { [TAB_KEY]: { tabs } },
    editorLayout: { [TAB_KEY]: layout },
  });
}

beforeEach(() => {
  // DOM 清理由 `src/testing/setup.ts` 的 `afterEach(cleanup)` 负责，这里只需重置 store
  // （store 是模块级单例，不随 RTL cleanup 复位）。
  useEditorStore.setState({ tabs: {}, editorLayout: {} });
  useWorkspaceStore.setState({ byProject: {} });
  useProjectStore.setState({
    activeProjectId: PROJECT_ID,
    activeProject: createProject({ id: PROJECT_ID }),
  });
});

describe('ProjectView — 中心区形态只由 editorLayout 的组决定', () => {
  it('tab 全部停靠在 right 槽（中心组为空）⇒ 渲染引导页，不渲染编辑器布局', () => {
    // 用户实测路径：点右栏 Terminal 图标 → tab 落 docked.right，groups 全空
    seedTabs({ dockedRight: ['tab-terminal-docked'] });

    render(<ProjectView />);

    expect(screen.getByTestId('project-guide')).toBeInTheDocument();
    expect(screen.queryByTestId('editor-layout')).not.toBeInTheDocument();
  });

  it('中心组有 tab ⇒ 渲染编辑器布局（判据的反方向：停靠不是「永远隐藏中心」）', () => {
    seedTabs({ center: ['tab-terminal-center'] });

    render(<ProjectView />);

    expect(screen.getByTestId('editor-layout')).toBeInTheDocument();
    expect(screen.queryByTestId('project-guide')).not.toBeInTheDocument();
  });

  it('中心与停靠同时有 tab ⇒ 仍是编辑器布局（停靠不影响中心区形态）', () => {
    seedTabs({ center: ['tab-terminal-center'], dockedRight: ['tab-terminal-docked'] });

    render(<ProjectView />);

    expect(screen.getByTestId('editor-layout')).toBeInTheDocument();
    expect(screen.queryByTestId('project-guide')).not.toBeInTheDocument();
  });
});
