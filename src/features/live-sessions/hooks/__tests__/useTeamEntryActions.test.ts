import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { openExistingTerminalTab, addTab } = vi.hoisted(() => ({
  openExistingTerminalTab: vi.fn(),
  addTab: vi.fn(),
}));

vi.mock('@/features/terminal', () => ({
  useTerminalTabs: () => ({ openExistingTerminalTab, addTab }),
}));

import { __resetTeamGenerationForTests, useTeamStore } from '@/features/agent-team/store/teamStore';
import { panelView } from '@/shared/dock';
import { useDockStore } from '@/shared/store/dockStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { SessionView } from '@/shared/types/liveSessions';
import type { TeamSummary } from '@/shared/types/team';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';
import { createTeamSnapshot, createTeamSummary } from '@/testing/factories';
import { invoke } from '@/testing/tauriCore';

import { useTeamEntryActions } from '../useTeamEntryActions';

/**
 * 侧栏团队行的三个动作（编排层）。
 *
 * 组件测试只证明「回调被调用」，真正的接线在**这里**：
 *
 * - 队长会话只**接管**（`openExistingTerminalTab`），绝不新建（`addTab` / 创建命令）；
 * - 「先把单元亮出来，再激活 tab / 开面板」的顺序 —— 反过来会先切 tab 再切视图，
 *   中间那一帧是白屏，用户看到的却是「点了没反应」；
 * - 看板按 `teamId` 去重（同队重复点击只是激活既有 tab）。
 *
 * 终端域被整块 mock（端口断言）：本文件是编排，终端 tab 怎么造是终端域的事。
 */
const WT = WorkspaceSession.of('p1', '/repo/wt');

function team(overrides: Partial<TeamSummary> = {}): TeamSummary {
  return createTeamSummary({
    teamId: 'tm_1',
    projectId: 'p1',
    workspaceWorktree: WT.worktreePath,
    ...overrides,
  });
}

function leadSession(): SessionView {
  return {
    sessionId: 'term-lead',
    kind: 'terminal',
    attribution: { kind: 'teamMember', teamId: 'tm_1', memberId: 'lead@tm_1' },
    agentId: 'claude-code',
    workspaceKey: WT.key,
    title: '把任务板接上',
    titleSource: 'native',
    state: 'running',
    startedAt: '2026-11-02T10:00:00.000Z',
    updatedAt: '2026-11-02T10:00:00.000Z',
    turnCount: 1,
    hasUserInput: true,
  };
}

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  openExistingTerminalTab.mockReset();
  addTab.mockReset();
  mockInvoke.mockReset();
  __resetTeamGenerationForTests();
  useTeamStore.setState({ teamId: null, snapshot: null, loading: false, error: null, lastRev: 0 });
  useEditorStore.setState({ tabs: {}, editorLayout: {} });
  useWorkspaceStore.setState({ byProject: {} });
  mockInvoke.mockImplementation(async (cmd) => {
    if (cmd === 'team_snapshot') return createTeamSnapshot();
    return undefined;
  });
});

describe('useTeamEntryActions — 接管队长会话', () => {
  it('先把单元切到团队自己的那一格，再接管活着的 PTY（标题 / agent 取自快照）', () => {
    const order: string[] = [];
    const setActiveWorkspace = useWorkspaceStore.getState().setActiveWorkspace;
    useWorkspaceStore.setState({
      setActiveWorkspace: (projectId, path, branch) => {
        order.push(`unit:${path ?? 'main'}`);
        setActiveWorkspace(projectId, path, branch);
      },
    });
    openExistingTerminalTab.mockImplementation(() => {
      order.push('attach');
      return null;
    });

    const { result } = renderHook(() => useTeamEntryActions());
    const session = leadSession();
    act(() => {
      result.current.onOpenLead(team(), session);
    });

    expect(order).toEqual(['unit:/repo/wt', 'attach']);
    expect(useWorkspaceStore.getState().byProject['p1']?.activePath).toBe('/repo/wt');
    expect(openExistingTerminalTab).toHaveBeenCalledWith(
      'p1',
      'term-lead',
      '把任务板接上',
      'claude-code',
    );
  });

  it('绝不新建终端（不调 addTab、不碰团队面板）—— 死掉的队长会话归 team_resume', () => {
    const { result } = renderHook(() => useTeamEntryActions());
    act(() => {
      result.current.onOpenLead(team(), leadSession());
    });

    expect(addTab).not.toHaveBeenCalled();
    expect(openExistingTerminalTab).toHaveBeenCalledTimes(1);
    // 打开一个活会话不该顺手把团队面板拉到前台（那是「点击行却没有活队长」才做的事）
    expect(useTeamStore.getState().teamId).toBeNull();
  });
});

