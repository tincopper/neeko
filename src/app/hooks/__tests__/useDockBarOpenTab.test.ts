import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { openAgentChatTab } from '@/features/agent-chat/api/openChatTab';
import { appViewKey, tabHostView, tabKindView } from '@/shared/dock';
import { useAppViewStore } from '@/shared/store/appViewStore';
import { createDefaultDockState, useDockStore } from '@/shared/store/dockStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { useLiveSessionsStore } from '@/shared/store/liveSessionsStore';
import { useNotificationStore } from '@/shared/store/notificationStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { Project, Tab } from '@/shared/types';
import type { SessionView } from '@/shared/types/liveSessions';
import { MAX_TERMINAL_TABS } from '@/shared/utils/terminalTabTitle';
import { WorkspaceSession, type WorkspaceSession as Workspace } from '@/shared/utils/workspaceRef';

import { useDockBarOpenTab } from '../useDockBarOpenTab';

/**
 * 种类级入口（`tabKind:*`）的点击落地。
 *
 * 这些用例守三件事：
 * 1. 「已有该 kind → 激活，不新建」—— 否则每点一次就多一条 chat / terminal（需求变成噪音源）；
 * 2. 「落地槽 = 图标当前所在槽」—— 图标换栏后新 tab 必须跟过去，不能落回 meta 的默认槽；
 * 3. 「无项目 / 拿不到端口 → 提示」—— 静默 no-op 是这条需求明确不接受的行为。
 * 4. **Terminal 图标 = 纯 shell**（agentId === null）：选了 agent 也不拉 agent 会话。
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

// 会话恢复链（activate / bind / recreate+attach / resume）只断言「有没有被它接管」，
// 不在这里重测它内部的三级降级 —— 那是 `sessionActivationPlan` / `useActivateSession`
// 自己的用例。本文件关心的是**判据**（何时应该交给它）。
const liveSessions = vi.hoisted(() => ({ activateSession: vi.fn() }));
vi.mock('@/features/live-sessions', () => ({
  useActivateSession: () => liveSessions.activateSession,
}));

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

function renderOpenTab() {
  const { result } = renderHook(() => useDockBarOpenTab());
  return { open: result.current };
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(openAgentChatTab).mockClear();
  liveSessions.activateSession.mockReset();
  useLiveSessionsStore.setState({ version: 0, sessions: [], hydratedAt: null });
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
    // 宿主展开为前台；容器**不**上工具栏（D10：回程入口由种类图标承担）
    const dock = useDockStore.getState();
    expect(dock.placements[tabHostView('left')].onBar).toBe(false);
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

describe('useDockBarOpenTab — Terminal 图标 = 纯 shell（不默认拉起 agent）', () => {
  it('没有终端 tab → 新建一条纯 shell（agentId === null），落到图标所在槽', () => {
    seedProject('p-term', ['a1']);
    const space = spaceOf('p-term');

    const { open } = renderOpenTab();
    act(() => {
      open(TERMINAL_VIEW, 'right');
    });

    const tabs = useEditorStore.getState().tabs[space]!.tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0].data).toMatchObject({ kind: 'terminal', agentId: null });
    expect(useEditorStore.getState().editorLayout[space]!.docked.right.tabIds).toEqual([
      tabs[0].id,
    ]);
    expect(notifications()).toHaveLength(0);
  });

  it('已有纯 shell 终端 tab → 只激活，不再新建（点两次不会开出第二条）', () => {
    seedProject('p-term-existing', ['a1']);
    const space = spaceOf('p-term-existing');
    const plainId = addTerminalTab('p-term-existing', null);

    const { open } = renderOpenTab();
    act(() => {
      open(TERMINAL_VIEW, 'right');
    });

    expect(tabCount('p-term-existing')).toBe(1);
    const layout = useEditorStore.getState().editorLayout[space]!;
    expect(layout.groups[layout.activeGroupId].activeTabId).toBe(plainId);
  });

  it('只有 **agent** 终端 tab（项目已选 agent）→ 不认领它，另开一条纯 shell', () => {
    seedProject('p-term-agent', ['a1']);
    const space = spaceOf('p-term-agent');
    addTerminalTab('p-term-agent', 'a1');

    const { open } = renderOpenTab();
    act(() => {
      open(TERMINAL_VIEW, 'right');
    });

    const tabs = useEditorStore.getState().tabs[space]!.tabs;
    expect(tabs).toHaveLength(2);
    // 新建的那条必须是纯 shell —— 点到 agent 终端等于「默认打开 Agent」，语义就串了
    expect(tabs.filter((t) => t.data.kind === 'terminal' && t.data.agentId === null)).toHaveLength(
      1,
    );
  });

  it('配额满 → 提示（addTab 的配额门是静默 return，必须解释「点了没反应」）', () => {
    seedProject('p-term-quota', ['a1']);
    // 用 **agent** 终端把配额占满：这样既没有纯 shell 可激活，又确实建不出新的
    for (let i = 0; i < MAX_TERMINAL_TABS; i += 1) addTerminalTab('p-term-quota', 'a1');

    const { open } = renderOpenTab();
    act(() => {
      open(TERMINAL_VIEW, 'right');
    });

    expect(tabCount('p-term-quota')).toBe(MAX_TERMINAL_TABS);
    expect(notifications().map((n) => n.message)).toEqual(['Cannot open another terminal tab']);
  });
});

/** 该 unit 里一条「用户真的用过」的会话（= 侧栏会列出来的那种，`isListedSession`）。 */
function listedSession(projectId: string, overrides: Partial<SessionView> = {}): SessionView {
  return {
    sessionId: `sess-${projectId}`,
    kind: 'chat',
    agentId: 'a1',
    workspaceKey: spaceOf(projectId),
    title: 'fix the parser',
    titleSource: 'prompt',
    state: 'running',
    startedAt: '2026-11-02T10:00:00.000Z',
    updatedAt: '2026-11-02T10:00:00.000Z',
    turnCount: 2,
    hasUserInput: true,
    ...overrides,
  };
}

