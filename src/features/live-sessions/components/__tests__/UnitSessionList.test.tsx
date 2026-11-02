import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/live-sessions/api/liveSessionsApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/live-sessions/api/liveSessionsApi')>()),
  liveSessionResumeCommand: vi.fn(() => Promise.resolve(null)),
}));

import { liveSessionResumeCommand } from '@/features/live-sessions/api/liveSessionsApi';
import { useAgentStore } from '@/shared/store/agentStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { selectActiveTabId } from '@/shared/store/editorTabSelectors';
import { useLiveSessionsStore } from '@/shared/store/liveSessionsStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { SessionView } from '@/shared/types/liveSessions';
import type { Tab } from '@/shared/types/tab';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import UnitSessionList from '../UnitSessionList';

const WS = WorkspaceSession.of('p1', '/proj-wt');
const KEY = WS.key;

function session(overrides: Partial<SessionView> = {}): SessionView {
  return {
    sessionId: 'pty-1',
    kind: 'terminal',
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
  useEditorStore.setState({ tabs: {}, editorLayout: {} });
  useWorkspaceStore.setState({ byProject: {} });
  useLiveSessionsStore.setState({ version: 0, sessions: [], hydratedAt: null });
  useAgentStore.setState({ agents: [], loading: false });
});

describe('UnitSessionList — 点击会话行', () => {
  it('映射键命中 ⇒ 激活对应的 tab', () => {
    const editor = useEditorStore.getState();
    editor.addTab(terminalTab('tab-1', 'pty-1'));
    editor.addTab(terminalTab('tab-2', 'pty-2'));
    expect(activeTabId()).toBe('tab-2');

    seedSessions(session());
    render(<UnitSessionList workspaceKey={KEY} />);
    fireEvent.click(screen.getByText('修复登录竞态'));

    expect(activeTabId()).toBe('tab-1');
  });

  it('映射键丢了 ⇒ 认领那条孤儿 tab（把 id 补回去）并激活，不新建', () => {
    useEditorStore.getState().addTab(terminalTab('tab-orphan'));
    const before = useEditorStore.getState().tabs[KEY]?.tabs.length;

    seedSessions(session());
    render(<UnitSessionList workspaceKey={KEY} />);
    fireEvent.click(screen.getByText('修复登录竞态'));

    const tabs = useEditorStore.getState().tabs[KEY]?.tabs ?? [];
    expect(tabs).toHaveLength(before ?? 0);
    expect(tabs[0].data.kind === 'terminal' && tabs[0].data.ptySessionId).toBe('pty-1');
    expect(activeTabId()).toBe('tab-orphan');
  });

  it('没有可用 tab，且会话已结束 ⇒ 按会话重建一条 terminal tab', async () => {
    seedSessions(session({ state: 'stopped' }));
    render(<UnitSessionList workspaceKey={KEY} />);
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
    render(<UnitSessionList workspaceKey={KEY} />);
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
    render(<UnitSessionList workspaceKey={KEY} />);
    fireEvent.click(screen.getByText('修复登录竞态'));

    await waitFor(() => expect(useEditorStore.getState().tabs[KEY]?.tabs).toHaveLength(1));
    const tab = useEditorStore.getState().tabs[KEY]?.tabs[0];
    expect(tab?.data.kind).toBe('terminal');
    expect(tab?.data.kind === 'terminal' && tab.data.taskCommand).toBe('claude --resume native-42');
  });

  it('拿不到恢复参数 ⇒ 不带 taskCommand（新建同 agent 终端，不猜命令）', async () => {
    seedSessions(session({ state: 'stopped' }));
    render(<UnitSessionList workspaceKey={KEY} />);
    fireEvent.click(screen.getByText('修复登录竞态'));

    await waitFor(() => expect(useEditorStore.getState().tabs[KEY]?.tabs).toHaveLength(1));
    const tab = useEditorStore.getState().tabs[KEY]?.tabs[0];
    expect(tab?.data.kind === 'terminal' && tab.data.taskCommand).toBeUndefined();
  });
});

describe('UnitSessionList — 先亮出单元再激活', () => {
  it('点击会话行时先调 onRevealUnit（切项目 / 切单元 / 切到终端视图），再激活 tab', () => {
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

    render(
      <UnitSessionList
        workspaceKey={KEY}
        onRevealUnit={() => {
          order.push('reveal');
        }}
      />,
    );
    fireEvent.click(screen.getByText('修复登录竞态'));

    expect(order).toEqual(['reveal', 'activate']);
    expect(activeTabId()).toBe('tab-1');
  });
});
