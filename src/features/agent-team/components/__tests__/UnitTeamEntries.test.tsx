import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetTeamListStoreForTests,
  useTeamListStore,
} from '@/features/agent-team/store/teamListStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { useLiveSessionsStore } from '@/shared/store/liveSessionsStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { SessionView } from '@/shared/types/liveSessions';
import type { Tab } from '@/shared/types/tab';
import type { TeamSummary } from '@/shared/types/team';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';
import { createTeamList, createTeamSummary } from '@/testing/factories';

import UnitTeamEntries from '../UnitTeamEntries';

/**
 * 侧栏的**团队行**（单元下的团队入口）。
 *
 * 这一层要钉住的是三条容易静默失效的契约：
 *
 * 1. **身份是团队**：行由 `team_list` 派生 —— 队长进程不在时行仍在（副文案换成
 *    「Lead not running」），而不是「没有行」；
 * 2. **归属只认单元 key**：团队挂在 `(projectId, workspaceWorktree)` 经
 *    `WorkspaceSession.key()` 铸造的那个单元下，工作树团队**不**出现在主 checkout 下；
 * 3. **只有一个动作、一条路径**：有活队长 ⇒ 接管那条 PTY（`onOpenLead`）；否则交回团队
 *    面板（`onOpenTeamPanel`）—— 侧栏不猜「为什么开不了」。行本身是入口，所以行上只有
 *    一个按钮（没有常驻的「Board」文字按钮：看板在团队面板里，一条路）。
 */
const MAIN = WorkspaceSession.of('p1', null);
const WT = WorkspaceSession.of('p1', '/repo/wt');

/** 团队行（按「这一行里有这个名字」定位，不抓 DOM 结构）。 */
function teamRow(name: string): HTMLElement {
  const list = screen.getByRole('list', { name: 'Teams' });
  const row = within(list)
    .getAllByRole('listitem')
    .find((item) => within(item).queryByText(name) !== null);
  if (row === undefined) throw new Error(`team row ${name} not rendered`);
  return row;
}

/** 行主按钮（行上**唯一**的按钮 = 点击区）。 */
function mainButton(row: HTMLElement): HTMLElement {
  const [first] = within(row).getAllByRole('button');
  return first;
}

function session(overrides: Partial<SessionView> = {}): SessionView {
  return {
    sessionId: 'pty-lead',
    kind: 'terminal',
    attribution: { kind: 'teamMember', teamId: 'tm_1', memberId: 'lead@tm_1' },
    agentId: 'claude-code',
    workspaceKey: MAIN.key,
    title: '把任务板接上',
    titleSource: 'native',
    state: 'running',
    startedAt: '2026-11-02T10:00:00.000Z',
    updatedAt: '2026-11-02T10:00:00.000Z',
    turnCount: 1,
    hasUserInput: true,
    ...overrides,
  };
}

function team(overrides: Partial<TeamSummary> = {}): TeamSummary {
  return createTeamSummary({ teamId: 'tm_1', ...overrides });
}

function seedTeams(...teams: TeamSummary[]): void {
  useTeamListStore.setState({
    list: createTeamList({ teams }),
    loading: false,
    error: null,
  });
}

function seedSessions(...sessions: SessionView[]): void {
  useLiveSessionsStore.setState({ version: 1, sessions, hydratedAt: Date.now() });
}

/** 把 `workspace` 单元的某条会话放到前台（`foregroundTeamId` 的输入面）。 */
function seedForeground(workspace: WorkspaceSession, ptySessionId: string): void {
  const tab: Tab = {
    id: 'tab-lead',
    scope: { kind: 'workspace', session: workspace },
    title: 'lead',
    data: { kind: 'terminal', agentId: 'claude-code', ptySessionId },
  };
  useEditorStore.getState().addTab(tab);
  useWorkspaceStore
    .getState()
    .setActiveWorkspace(workspace.projectId, workspace.worktreePath, 'dev');
  useProjectStore.setState({ activeProjectId: workspace.projectId });
}

