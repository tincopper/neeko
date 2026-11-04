import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { openAgentChatTab } from '@/features/agent-chat/api/openChatTab';
import { appViewKey, tabHostView, tabKindView } from '@/shared/dock';
import { useAppViewStore } from '@/shared/store/appViewStore';
import { createDefaultDockState, useDockStore } from '@/shared/store/dockStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { useNotificationStore } from '@/shared/store/notificationStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { AgentConfig, Project, Tab } from '@/shared/types';
import { WorkspaceSession, type WorkspaceSession as Workspace } from '@/shared/utils/workspaceRef';

import { useDockBarOpenTab, type DockBarOpenTabDeps } from '../useDockBarOpenTab';

/**
 * 种类级入口（`tabKind:*`）的点击落地。
 *
 * 这些用例守三件事：
 * 1. 「已有该 kind → 激活，不新建」—— 否则每点一次就多一条 chat / terminal（需求变成噪音源）；
 * 2. 「落地槽 = 图标当前所在槽」—— 图标换栏后新 tab 必须跟过去，不能落回 meta 的默认槽；
 * 3. 「无项目 / 拿不到 agent → 提示」—— 静默 no-op 是这条需求明确不接受的行为。
 */

// 真实实现建 tab（store 行为要真），只包一层计数：`not.toHaveBeenCalled` 是需求本身。
vi.mock('@/features/agent-chat/api/openChatTab', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/agent-chat/api/openChatTab')>();
  return { ...actual, openAgentChatTab: vi.fn(actual.openAgentChatTab) };
});

// 安装态检查是 IPC：默认「还没查过」= 放行（与真实 hook 的 fail-open 语义一致）。
vi.mock('@/features/agent/api/agentApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/agent/api/agentApi')>();
  return { ...actual, checkAgentsInstalled: vi.fn(() => Promise.resolve({})) };
});

const AGENT = { id: 'a1', name: 'Agent One', command: 'agent-one', enabled: true } as AgentConfig;
const CHAT_VIEW = tabKindView('agent-chat');
const TERMINAL_VIEW = tabKindView('terminal');

const notifications = () => useNotificationStore.getState().notifications;

function sessionOf(projectId: string): Workspace {
  return WorkspaceSession.of(projectId, null);
}

function spaceOf(projectId: string): string {
  return sessionOf(projectId).key;
}

/** 有激活项目（含 selected_agents）的最小 store 状态。 */
function seedProject(projectId: string, selectedAgents: string[] = []): void {
  useProjectStore.setState({
    activeProjectId: projectId,
    activeProject: { id: projectId, selected_agents: selectedAgents } as unknown as Project,
  });
}

function tabCount(projectId: string): number {
  return useEditorStore.getState().tabs[spaceOf(projectId)]?.tabs.length ?? 0;
}

let terminalSeq = 0;

/** 造一条 `terminal` tab（agent 终端的既有创建路径也产出它）。 */
function addTerminalTab(projectId: string, agentId: string | null): string {
  terminalSeq += 1;
  const tab: Tab = {
    id: `term-${terminalSeq}`,
    scope: { kind: 'workspace', session: sessionOf(projectId) },
    title: agentId ?? 'Terminal',
    data: { kind: 'terminal', agentId },
  };
  useEditorStore.getState().addTab(tab);
  return tab.id;
}

function renderOpenTab(overrides: Partial<DockBarOpenTabDeps> = {}) {
  // 注入的 agent 端口 = `EditorContext.onAgentClick`（真实实现建终端 tab）：fake 也要真的建，
  // 否则「新建后落到宿主」这条路径在测试里根本走不到。
  const onAgentClick = vi.fn((agent: AgentConfig) => {
    const projectId = useProjectStore.getState().activeProjectId;
    if (projectId) addTerminalTab(projectId, agent.id);
  });
  const { result } = renderHook(() =>
    useDockBarOpenTab({ agents: [AGENT], onAgentClick, ...overrides }),
  );
  return { open: result.current, onAgentClick };
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(openAgentChatTab).mockClear();
  useNotificationStore.setState({ notifications: [], unreadCount: 0 });
  useAppViewStore.setState({ appView: 'normal' });
  useDockStore.setState({ ...createDefaultDockState(), leftZoneExpandedBeforeLibrary: null });
  useEditorStore.setState({ tabs: {}, editorLayout: {} });
  useWorkspaceStore.setState({ byProject: {} });
  useProjectStore.setState({ activeProjectId: null, activeProject: null });
});

