import { act, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetTeamListStoreForTests,
  useTeamListStore,
} from '@/features/agent-team/store/teamListStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { useGitStore } from '@/shared/store/gitStore';
import { useLiveSessionsStore } from '@/shared/store/liveSessionsStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { Project, Tab } from '@/shared/types';
import { createDefaultEditorLayout } from '@/shared/types/editorGroup';
import type { SessionView } from '@/shared/types/liveSessions';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';
import {
  createProject,
  createSessionView,
  createTeamList,
  createTeamSnapshot,
  createTeamSummary,
} from '@/testing/factories';
import { createProjectActionsWrapper } from '@/testing/ProjectActionsTestUtils';
import { invoke } from '@/testing/tauriCore';

import ProjectGitSection from '../ProjectGitSection';

/**
 * 项目层的**二级列表装配**：地点（单元）在上、容器（团队）在下。
 *
 * 这一层钉住的契约：
 *
 * 1. **单元行的子项数只数会话**（AC6）—— 团队升到项目层后不再给单元「撑」展开箭头；
 *    纯团队、无会话的单元因此可以折叠（那是对的：团队不在那里了）。
 * 2. **单元行不再带团队标记**（R1'）—— 被团队占用的工作树不再作为地点行出现，标记没有
 *    存在的理由；「这是团队」由团队行自己的行首图标表达。
 * 3. **团队块在项目层**：它是单元行的**兄弟**，不在任何单元的子列表里。
 */

const PROJECT_ID = 'p1';
const MAIN_KEY = WorkspaceSession.of(PROJECT_ID, null).key;

function project(overrides: Partial<Project> = {}): Project {
  return createProject({
    id: PROJECT_ID as Project['id'],
    name: 'neeko',
    git_info: null,
    ...overrides,
  });
}

function session(overrides: Partial<SessionView> = {}): SessionView {
  return createSessionView({ sessionId: 'pty-1', workspaceKey: MAIN_KEY, ...overrides });
}

function seedTeams(...teams: ReturnType<typeof createTeamSummary>[]): void {
  useTeamListStore.setState({
    list: createTeamList({ teams }),
    loading: false,
    error: null,
  });
}

/**
 * 让某条**成员会话**成为前台：激活项目 = 主仓单元，那个单元的前台 tab 就是它。
 *
 * 这是「点成员行」在状态层的等价物（`onOpenMember` 只接管 PTY，**不写** `activeTeam`）：
 * 归属在 live 快照里，前台由 editorStore 的 layout 表达。
 */
function seedForegroundMemberSession(teamId: string): void {
  useLiveSessionsStore.setState({
    version: 1,
    sessions: [
      session({
        sessionId: 'pty-member',
        attribution: { kind: 'teamMember', teamId, memberId: 'lead@tm_1' },
      }),
    ],
    hydratedAt: Date.now(),
  });
  useProjectStore.setState({ activeProjectId: PROJECT_ID as Project['id'] });

  const tab: Tab = {
    id: 'tab-member',
    scope: { kind: 'workspace', session: WorkspaceSession.of(PROJECT_ID as Project['id'], null) },
    title: '把任务板接上',
    data: { kind: 'terminal', agentId: 'claude-code', ptySessionId: 'pty-member' },
  };
  const layout = createDefaultEditorLayout();
  layout.groups.left = { tabIds: [tab.id], activeTabId: tab.id };
  useEditorStore.setState({
    tabs: { [MAIN_KEY]: { tabs: [tab] } },
    editorLayout: { [MAIN_KEY]: layout },
  });
}

function renderSection(): ReturnType<typeof render> {
  const actions = {
    onSelectProject: vi.fn(),
    onRefreshGit: vi.fn(),
    onOpenWorktreeTerminal: vi.fn(),
    onShowToast: vi.fn(),
  };
  return render(<ProjectGitSection project={project()} isActive actions={actions} />, {
    wrapper: createProjectActionsWrapper(),
  });
}

/**
 * 主仓单元行（`local`）。
 *
 * 按 label 取而不是 `getByTestId('unit-row')`：团队行**也是** `SessionRow`（同一个
 * testid），一个页面上会同时出现多行 —— 这正是「同构」的证据。
 */
function localRow(): HTMLElement {
  // 按 label 取而不是 `getByTestId('unit-row')`：团队行**也是** `SessionRow`（同一个 testid），
  // 一个页面上会同时出现多行 —— 这正是「同构」的证据。
  const row = screen
    .getAllByTestId('unit-row')
    .find((candidate) => within(candidate).queryByText('local') !== null);
  if (row === undefined) throw new Error('local row not rendered');
  return row;
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (cmd) => {
    // 有成员的团队行首帧就展开（与单元行同一条规则）⇒ 它会拉一次花名册。
    if (cmd === 'team_snapshot') return createTeamSnapshot();
    return undefined;
  });
  __resetTeamListStoreForTests();
  useGitStore.setState({ aheadBehind: {} });
  useWorkspaceStore.setState({ byProject: {}, activeTeam: null });
  useProjectStore.setState({ activeProjectId: null });
  useLiveSessionsStore.setState({ version: 0, sessions: [], hydratedAt: null });
  useEditorStore.setState({ tabs: {}, editorLayout: {} });
});