function seedSessions(sessions: SessionView[]): void {
  useLiveSessionsStore.setState({ version: 1, sessions, hydratedAt: Date.now() });
}

/**
 * C2 / C3：点种类图标时若该 unit 还有**用户用过**的会话，就走 live-sessions 的唯一
 * 恢复链（接回存活 PTY / 续写已结束会话 / 补写映射键），而不是新建一条空会话。
 *
 * 判据测三层：命中（不新建）、未命中（回落新建）、命中后的可见性（宿主展开）。
 * 恢复链**内部**的三级降级不在这里重测 —— 那是 `sessionActivationPlan` 与
 * `useActivateSession` 自己的用例，本文件只断言「什么时候交给它」。
 */
describe('useDockBarOpenTab — 会话命中：交给 live-sessions 的恢复链', () => {
  it('该 unit 有 listed chat 会话 → 不新建空 tab，交给 useActivateSession', () => {
    seedProject('p-resume');
    const session = listedSession('p-resume');
    seedSessions([session]);

    const { open } = renderOpenTab();
    act(() => {
      open(CHAT_VIEW, 'right');
    });

    expect(liveSessions.activateSession).toHaveBeenCalledTimes(1);
    expect(liveSessions.activateSession).toHaveBeenCalledWith(session);
    expect(openAgentChatTab).not.toHaveBeenCalled();
    expect(tabCount('p-resume')).toBe(0);
  });

  it('terminal：有 listed **纯 shell** 会话 → 交给恢复链（接回那条 shell）', () => {
    seedProject('p-resume-term', ['a1']);
    seedSessions([
      listedSession('p-resume-term', { kind: 'terminal', sessionId: 'pty-1', agentId: null }),
    ]);

    const { open } = renderOpenTab();
    act(() => {
      open(TERMINAL_VIEW, 'right');
    });

    expect(liveSessions.activateSession).toHaveBeenCalledTimes(1);
    expect(tabCount('p-resume-term')).toBe(0);
  });

  it('terminal：只有 **agent** 会话 → 不交给恢复链（Terminal 不是 Agent 入口），改开纯 shell', () => {
    seedProject('p-resume-term-agent', ['a1']);
    seedSessions([
      listedSession('p-resume-term-agent', { kind: 'terminal', sessionId: 'pty-2', agentId: 'a1' }),
    ]);

    const { open } = renderOpenTab();
    act(() => {
      open(TERMINAL_VIEW, 'right');
    });

    expect(liveSessions.activateSession).not.toHaveBeenCalled();
    const tabs = useEditorStore.getState().tabs[spaceOf('p-resume-term-agent')]!.tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0].data).toMatchObject({ kind: 'terminal', agentId: null });
  });

  it('注册表为空 → 回落原新建分支（行为与今天一致）', () => {
    seedProject('p-no-session');
    seedSessions([]);

    const { open } = renderOpenTab();
    act(() => {
      open(CHAT_VIEW, 'right');
    });

    expect(liveSessions.activateSession).not.toHaveBeenCalled();
    expect(openAgentChatTab).toHaveBeenCalledTimes(1);
  });

  it('只有「没发过输入」的会话 → 等同没有（否则第一次点图标就接回一个空会话）', () => {
    seedProject('p-silent');
    seedSessions([listedSession('p-silent', { hasUserInput: false })]);

    const { open } = renderOpenTab();
    act(() => {
      open(CHAT_VIEW, 'right');
    });

    expect(liveSessions.activateSession).not.toHaveBeenCalled();
    expect(openAgentChatTab).toHaveBeenCalledTimes(1);
  });

  it('恢复链同步建出的 tab 停在收起的宿主里 → 展开宿主（否则这次点击什么都看不见）', () => {
    seedProject('p-reveal');
    seedSessions([listedSession('p-reveal')]);
    useDockStore.getState().setSlotExpanded('right', false);
    // 模拟真实恢复链里「重建一条 chat tab」的那一半（口径不重要，落点与揭示才重要）
    liveSessions.activateSession.mockImplementation(() => {
      const revived: Tab = {
        id: 'revived-chat',
        scope: { kind: 'workspace', session: sessionOf('p-reveal') },
        title: 'Agent Chat',
        data: { kind: 'agent-chat' },
      };
      useEditorStore.getState().addTab(revived);
      useEditorStore.getState().dockTab(spaceOf('p-reveal'), revived.id, 'right');
    });

    const { open } = renderOpenTab();
    act(() => {
      open(CHAT_VIEW, 'right');
    });

    expect(useDockStore.getState().zones.right).toEqual({
      expanded: true,
      activeView: tabHostView('right'),
    });
  });
});