function renderEntries(workspaceKey: string = MAIN.key) {
  const handlers = {
    onOpenLead: vi.fn(),
    onOpenTeamPanel: vi.fn(),
  };
  const view = render(<UnitTeamEntries workspaceKey={workspaceKey} {...handlers} />);
  return { ...handlers, view };
}

beforeEach(() => {
  __resetTeamListStoreForTests();
  useEditorStore.setState({ tabs: {}, editorLayout: {} });
  useWorkspaceStore.setState({ byProject: {} });
  useProjectStore.setState({ activeProjectId: null });
  useLiveSessionsStore.setState({ version: 0, sessions: [], hydratedAt: null });
});

describe('UnitTeamEntries — 单元归属（AC3）', () => {
  it('没有团队 ⇒ 什么都不渲染（既有侧栏的零回归锚点）', () => {
    seedTeams();
    const { view } = renderEntries();
    expect(view.container).toBeEmptyDOMElement();
  });

  it('团队在别的单元 / 项目 id 为空 ⇒ 本单元不渲染（不猜归属）', () => {
    seedTeams(
      team({ teamId: 'tm_wt', workspaceWorktree: WT.worktreePath }),
      // v16 之前的旧行：`project_id` 为空串，挂到哪都是猜
      team({ teamId: 'tm_old', projectId: '' }),
    );
    const { view } = renderEntries(MAIN.key);
    expect(view.container).toBeEmptyDOMElement();
  });

  it('工作树团队挂在工作树单元下，不出现在主 checkout 下', () => {
    seedTeams(
      team({ teamId: 'tm_main' }),
      team({ teamId: 'tm_wt', name: 'worktree crew', workspaceWorktree: WT.worktreePath }),
    );

    const { view: mainView } = renderEntries(MAIN.key);
    expect(within(teamRow('refactor')).getByText('refactor')).toBeInTheDocument();
    expect(screen.queryByText('worktree crew')).not.toBeInTheDocument();
    mainView.unmount();
    renderEntries(WT.key);
    expect(within(teamRow('worktree crew')).getByText('worktree crew')).toBeInTheDocument();
    expect(screen.queryByText('refactor')).not.toBeInTheDocument();
  });
});

describe('UnitTeamEntries — 行内容（AC1 / AC3）', () => {
  it('队名 + 任务进度 + 状态徽标；**不**写成员数（口径唯一在面板头）', () => {
    seedTeams(team({ state: 'closing', taskOpen: 2, taskTotal: 5, memberCount: 3 }));
    renderEntries();

    const row = teamRow('refactor');
    expect(within(row).getByText('refactor')).toBeInTheDocument();
    expect(within(row).getByText('2/5')).toBeInTheDocument();
    // 状态徽标复用 `TeamStateBadge`（三态不许合并：closing 是「关到一半」）
    expect(within(row).getByText('Closing')).toBeInTheDocument();
    expect(within(row).queryByText(/members/i)).not.toBeInTheDocument();
  });

  it('活队长 ⇒ 副文案是队长会话标题', () => {
    seedTeams(team());
    seedSessions(session());
    renderEntries();

    expect(within(teamRow('refactor')).getByText('Lead · 把任务板接上')).toBeInTheDocument();
  });

  /**
   * 队长活着但**还没有真标题**（占位标题形如 `claude-code · neeko`）：那是身份回显，不是名字。
   *
   * 印到行上就是侧栏早就消灭过的那种噪声行（design §10：占位只负责让 tab / 历史有字可读）。
   * 也不能退成「Lead not running」—— 那是在说假话（进程确实活着）。
   */
  it('活队长但只有占位标题 ⇒ `Lead · running`，不把占位串当名字', () => {
    seedTeams(team());
    seedSessions(session({ title: 'claude-code · neeko', titleSource: 'placeholder' }));
    renderEntries();

    const row = teamRow('refactor');
    expect(within(row).getByText('Lead · running')).toBeInTheDocument();
    expect(within(row).queryByText(/claude-code · neeko/)).not.toBeInTheDocument();
  });

  it('队长未运行（会话已停止 / 该队没有队长行）⇒ Lead not running', () => {
    seedTeams(
      team({ teamId: 'tm_stopped', name: 'stopped crew' }),
      team({ teamId: 'tm_none', name: 'no lead row', leadMemberId: null }),
    );
    seedSessions(
      session({
        attribution: { kind: 'teamMember', teamId: 'tm_stopped', memberId: 'lead@tm_1' },
        state: 'stopped',
      }),
    );
    renderEntries();

    expect(within(teamRow('stopped crew')).getByText('Lead not running')).toBeInTheDocument();
    // 没有队长行 ⇒ 没有可求交的成员身份，即便有同名成员的会话也不认
    expect(within(teamRow('no lead row')).getByText('Lead not running')).toBeInTheDocument();
  });
});