describe('useDockBarOpenTab — 当前空间已有该 kind 的 tab', () => {
  it('激活既有 tab：不新建、tab 数量不变、不调 openAgentChatTab', () => {
    seedProject('p-existing');
    const space = spaceOf('p-existing');
    const chatId = openAgentChatTab(sessionOf('p-existing'));
    vi.mocked(openAgentChatTab).mockClear();
    // 切到别的 tab，验证「点图标把它叫回来」
    addTerminalTab('p-existing', null);
    const countBefore = tabCount('p-existing');

    const { open } = renderOpenTab();
    act(() => {
      open(CHAT_VIEW, 'right');
    });

    expect(openAgentChatTab).not.toHaveBeenCalled();
    expect(tabCount('p-existing')).toBe(countBefore);
    const layout = useEditorStore.getState().editorLayout[space]!;
    expect(layout.groups[layout.activeGroupId].activeTabId).toBe(chatId);
    expect(notifications()).toHaveLength(0);
  });

  it('既有 tab 停在右侧宿主里 → 同时展开宿主（否则激活了也看不见）', () => {
    seedProject('p-docked');
    const space = spaceOf('p-docked');
    const chatId = openAgentChatTab(sessionOf('p-docked'));
    useEditorStore.getState().dockTab(space, chatId, 'right');
    useDockStore.getState().setSlotExpanded('right', false);
    vi.mocked(openAgentChatTab).mockClear();

    const { open } = renderOpenTab();
    act(() => {
      open(CHAT_VIEW, 'right');
    });

    expect(useDockStore.getState().zones.right).toEqual({
      expanded: true,
      activeView: tabHostView('right'),
    });
    expect(useEditorStore.getState().editorLayout[space]!.docked.right.activeTabId).toBe(chatId);
    expect(openAgentChatTab).not.toHaveBeenCalled();
  });

  it('再点一次：宿主可见且前台就是它 → **收起宿主**（会话保留，不是关 tab）', () => {
    seedProject('p-toggle');
    const space = spaceOf('p-toggle');
    const chatId = openAgentChatTab(sessionOf('p-toggle'));
    useEditorStore.getState().dockTab(space, chatId, 'right');
    useDockStore.getState().activateView(tabHostView('right'));
    vi.mocked(openAgentChatTab).mockClear();

    const { open } = renderOpenTab();
    act(() => {
      open(CHAT_VIEW, 'right');
    });

    expect(useDockStore.getState().zones.right.expanded).toBe(false);
    // tab 本身必须还在（收的是宿主，不是会话）
    expect(tabCount('p-toggle')).toBe(1);
    expect(useEditorStore.getState().editorLayout[space]!.docked.right.tabIds).toEqual([chatId]);
    expect(openAgentChatTab).not.toHaveBeenCalled();
  });

  it('收起后再点：重新展开同一条 tab（不新建）', () => {
    seedProject('p-toggle2');
    const space = spaceOf('p-toggle2');
    const chatId = openAgentChatTab(sessionOf('p-toggle2'));
    useEditorStore.getState().dockTab(space, chatId, 'right');
    useDockStore.getState().activateView(tabHostView('right'));
    const { open } = renderOpenTab();
    act(() => {
      open(CHAT_VIEW, 'right'); // 收起
    });
    vi.mocked(openAgentChatTab).mockClear();

    act(() => {
      open(CHAT_VIEW, 'right'); // 再开
    });

    expect(useDockStore.getState().zones.right).toEqual({
      expanded: true,
      activeView: tabHostView('right'),
    });
    expect(tabCount('p-toggle2')).toBe(1);
    expect(openAgentChatTab).not.toHaveBeenCalled();
  });

  it('中心区被 Library 占着 → 先退出中心视图（激活的 tab 才不会藏在 Library 后面）', () => {
    seedProject('p-library');
    openAgentChatTab(sessionOf('p-library'));
    useDockStore.getState().toggleView(appViewKey('library'));
    expect(useAppViewStore.getState().appView).toBe('library');

    const { open } = renderOpenTab();
    act(() => {
      open(CHAT_VIEW, 'right');
    });

    expect(useAppViewStore.getState().appView).toBe('normal');
    expect(notifications()).toHaveLength(0);
  });
});

