import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/live-sessions/api/liveSessionsApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/live-sessions/api/liveSessionsApi')>()),
  liveSessionResumeCommand: vi.fn(() => Promise.resolve(null)),
}));

import {
  __resetTeamListStoreForTests,
  useTeamListStore,
} from '@/features/agent-team/store/teamListStore';
import { liveSessionResumeCommand } from '@/features/live-sessions/api/liveSessionsApi';
import { useAgentStore } from '@/shared/store/agentStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { selectActiveTabId } from '@/shared/store/editorTabSelectors';
import { useLiveSessionsStore } from '@/shared/store/liveSessionsStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import { createDefaultEditorLayout } from '@/shared/types/editorGroup';
import type { SessionView } from '@/shared/types/liveSessions';
import type { Tab } from '@/shared/types/tab';
import { WorkspaceSession, type ProjectId } from '@/shared/utils/workspaceRef';
import { createTeamList, createTeamSummary } from '@/testing/factories';
import { createProjectActionsWrapper } from '@/testing/ProjectActionsTestUtils';

import UnitSessionList from '../UnitSessionList';

const WS = WorkspaceSession.of('p1', '/proj-wt');
const KEY = WS.key;

function session(overrides: Partial<SessionView> = {}): SessionView {
  return {
    sessionId: 'pty-1',
    kind: 'terminal',
    attribution: { kind: 'user' },
    agentId: 'claude-code',
    workspaceKey: KEY,
    title: '修复登录竞态',
    titleSource: 'prompt',
    state: 'ready',
    startedAt: '2026-11-02T10:00:00.000Z',
    updatedAt: '2026-11-02T10:00:00.000Z',
    turnCount: 1,
    hasUserInput: true,
    ...overrides,
  };
}

function terminalTab(id: string, ptySessionId?: string): Tab {
  return {
    id,
    scope: { kind: 'workspace', session: WS },
    title: id,
    data: { kind: 'terminal', agentId: 'claude-code', ptySessionId },
  };
}

function activeTabId(): string | null {
  return selectActiveTabId(useEditorStore.getState(), KEY);
}

function seedSessions(...sessions: SessionView[]): void {
  useLiveSessionsStore.setState({ version: 1, sessions, hydratedAt: Date.now() });
}

beforeEach(() => {
  vi.mocked(liveSessionResumeCommand).mockReset();
  vi.mocked(liveSessionResumeCommand).mockResolvedValue(null);
  __resetTeamListStoreForTests();
  useEditorStore.setState({ tabs: {}, editorLayout: {} });
  useWorkspaceStore.setState({ byProject: {} });
  useProjectStore.setState({ activeProjectId: null });
  useLiveSessionsStore.setState({ version: 0, sessions: [], hydratedAt: null });
  useAgentStore.setState({ agents: [], loading: false });
});

/**
 * 侧栏子树**确实**需要「切项目」这个能力（`useActivateUnit` → `useProjectActionsContext()`），
 * 缺 provider 会抛错 —— 刻意的（静默不切项目正是要修的缺陷形态）。所以每个用例包一层。
 */
function renderList(workspaceKey: string, onRevealUnit?: () => void) {
  return render(<UnitSessionList workspaceKey={workspaceKey} onRevealUnit={onRevealUnit} />, {
    wrapper: createProjectActionsWrapper(),
  });
}