describe('UnitTeamEntries — 两个动作（AC4 / AC5）', () => {
  it('有活队长 ⇒ 点击调 onOpenLead(团队, 那条会话)，且不打开团队面板', () => {
    const lead = session({ state: 'ready' });
    seedTeams(team());
    seedSessions(lead);
    const { onOpenLead, onOpenTeamPanel } = renderEntries();

    fireEvent.click(within(teamRow('refactor')).getByText('refactor'));

    expect(onOpenLead).toHaveBeenCalledTimes(1);
    expect(onOpenLead).toHaveBeenCalledWith(expect.objectContaining({ teamId: 'tm_1' }), lead);
    expect(onOpenTeamPanel).not.toHaveBeenCalled();
  });

  it('没有活队长 ⇒ 点击交回团队面板（不猜「为什么开不了」）', () => {
    seedTeams(team());
    seedSessions(session({ state: 'failed' }));
    const { onOpenLead, onOpenTeamPanel } = renderEntries();

    fireEvent.click(within(teamRow('refactor')).getByText('refactor'));

    expect(onOpenTeamPanel).toHaveBeenCalledWith(expect.objectContaining({ teamId: 'tm_1' }));
    expect(onOpenLead).not.toHaveBeenCalled();
  });

  it('前台是队长的会话 ⇒ 团队行标「当前」（aria-current + row-current）', () => {
    seedTeams(team());
    seedSessions(session());
    seedForeground(MAIN, 'pty-lead');

    renderEntries();

    const row = teamRow('refactor');
    expect(mainButton(row)).toHaveAttribute('aria-current', 'true');
    expect(row).toHaveClass('row-current');
  });

  it('前台不是成员会话 ⇒ 团队行不标「当前」', () => {
    seedTeams(team());
    seedSessions(
      session(),
      session({
        sessionId: 'pty-mine',
        attribution: { kind: 'user' },
        title: '我的会话',
      }),
    );
    seedForeground(MAIN, 'pty-mine');

    renderEntries();

    const row = teamRow('refactor');
    expect(mainButton(row)).toHaveAttribute('aria-current', 'false');
    expect(row).not.toHaveClass('row-current');
  });

  it('行上只有行主按钮：没有改名 / 删除 / 常驻入口（团队生命周期在面板里）', () => {
    seedTeams(team());
    renderEntries();

    const row = teamRow('refactor');
    expect(within(row).getAllByRole('button')).toHaveLength(1);
    expect(
      within(row).queryByRole('button', { name: /rename|delete|close|board/i }),
    ).not.toBeInTheDocument();
    expect(within(row).queryByRole('textbox')).not.toBeInTheDocument();
  });
});

/**
 * 行本身就是入口（R1）：去掉了行尾那个常驻的 `Board` 文字按钮。
 *
 * 它当时存在的理由是「看板要一键到达」，而团队行已经是团队唯一入口 —— 面板里就有看板。
 * 一个常驻按钮只是一行里第二块可点区域（在 260px 宽的侧栏里还挤掉队名）。
 */
describe('UnitTeamEntries — 只有一个动作（AC1）', () => {
  it('行上恰好一个按钮，且没有 Board 文案', () => {
    seedTeams(team());
    seedSessions(session());
    renderEntries();

    const row = teamRow('refactor');
    expect(within(row).getAllByRole('button')).toHaveLength(1);
    expect(within(row).queryByText('Board')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /board/i })).not.toBeInTheDocument();
  });
});
