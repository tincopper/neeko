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
import type { ProjectActionsContextValue } from '@/shared/contexts/ProjectActionsContext';
import { panelView } from '@/shared/dock';
import { useDockStore } from '@/shared/store/dockStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { SessionView } from '@/shared/types/liveSessions';
import type { TeamSummary } from '@/shared/types/team';
import { WorkspaceSession, type ProjectId } from '@/shared/utils/workspaceRef';
import { createTeamSnapshot, createTeamSummary } from '@/testing/factories';
import { createProjectActionsWrapper } from '@/testing/ProjectActionsTestUtils';
import { invoke } from '@/testing/tauriCore';

import { useTeamEntryActions } from '../useTeamEntryActions';

/**
 * 侧栏团队行的三个动作（编排层）。
 *
 * 组件测试只证明「回调被调用」，真正的接线在**这里**：
 *
 * - 队长会话只**接管**（`openExistingTerminalTab`），绝不新建（`addTab` / 创建命令）；
 * - 「先切项目 + 切单元，再激活 tab / 开面板」的顺序 —— 反过来会先切 tab 再切视图，
 *   中间那一帧是白屏，用户看到的却是「点了没反应」；跨项目时顺序还决定单元**是否被
 *   切换序列擦掉**（序列内部会清空各项目激活单元）；
 * - 看板按 `teamId` 去重（同队重复点击只是激活既有 tab）。
 *
 * 终端域被整块 mock（端口断言）：本文件是编排，终端 tab 怎么造是终端域的事。
 */
const P1 = 'p1' as ProjectId;
const WT = WorkspaceSession.of(P1, '/repo/wt');

const originalSetActiveWorkspace = useWorkspaceStore.getState().setActiveWorkspace;
const originalAddTab = useEditorStore.getState().addTab;
const originalActivateView = useDockStore.getState().activateView;