describe('UnitSessionList — 点击会话行', () => {
  it('映射键命中 ⇒ 激活对应的 tab', async () => {
    const editor = useEditorStore.getState();
    editor.addTab(terminalTab('tab-1', 'pty-1'));
    editor.addTab(terminalTab('tab-2', 'pty-2'));
    expect(activeTabId()).toBe('tab-2');

    seedSessions(session());
    renderList(KEY);
    fireEvent.click(screen.getByText('修复登录竞态'));

    // 单元落回后才激活 tab（切项目序列是 async）⇒ 断言走 waitFor 等结算。
    await waitFor(() => expect(activeTabId()).toBe('tab-1'));
  });

  it('映射键丢了 ⇒ 认领那条孤儿 tab（把 id 补回去）并激活，不新建', async () => {
    useEditorStore.getState().addTab(terminalTab('tab-orphan'));
    const before = useEditorStore.getState().tabs[KEY]?.tabs.length;

    seedSessions(session());
    renderList(KEY);
    fireEvent.click(screen.getByText('修复登录竞态'));

    await waitFor(() => expect(activeTabId()).toBe('tab-orphan'));
    const tabs = useEditorStore.getState().tabs[KEY]?.tabs ?? [];
    expect(tabs).toHaveLength(before ?? 0);
    expect(tabs[0].data.kind === 'terminal' && tabs[0].data.ptySessionId).toBe('pty-1');
    expect(activeTabId()).toBe('tab-orphan');
  });

  it('没有可用 tab，且会话已结束 ⇒ 按会话重建一条 terminal tab', async () => {
    seedSessions(session({ state: 'stopped' }));
    renderList(KEY);
    fireEvent.click(screen.getByText('修复登录竞态'));

    await waitFor(() => expect(useEditorStore.getState().tabs[KEY]?.tabs).toHaveLength(1));
    const tabs = useEditorStore.getState().tabs[KEY]?.tabs ?? [];
    expect(tabs[0].data.kind).toBe('terminal');
    expect(tabs[0].data.kind === 'terminal' && tabs[0].data.agentId).toBe('claude-code');
    expect(activeTabId()).toBe(tabs[0].id);
    // 新 PTY 建好后由 `TerminalView` 消费：继承旧会话的身份，旧条目退场。
    expect(tabs[0].data.kind === 'terminal' && tabs[0].data.resumeFromSessionId).toBe('pty-1');
  });

  it('会话还活着（关 tab 时选了后台运行）⇒ 新 tab 接回同一个 PTY，不走 resume', async () => {
    seedSessions(session({ state: 'running' }));
    renderList(KEY);
    fireEvent.click(screen.getByText('修复登录竞态'));

    await waitFor(() => expect(useEditorStore.getState().tabs[KEY]?.tabs).toHaveLength(1));
    const tab = useEditorStore.getState().tabs[KEY]?.tabs[0];
    expect(tab?.data.kind === 'terminal' && tab.data.attachSessionId).toBe('pty-1');
    expect(tab?.data.kind === 'terminal' && tab.data.taskCommand).toBeUndefined();
    expect(liveSessionResumeCommand).not.toHaveBeenCalled();
  });

  it('后端给出原生恢复参数 ⇒ 重建的 tab 带 taskCommand（续写而不是重开）', async () => {
    vi.mocked(liveSessionResumeCommand).mockResolvedValue(['--resume', 'native-42']);
    useAgentStore.getState().setAgents([
      {
        id: 'claude-code',
        name: 'Claude Code',
        command: 'claude',
        args: [],
        env: {},
        enabled: true,
      } as never,
    ]);
    seedSessions(session({ state: 'stopped' }));
    renderList(KEY);
    fireEvent.click(screen.getByText('修复登录竞态'));

    await waitFor(() => expect(useEditorStore.getState().tabs[KEY]?.tabs).toHaveLength(1));
    const tab = useEditorStore.getState().tabs[KEY]?.tabs[0];
    expect(tab?.data.kind).toBe('terminal');
    expect(tab?.data.kind === 'terminal' && tab.data.taskCommand).toBe('claude --resume native-42');
  });

  it('拿不到恢复参数 ⇒ 不带 taskCommand（新建同 agent 终端，不猜命令）', async () => {
    seedSessions(session({ state: 'stopped' }));
    renderList(KEY);
    fireEvent.click(screen.getByText('修复登录竞态'));

    await waitFor(() => expect(useEditorStore.getState().tabs[KEY]?.tabs).toHaveLength(1));
    const tab = useEditorStore.getState().tabs[KEY]?.tabs[0];
    expect(tab?.data.kind === 'terminal' && tab.data.taskCommand).toBeUndefined();
  });
});

describe('UnitSessionList — 跨项目会话行（「点了没反应」的修复）', () => {
  it('点 B 项目的会话行 ⇒ 项目也切过去（只切单元不切项目 = 中心视图仍停在 A）', async () => {
    // 用户此刻在 p2，而这一行属于 p1。
    useProjectStore.setState({ activeProjectId: 'p2' as ProjectId });
    const onSelectProject = vi.fn(async (projectId: ProjectId) => {
      useProjectStore.setState({ activeProjectId: projectId });
    });
    useEditorStore.getState().addTab(terminalTab('tab-1', 'pty-1'));
    seedSessions(session());

    render(<UnitSessionList workspaceKey={KEY} />, {
      wrapper: createProjectActionsWrapper({ onSelectProject }),
    });
    fireEvent.click(screen.getByText('修复登录竞态'));

    await waitFor(() => expect(useProjectStore.getState().activeProjectId).toBe('p1'));
    expect(onSelectProject).toHaveBeenCalledWith('p1');
    expect(useWorkspaceStore.getState().byProject['p1']?.activePath).toBe('/proj-wt');
    await waitFor(() => expect(activeTabId()).toBe('tab-1'));
  });
});