describe('useDockBarOpenTab — 当前空间没有该 kind 的 tab', () => {
  it('新建 agent-chat，并停靠到**图标当前所在槽**（图标移到左栏 → 落 docked.left）', () => {
    seedProject('p-new-left');
    const space = spaceOf('p-new-left');
    // 图标此时在左栏（用户拖过去的）：落点是布局事实，不是 meta.defaultSlot
    expect(useDockStore.getState().moveView(CHAT_VIEW, 'left')).toBe(true);

    const { open } = renderOpenTab();
    act(() => {
      open(CHAT_VIEW, 'left');
    });

    expect(openAgentChatTab).toHaveBeenCalledTimes(1);
    const layout = useEditorStore.getState().editorLayout[space]!;
    expect(layout.docked.left.tabIds).toHaveLength(1);
    expect(layout.groups.left.tabIds).toHaveLength(0);
    expect(layout.groups.right.tabIds).toHaveLength(0);
    // 宿主图标被钉住并展开：用户始终有回程入口
    const dock = useDockStore.getState();
    expect(dock.placements[tabHostView('left')].onBar).toBe(true);
    expect(dock.zones.left).toEqual({ expanded: true, activeView: tabHostView('left') });
    expect(notifications()).toHaveLength(0);
  });

  it('图标停在右栏（缺省）→ 落在 docked.right，而不是中心区', () => {
    seedProject('p-new-right');
    const space = spaceOf('p-new-right');

    const { open } = renderOpenTab();
    act(() => {
      open(CHAT_VIEW, 'right');
    });

    const layout = useEditorStore.getState().editorLayout[space]!;
    expect(layout.docked.right.tabIds).toHaveLength(1);
    expect(layout.groups.left.tabIds).toHaveLength(0);
  });
});

describe('useDockBarOpenTab — 无项目 / 无 tab 空间', () => {
  it('没有激活项目 → 提示，不抛、不建 tab', () => {
    const { open } = renderOpenTab();

    act(() => {
      open(CHAT_VIEW, 'right');
    });

    expect(openAgentChatTab).not.toHaveBeenCalled();
    expect(notifications().map((n) => n.message)).toEqual(['Open a project first']);
    expect(useEditorStore.getState().tabs).toEqual({});
  });
});

describe('useDockBarOpenTab — agent 终端（复用既有 agent 打开路径）', () => {
  it('没有该 kind 的 tab → 调注入的 onAgentClick，新 tab 落到图标所在槽', () => {
    seedProject('p-agent', ['a1']);
    const space = spaceOf('p-agent');

    const { open, onAgentClick } = renderOpenTab();
    act(() => {
      open(TERMINAL_VIEW, 'right');
    });

    expect(onAgentClick).toHaveBeenCalledWith(AGENT);
    const layout = useEditorStore.getState().editorLayout[space]!;
    expect(layout.docked.right.tabIds).toHaveLength(1);
    expect(notifications()).toHaveLength(0);
  });

  it('已有终端 tab → 只激活，不再调 onAgentClick（点两次不会开出第二条）', () => {
    seedProject('p-agent-existing', ['a1']);
    const space = spaceOf('p-agent-existing');
    const terminalId = addTerminalTab('p-agent-existing', 'a1');

    const { open, onAgentClick } = renderOpenTab();
    act(() => {
      open(TERMINAL_VIEW, 'right');
    });

    expect(onAgentClick).not.toHaveBeenCalled();
    const layout = useEditorStore.getState().editorLayout[space]!;
    expect(layout.groups[layout.activeGroupId].activeTabId).toBe(terminalId);
  });

  it('项目没选 agent → 提示，且不走创建路径（不调 onAgentClick、不开 tab）', () => {
    seedProject('p-agent-none', []);

    const { open, onAgentClick } = renderOpenTab();
    act(() => {
      open(TERMINAL_VIEW, 'right');
    });

    expect(onAgentClick).not.toHaveBeenCalled();
    expect(tabCount('p-agent-none')).toBe(0);
    expect(notifications().map((n) => n.message)).toEqual([
      'Select an agent for this project to open an agent terminal',
    ]);
  });
});