describe('useTeamEntryActions — 交回团队面板', () => {
  it('先亮出单元，再 openTeam + activateView(panel:team)；不创建任何终端 tab', () => {
    const order: string[] = [];
    const setActiveWorkspace = useWorkspaceStore.getState().setActiveWorkspace;
    useWorkspaceStore.setState({
      setActiveWorkspace: (projectId, path, branch) => {
        order.push(`unit:${path ?? 'main'}`);
        setActiveWorkspace(projectId, path, branch);
      },
    });
    const activateView = useDockStore.getState().activateView;
    useDockStore.setState({
      activateView: (view) => {
        order.push(`view:${view}`);
        activateView(view);
      },
    });

    const { result } = renderHook(() => useTeamEntryActions());
    act(() => {
      result.current.onOpenTeamPanel(team());
    });

    expect(order).toEqual(['unit:/repo/wt', `view:${panelView('team')}`]);
    expect(useTeamStore.getState().teamId).toBe('tm_1');
    expect(openExistingTerminalTab).not.toHaveBeenCalled();
    expect(addTab).not.toHaveBeenCalled();
  });
});

describe('useTeamEntryActions — 看板', () => {
  it('打开该队的 team-board tab，重复点击只激活既有 tab（去重按 teamId）', () => {
    useWorkspaceStore.getState().setActiveWorkspace(WT.projectId, WT.worktreePath, 'dev');
    const { result } = renderHook(() => useTeamEntryActions());

    act(() => {
      result.current.onOpenBoard(team());
    });
    act(() => {
      result.current.onOpenBoard(team());
    });

    const tabs = useEditorStore.getState().tabs[WT.key]?.tabs ?? [];
    expect(tabs).toHaveLength(1);
    expect(tabs[0].data.kind).toBe('team-board');
    expect(tabs[0].data.kind === 'team-board' && tabs[0].data.teamId).toBe('tm_1');
    expect(tabs[0].data.kind === 'team-board' && tabs[0].data.view).toBe('board');
    // 看板是中央 tab，不是终端会话
    expect(openExistingTerminalTab).not.toHaveBeenCalled();
    expect(addTab).not.toHaveBeenCalled();
  });

  /**
   * 从一条**工作树**团队行点看板，tab 必须落进**那个工作树**的 tab 空间。
   *
   * `useTeamBoardTab` 按 `activeWorkspaceSession(projectId)` 落键，而那是「该项目当前激活的
   * 单元」—— 不先切单元的话，tab 会登记到主仓（或另一个工作树）下：进程与数据显示都对，
   * 只是关 / 恢复 / 分屏时才显形。`revealUnit` 因此也在这个动作里。
   */
  it('当前激活的是别的单元 ⇒ 看板 tab 仍落在团队自己的单元下', () => {
    // 用户此刻看的是**主仓**，而团队在工作树里。
    useWorkspaceStore.getState().setActiveWorkspace(WT.projectId, null, 'dev');
    const { result } = renderHook(() => useTeamEntryActions());

    act(() => {
      result.current.onOpenBoard(team());
    });

    const mainTabs =
      useEditorStore.getState().tabs[WorkspaceSession.of('p1', null).key]?.tabs ?? [];
    expect(mainTabs).toHaveLength(0);
    const wtTabs = useEditorStore.getState().tabs[WT.key]?.tabs ?? [];
    expect(wtTabs).toHaveLength(1);
    expect(wtTabs[0].data.kind).toBe('team-board');
  });
});