describe('ProjectGitSection — 单元行的子项数（AC6）', () => {
  it('没有团队、也没有会话 ⇒ 主仓行没有展开箭头（与今天一致）', () => {
    renderSection();

    expect(
      within(localRow()).queryByRole('button', { name: /Expand sessions/ }),
    ).not.toBeInTheDocument();
  });

  it('单元里有团队但**没有**用户会话 ⇒ 仍然没有展开箭头（团队不是单元的子项）', () => {
    seedTeams(createTeamSummary({ projectId: PROJECT_ID, workspaceWorktree: null }));
    renderSection();

    // 团队行不再给单元「撑」子项数：纯团队单元可以折叠（团队在项目层）
    expect(
      within(localRow()).queryByRole('button', { name: /Expand sessions/ }),
    ).not.toBeInTheDocument();
  });

  it('有会话 ⇒ 展开箭头出现（子项数 = 会话数）', () => {
    useLiveSessionsStore.setState({ version: 1, sessions: [session()], hydratedAt: Date.now() });
    renderSection();

    expect(
      within(localRow()).getByRole('button', { name: /Collapse sessions/ }),
    ).toBeInTheDocument();
  });
});

describe('ProjectGitSection — 团队块在项目层（AC1）', () => {
  it('有团队 ⇒ 团队块渲染在项目层（不在任何单元行里）', () => {
    seedTeams(createTeamSummary({ projectId: PROJECT_ID, name: 'refactor' }));
    renderSection();

    const teams = screen.getByRole('list', { name: 'Teams' });
    expect(within(teams).getByText('refactor')).toBeInTheDocument();
    // 单元行是它的**兄弟**，不是它的父行
    expect(within(localRow()).queryByRole('list', { name: 'Teams' })).not.toBeInTheDocument();
  });

  it('团队别的项目 ⇒ 本项目不渲染团队块（按 projectId 相等，不从路径猜）', () => {
    seedTeams(createTeamSummary({ projectId: 'p2', name: 'other project crew' }));
    renderSection();

    expect(screen.queryByRole('list', { name: 'Teams' })).not.toBeInTheDocument();
    expect(screen.queryByText('other project crew')).not.toBeInTheDocument();
  });

  it('单元行不再带团队标记（「这是团队」只由团队行的行首图标表达）', () => {
    seedTeams(createTeamSummary({ projectId: PROJECT_ID, workspaceWorktree: null }));
    renderSection();

    const row = localRow();
    expect(within(row).queryByText(/⟦team⟧/)).not.toBeInTheDocument();
    // 单元行本身仍然在：「在这棵树里开终端」的入口不许被团队行顶掉
    expect(within(row).getByText('local')).toBeInTheDocument();
  });

  /**
   * **第二级只有一行亮**。团队跑在主 checkout 时，`local` 与团队行的单元是同一个 —— 两条都亮
   * 就是「同一棵树两个入口」（用户实测：「高亮肯定不能同时出现，一次只会激活一个」）。
   */
  it('团队行是当前 ⇒ `local` 行让出高亮（不会两行同时亮）', () => {
    seedTeams(
      createTeamSummary({ teamId: 'tm_1', projectId: PROJECT_ID, workspaceWorktree: null }),
    );
    renderSection();

    // 先确认基线：项目激活且在主 checkout ⇒ local 行是「当前」
    expect(localRow()).toHaveClass('bg-bg-selected');

    act(() => {
      useWorkspaceStore.getState().selectTeam(PROJECT_ID as Project['id'], 'tm_1');
    });

    expect(localRow()).not.toHaveClass('bg-bg-selected');
    // 整个二级列表**恰好一行**带选中填充 —— 而且那一行是团队行（`SessionRow` 同构，两者同 testid）
    const selected = screen
      .getAllByTestId('unit-row')
      .filter((row) => row.className.includes('bg-bg-selected'));
    expect(selected).toHaveLength(1);
    expect(within(selected[0]).getByText('refactor')).toBeInTheDocument();
  });

  /**
   * **前台是成员的会话 ⇒ 仍然只有一行亮**（本次 review 实测的双亮现场）。
   *
   * 与上一条的差别只有「选中是怎么发生的」：点成员行只接管 PTY，不写 `activeTeam`（它只是
   * 「我点过哪一行」），所以「当前是团队」必须由**同一个判据**把前台会话也算进去 ——
   * 否则单元行按 `activeTeam === null` 不让出，而团队行按 `foregroundTeamId` 亮着。
   */
  it('前台是成员会话（没点过团队行）⇒ 仍然只有一行亮，且是团队行', () => {
    seedTeams(
      createTeamSummary({ teamId: 'tm_1', projectId: PROJECT_ID, workspaceWorktree: null }),
    );
    seedForegroundMemberSession('tm_1');
    renderSection();

    const selected = screen
      .getAllByTestId('unit-row')
      .filter((row) => row.className.includes('bg-bg-selected'));
    expect(selected).toHaveLength(1);
    expect(within(selected[0]).getByText('refactor')).toBeInTheDocument();
    expect(localRow()).not.toHaveClass('bg-bg-selected');
  });

  it('单元被激活 ⇒ 团队选中作废，`local` 行重新拿到高亮', () => {
    seedTeams(
      createTeamSummary({ teamId: 'tm_1', projectId: PROJECT_ID, workspaceWorktree: null }),
    );
    renderSection();

    act(() => {
      useWorkspaceStore.getState().selectTeam(PROJECT_ID as Project['id'], 'tm_1');
    });
    expect(localRow()).not.toHaveClass('bg-bg-selected');

    act(() => {
      useWorkspaceStore.getState().clearActiveWorkspace(PROJECT_ID);
    });

    expect(useWorkspaceStore.getState().activeTeam).toBeNull();
    expect(localRow()).toHaveClass('bg-bg-selected');
  });
});