describe('UnitSessionList — 高亮只属于当前项目（R8.1）', () => {
  const A = WorkspaceSession.of('p1', null);
  const B = WorkspaceSession.of('p2', null);

  function tabFor(ws: WorkspaceSession, ptySessionId: string): Tab {
    return {
      id: `tab-${ptySessionId}`,
      scope: { kind: 'workspace', session: ws },
      title: ptySessionId,
      data: { kind: 'terminal', agentId: null, ptySessionId },
    };
  }

  function currentRows(): { rowA: HTMLElement; rowB: HTMLElement } {
    // 两个列表按 A、B 的渲染顺序各产出一行；用 within 认领行，不做 DOM 树遍历。
    const [rowA, rowB] = screen.getAllByRole('listitem');
    expect(within(rowA).getByText('A 会话')).toBeInTheDocument();
    expect(within(rowB).getByText('B 会话')).toBeInTheDocument();
    return { rowA, rowB };
  }

  it('两个项目各有前台会话：切换项目后旧单元的 row-current 立即熄灭', () => {
    useEditorStore.getState().addTab(tabFor(A, 'pty-a'), 'left');
    useEditorStore.getState().addTab(tabFor(B, 'pty-b'), 'left');
    seedSessions(
      session({ workspaceKey: A.key, sessionId: 'pty-a', title: 'A 会话' }),
      session({ workspaceKey: B.key, sessionId: 'pty-b', title: 'B 会话' }),
    );
    useProjectStore.setState({ activeProjectId: A.projectId });

    render(
      <>
        <UnitSessionList workspaceKey={A.key} />
        <UnitSessionList workspaceKey={B.key} />
      </>,
      { wrapper: createProjectActionsWrapper() },
    );

    expect(currentRows().rowA).toHaveClass('row-current');
    expect(currentRows().rowB).not.toHaveClass('row-current');

    act(() => {
      useProjectStore.setState({ activeProjectId: B.projectId });
    });

    expect(currentRows().rowA).not.toHaveClass('row-current');
    expect(currentRows().rowB).toHaveClass('row-current');
  });

  it('中心前台与 dock 前台是两条会话时，高亮中心那条（refs 顺序即优先级）', () => {
    const layout = createDefaultEditorLayout();
    const center = terminalTab('tab-center', 'pty-center');
    const docked = terminalTab('tab-docked', 'pty-docked');
    layout.groups.left = { tabIds: [center.id], activeTabId: center.id };
    layout.docked.right = { tabIds: [docked.id], activeTabId: docked.id };
    useEditorStore.setState({
      tabs: { [KEY]: { tabs: [center, docked] } },
      editorLayout: { [KEY]: layout },
    });
    useWorkspaceStore.getState().setActiveWorkspace(WS.projectId, WS.worktreePath, 'dev');
    useProjectStore.setState({ activeProjectId: WS.projectId });
    // 快照顺序故意把 docked 放前面：按 sessions 顺序找会先命中停靠会话。
    seedSessions(
      session({ sessionId: 'pty-docked', title: '停靠会话' }),
      session({ sessionId: 'pty-center', title: '中心会话' }),
    );

    renderList(KEY);

    const rows = screen.getAllByRole('listitem');
    const centerRow = rows.find((row) => within(row).queryByText('中心会话'));
    const dockRow = rows.find((row) => within(row).queryByText('停靠会话'));
    expect(centerRow).toHaveClass('row-current');
    expect(dockRow).not.toHaveClass('row-current');
  });
});

describe('UnitSessionList — 先亮出单元再激活', () => {
  it('点击会话行时先调 onRevealUnit（切项目 / 切单元 / 切到终端视图），再激活 tab', async () => {
    const order: string[] = [];
    useEditorStore.getState().addTab(terminalTab('tab-1', 'pty-1'));
    useEditorStore.getState().addTab(terminalTab('tab-2', 'pty-2'));
    seedSessions(session());

    const activateTab = useEditorStore.getState().activateTab;
    useEditorStore.setState({
      activateTab: (key, id) => {
        order.push('activate');
        activateTab(key, id);
      },
    });

    renderList(KEY, () => {
      order.push('reveal');
    });
    fireEvent.click(screen.getByText('修复登录竞态'));

    await waitFor(() => expect(order).toEqual(['reveal', 'activate']));
    expect(activeTabId()).toBe('tab-1');
  });
});

describe('UnitSessionList — 团队行（AC7：无团队时零回归）', () => {
  it('没有团队 ⇒ 输出与今天一致：只有会话列表，没有团队行', () => {
    seedSessions(session());
    renderList(KEY);

    // 团队行是另一个 list（`aria-label=Teams`）：无团队时它根本不存在
    expect(screen.queryByRole('list', { name: 'Teams' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('list')).toHaveLength(1);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('单元有团队（队长未运行、没有用户会话）⇒ 团队行与会话列表并存', () => {
    useTeamListStore.setState({
      list: createTeamList({
        teams: [
          createTeamSummary({
            teamId: 'tm_1',
            projectId: 'p1',
            workspaceWorktree: WS.worktreePath,
            leadMemberId: null,
          }),
        ],
      }),
      loading: false,
      error: null,
    });

    renderList(KEY);

    const teams = screen.getByRole('list', { name: 'Teams' });
    expect(within(teams).getByText('refactor')).toBeInTheDocument();
    expect(within(teams).getByText('Lead not running')).toBeInTheDocument();
    // 会话列表为空 ⇒ 它自己不渲染（团队行仍是该单元的唯一子项）
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });
});