function team(overrides: Partial<TeamSummary> = {}): TeamSummary {
  return createTeamSummary({
    teamId: 'tm_1',
    projectId: P1,
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

/** 记录「单元落回」的调用序。 */
function recordUnits(order: string[]): void {
  useWorkspaceStore.setState({
    setActiveWorkspace: (projectId, path, branch) => {
      order.push(`unit:${path ?? 'main'}`);
      originalSetActiveWorkspace(projectId, path, branch);
    },
  });
}

/** 侧栏子树**确实**需要「切项目」这个能力（缺 provider 会抛错），hook 也一样。 */
function renderEntryActions(overrides: Partial<ProjectActionsContextValue> = {}) {
  return renderHook(() => useTeamEntryActions(), {
    wrapper: createProjectActionsWrapper(overrides),
  });
}

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  openExistingTerminalTab.mockReset();
  addTab.mockReset();
  mockInvoke.mockReset();
  __resetTeamGenerationForTests();
  useTeamStore.setState({ teamId: null, snapshot: null, loading: false, error: null, lastRev: 0 });
  useEditorStore.setState({ tabs: {}, editorLayout: {}, addTab: originalAddTab });
  useDockStore.setState({ activateView: originalActivateView });
  useWorkspaceStore.setState({ byProject: {}, setActiveWorkspace: originalSetActiveWorkspace });
  // 默认「团队所属项目已激活」：这是存量用例（同项目点击）的基线，跨项目用例自己改写。
  useProjectStore.setState({ activeProjectId: P1, activeProject: null });
  mockInvoke.mockImplementation(async (cmd) => {
    if (cmd === 'team_snapshot') return createTeamSnapshot();
    return undefined;
  });
});

describe('useTeamEntryActions — 接管队长会话', () => {
  it('先把单元切到团队自己的那一格，再接管活着的 PTY（标题 / agent 取自快照）', async () => {
    const order: string[] = [];
    recordUnits(order);
    openExistingTerminalTab.mockImplementation(() => {
      order.push('attach');
      return null;
    });

    const { result } = renderEntryActions();
    const session = leadSession();
    await act(async () => {
      result.current.onOpenLead(team(), session);
    });

    expect(order).toEqual(['unit:/repo/wt', 'attach']);
    expect(useWorkspaceStore.getState().byProject[P1]?.activePath).toBe('/repo/wt');
    expect(openExistingTerminalTab).toHaveBeenCalledWith(
      'p1',
      'term-lead',
      '把任务板接上',
      'claude-code',
    );
  });

  it('绝不新建终端（不调 addTab、不碰团队面板）—— 死掉的队长会话归 team_resume', async () => {
    const { result } = renderEntryActions();
    await act(async () => {
      result.current.onOpenLead(team(), leadSession());
    });

    expect(addTab).not.toHaveBeenCalled();
    expect(openExistingTerminalTab).toHaveBeenCalledTimes(1);
    // 打开一个活会话不该顺手把团队面板拉到前台（那是「点击行却没有活队长」才做的事）
    expect(useTeamStore.getState().teamId).toBeNull();
  });
});

describe('useTeamEntryActions — 交回团队面板', () => {
  it('先亮出单元，再 openTeam + activateView(panel:team)；不创建任何终端 tab', async () => {
    const order: string[] = [];
    recordUnits(order);
    const activateView = useDockStore.getState().activateView;
    useDockStore.setState({
      activateView: (view) => {
        order.push(`view:${view}`);
        activateView(view);
      },
    });

    const { result } = renderEntryActions();
    await act(async () => {
      result.current.onOpenTeamPanel(team());
    });

    expect(order).toEqual(['unit:/repo/wt', `view:${panelView('team')}`]);
    expect(useTeamStore.getState().teamId).toBe('tm_1');
    expect(openExistingTerminalTab).not.toHaveBeenCalled();
    expect(addTab).not.toHaveBeenCalled();
  });
});

describe('useTeamEntryActions — 看板', () => {
  it('打开该队的 team-board tab，重复点击只激活既有 tab（去重按 teamId）', async () => {
    useWorkspaceStore.getState().setActiveWorkspace(WT.projectId, WT.worktreePath, 'dev');
    const { result } = renderEntryActions();

    await act(async () => {
      result.current.onOpenBoard(team());
    });
    await act(async () => {
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
   * 只是关 / 恢复 / 分屏时才显形。`activateUnit` 因此也在这个动作里。
   */
  it('当前激活的是别的单元 ⇒ 看板 tab 仍落在团队自己的单元下', async () => {
    // 用户此刻看的是**主仓**，而团队在工作树里。
    useWorkspaceStore.getState().setActiveWorkspace(WT.projectId, null, 'dev');
    const { result } = renderEntryActions();

    await act(async () => {
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

/**
 * 跨项目：侧栏列出**所有**项目的团队行，点 B 项目的行必须让 B 成为当前项目。
 *
 * 只切单元不切项目的表现就是「点了没反应」：tab 在 B 的 tab 空间里被激活，中心视图还在 A。
 * 顺序断言钉住 R4 —— 单元必须在切换序列**结算之后**落回（序列内部会清空各项目激活单元，
 * 先落 = 自己擦掉自己），后续动作（接管 / 开面板 / 开看板）都排在两者之后。
 */
describe('useTeamEntryActions — 跨项目团队行', () => {
  const OTHER = 'p2' as ProjectId;

  function recordSelect(order: string[]) {
    // 序列内部**至少一个真正的 await**：先落单元的实现会记成 `['unit', 'select:p1']`，测试变红。
    return vi.fn(async (projectId: ProjectId) => {
      await Promise.resolve();
      order.push(`select:${projectId}`);
      useProjectStore.setState({ activeProjectId: projectId });
    });
  }

  it('接管队长：先切项目、再落单元、最后接管 tab', async () => {
    const order: string[] = [];
    recordUnits(order);
    openExistingTerminalTab.mockImplementation(() => {
      order.push('attach');
      return null;
    });
    useProjectStore.setState({ activeProjectId: OTHER });
    const onSelectProject = recordSelect(order);

    const { result } = renderEntryActions({ onSelectProject });
    await act(async () => {
      result.current.onOpenLead(team(), leadSession());
    });

    expect(order).toEqual(['select:p1', 'unit:/repo/wt', 'attach']);
    expect(onSelectProject).toHaveBeenCalledWith(P1);
    expect(useProjectStore.getState().activeProjectId).toBe(P1);
    expect(useWorkspaceStore.getState().byProject[P1]?.activePath).toBe('/repo/wt');
  });

  it('开面板：先切项目、再落单元、最后 openTeam + activateView', async () => {
    const order: string[] = [];
    recordUnits(order);
    useProjectStore.setState({ activeProjectId: OTHER });
    const activateView = useDockStore.getState().activateView;
    useDockStore.setState({
      activateView: (view) => {
        order.push(`view:${view}`);
        activateView(view);
      },
    });

    const { result } = renderEntryActions({ onSelectProject: recordSelect(order) });
    await act(async () => {
      result.current.onOpenTeamPanel(team());
    });

    expect(order).toEqual(['select:p1', 'unit:/repo/wt', `view:${panelView('team')}`]);
    expect(useProjectStore.getState().activeProjectId).toBe(P1);
    expect(useTeamStore.getState().teamId).toBe('tm_1');
  });

  it('开看板：先切项目、再落单元，看板 tab 落在**团队自己的**单元下', async () => {
    const order: string[] = [];
    recordUnits(order);
    const addTab = useEditorStore.getState().addTab;
    useEditorStore.setState({
      addTab: (tab, slot) => {
        order.push('board-tab');
        addTab(tab, slot);
      },
    });
    useProjectStore.setState({ activeProjectId: OTHER });

    const { result } = renderEntryActions({ onSelectProject: recordSelect(order) });
    await act(async () => {
      result.current.onOpenBoard(team());
    });

    expect(order).toEqual(['select:p1', 'unit:/repo/wt', 'board-tab']);
    expect(useProjectStore.getState().activeProjectId).toBe(P1);
    const wtTabs = useEditorStore.getState().tabs[WT.key]?.tabs ?? [];
    expect(wtTabs).toHaveLength(1);
    expect(wtTabs[0].data.kind === 'team-board' && wtTabs[0].data.teamId).toBe('tm_1');
    // 别的项目 / 主仓的 tab 空间都没被污染
    expect(useEditorStore.getState().tabs[WorkspaceSession.of(P1, null).key]?.tabs ?? []).toEqual(
      [],
    );
    expect(
      useEditorStore.getState().tabs[WorkspaceSession.of(OTHER, null).key]?.tabs ?? [],
    ).toEqual([]);
  });

  it('已激活同一项目 ⇒ 零切换（重复点击不擦掉刚点的单元）', async () => {
    useWorkspaceStore.getState().setActiveWorkspace(P1, WT.worktreePath, 'dev');
    const onSelectProject = vi.fn();
    const { result } = renderEntryActions({ onSelectProject });

    await act(async () => {
      result.current.onOpenBoard(team());
    });

    expect(onSelectProject).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().byProject[P1]?.activePath).toBe('/repo/wt');
  });
});
