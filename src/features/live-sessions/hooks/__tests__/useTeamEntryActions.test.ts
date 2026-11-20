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
 * 侧栏团队行的两个动作（编排层）。
 *
 * 组件测试只证明「回调被调用」，真正的接线在**这里**：
 *
 * - 队长会话只**接管**（`openExistingTerminalTab`），绝不新建（`addTab` / 创建命令）；
 * - 「先切项目 + 切单元，再激活 tab / 开面板」的顺序 —— 反过来会先切 tab 再切视图，
 *   中间那一帧是白屏，用户看到的却是「点了没反应」；跨项目时顺序还决定单元**是否被
 *   切换序列擦掉**（序列内部会清空各项目激活单元）；
 *
 * 侧栏**没有**「直接开看板」这个动作：团队行本身是唯一入口，看板在团队面板里
 * （面板头上有它自己的「在中间打开」）。
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
  useWorkspaceStore.setState({
    byProject: {},
    activeTeam: null,
    setActiveWorkspace: originalSetActiveWorkspace,
  });
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

/**
 * 成员行：容器模型的**全部依据**是「成员会话的归属与它跑在哪棵树无关」。
 *
 * 所以这里钉死两件事：
 * 1. 切的是**该会话自己的**单元（不是队长 / 团队记的那棵树）—— 成员可以跑在另一棵里；
 * 2. 只接管（`openExistingTerminalTab`），绝不新建进程。
 *
 * 用团队的 `workspaceWorktree` 去激活的表现是：视图先切到错的地方，再去接管一条不在那儿的
 * PTY —— 用户看到的正是「点了没反应」。
 */
describe('useTeamEntryActions — 接管成员会话', () => {
  const MEMBER_WT = WorkspaceSession.of(P1, '/repo/member-wt');

  function memberSession(): SessionView {
    return {
      ...leadSession(),
      sessionId: 'term-w1',
      attribution: { kind: 'teamMember', teamId: 'tm_1', memberId: 'w1@tm_1' },
      workspaceKey: MEMBER_WT.key,
      title: '修登录竞态',
      agentId: 'pi',
    };
  }

  it('先切到**该会话自己的**单元，再接管它的 PTY（团队记的树无关）', async () => {
    const order: string[] = [];
    recordUnits(order);
    openExistingTerminalTab.mockImplementation(() => {
      order.push('attach');
      return null;
    });

    const { result } = renderEntryActions();
    const session = memberSession();
    await act(async () => {
      result.current.onOpenMember(session);
    });

    // 团队（`team()`）记的是 `/repo/wt`；成员跑在 `/repo/member-wt` —— 动作按会话落键。
    expect(order).toEqual(['unit:/repo/member-wt', 'attach']);
    expect(useWorkspaceStore.getState().byProject[P1]?.activePath).toBe('/repo/member-wt');
    expect(openExistingTerminalTab).toHaveBeenCalledWith('p1', 'term-w1', '修登录竞态', 'pi');
  });

  it('绝不新建终端（不调 addTab、不碰团队面板 store）', async () => {
    const { result } = renderEntryActions();
    await act(async () => {
      result.current.onOpenMember(memberSession());
    });

    expect(addTab).not.toHaveBeenCalled();
    expect(openExistingTerminalTab).toHaveBeenCalledTimes(1);
    expect(useTeamStore.getState().teamId).toBeNull();
  });
});

/**
 * 跨项目：侧栏列出**所有**项目的团队行，点 B 项目的行必须让 B 成为当前项目。
 *
 * 只切单元不切项目的表现就是「点了没反应」：tab 在 B 的 tab 空间里被激活，中心视图还在 A。
 * 顺序断言钉住 R4 —— 单元必须在切换序列**结算之后**落回（序列内部会清空各项目激活单元，
 * 先落 = 自己擦掉自己），后续动作（接管 / 开面板）都排在两者之后。
 */
/**
 * 「选中」= 点过这一行。高亮的另一半（前台会话）由 `foregroundTeamId` 派生，两条合起来才是
 * 侧栏上的「当前」—— 只认前台会话时，点一个队长不在跑的队什么都不会亮（用户反馈）。
 */
describe('useTeamEntryActions — 选中团队行', () => {
  it('接管队长 ⇒ `activeTeam` 变成这一队', async () => {
    const lead = leadSession();
    const { result } = renderEntryActions();

    // 选中写在 `activateUnit(...).then(...)` 里（顺序契约）⇒ 断言必须等它结算。
    await act(async () => {
      result.current.onOpenLead(team(), lead);
    });

    expect(useWorkspaceStore.getState().activeTeam?.teamId).toBe('tm_1');
  });

  it('交回面板（队长不在跑）⇒ 同样选中这一队', async () => {
    const { result } = renderEntryActions();

    await act(async () => {
      result.current.onOpenTeamPanel(team());
    });

    expect(useWorkspaceStore.getState().activeTeam?.teamId).toBe('tm_1');
  });

  it('换一个队再点 ⇒ 选中跟着换（单数，不会两个都亮）', async () => {
    const { result } = renderEntryActions();

    await act(async () => {
      result.current.onOpenTeamPanel(team({ teamId: 'tm_1' }));
    });
    await act(async () => {
      result.current.onOpenTeamPanel(team({ teamId: 'tm_2' }));
    });

    expect(useWorkspaceStore.getState().activeTeam?.teamId).toBe('tm_2');
  });

  /**
   * 顺序是契约：`activateUnit` 内部调 `setActiveWorkspace`，而**那个 mutator 会清空团队选中**
   * （它是「用户选了单元」的统一入口）。选中若写在它之前，这里就会是 `null`。
   */
  it('选中写在单元激活**之后**（`setActiveWorkspace` 会清空它）', async () => {
    const { result } = renderEntryActions();

    await act(async () => {
      result.current.onOpenTeamPanel(team());
    });

    expect(useWorkspaceStore.getState().activeTeam?.teamId).toBe('tm_1');
  });
});

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

  it('已激活同一项目 ⇒ 零切换（重复点击不擦掉刚点的单元）', async () => {
    useWorkspaceStore.getState().setActiveWorkspace(P1, WT.worktreePath, 'dev');
    const onSelectProject = vi.fn();
    const { result } = renderEntryActions({ onSelectProject });

    await act(async () => {
      result.current.onOpenTeamPanel(team());
    });

    expect(onSelectProject).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().byProject[P1]?.activePath).toBe('/repo/wt');
  });
});
