/**
 * `TasksPanel`：View、搜索、快捷键、以及四条**跨层**链路。
 *
 * 只 mock **api 层**（`../../api/workItemsApi` 与 `../../../git/api/gitApi`），让 store 与
 * provider hook 真实跑 —— 这样乐观流转、失败回滚、删除的撤销窗口、PR 开关的去重在用例里都是
 * 真行为，而不是被 mock 掉的假设（`workItemsStore.test.ts` 钉的是 store 的状态迁移、
 * `useGithubPrs.test.tsx` 钉的是开关的因果链，这里钉的是「用户点下去会看到什么"）。
 *
 * 覆盖：
 * 1. 默认 Board；切 List 行数一致；视图选择**活过卸载**（design §4.5）；
 * 2. 搜索过滤；
 * 3. 创建 → 卡片出现（并把新卡片滚进视野）→ 删除 → UndoBar → 撤销恢复；
 * 4. `transition` 失败 → 错误 toast + 卡片回到原列；
 * 5. 快捷键：按键 → 对应的Actions被调（判据本身由 `utils/__tests__/shortcuts.test.ts` 钉）；
 * 6. 滚动只对本面板发起的 create 生效（延迟提交失败的回魂不算新建）。
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getStagePlan: vi.fn(),
  listWorkItems: vi.fn(),
  createWorkItem: vi.fn(),
  updateWorkItem: vi.fn(),
  transitionWorkItem: vi.fn(),
  deleteWorkItem: vi.fn(),
  listWorkItemRuns: vi.fn(),
}));

/** agent 列表：详情里的执行区会拉它来填下拉（本文件不测下拉行为，只求不打真 IPC）。 */
const agentApi = vi.hoisted(() => ({ listAgents: vi.fn(), getAgent: vi.fn() }));

/**
 * GitHub PR provider 走 `features/git/api/gitApi`（既有 api 层）：按红线只 mock 这一层，
 * 不去 mock `invoke`。默认「gh 已装且已登录、没有 PR"，各用例按需覆盖。
 */
const gitApi = vi.hoisted(() => ({
  isGhInstalled: vi.fn(),
  isGhAuthenticated: vi.fn(),
  listPrs: vi.fn(),
  viewPr: vi.fn(),
}));

/**
 * 「在浏览器打开"走 `features/browser/api/browserApi`（既有 api 层）：真调会 `invoke`，
 * 所以按红线在这一层替换，并断言**交给系统浏览器的那个 URL 就是 viewPr 给的那个**
 * （自己拼 `github.com/<owner>/<repo>/pull/n` 是企业版 / fork 场景下 404 的根因）。
 */
const browserApi = vi.hoisted(() => ({ openInDefaultBrowser: vi.fn() }));

vi.mock('../../api/workItemsApi', () => api);
vi.mock('../../../agent/api/agentApi', () => agentApi);
vi.mock('../../../git/api/gitApi', () => gitApi);
vi.mock('@/features/browser/api/browserApi', () => browserApi);

import type { PRListItem } from '@/shared/types/git';

import { useWorkItemsStore } from '../../store/workItemsStore';
import type { CreateWorkItemParams, StagePlan } from '../../types';
import { toLocalTask, type TaskItem } from '../../viewModel';
import TasksPanel from '../TasksPanel';

/** 含 Review / Done：PR 的落列判据就在这两列上（`prStage`）。 */
const PLAN: StagePlan = {
  stages: ['Backlog', 'Ready', 'In Progress', 'Review', 'Done'],
  transitions: [
    { from: 'Backlog', to: 'Ready' },
    { from: 'Ready', to: 'Backlog' },
    { from: 'Ready', to: 'In Progress' },
    { from: 'In Progress', to: 'Ready' },
    { from: 'In Progress', to: 'Review' },
    { from: 'Review', to: 'Done' },
  ],
};

function item(id: string, stage: string, title: string): TaskItem {
  return toLocalTask({
    id,
    projectId: 'p1',
    title,
    body: '',
    stage,
    priority: null,
    labels: [],
    assignee: null,
    createdAt: 1,
    updatedAt: 1,
  });
}

/** 一条开着等 review 的 PR（`state: 'OPEN'` ⇒ 必须落在 Review column）。 */
function pr(overrides: Partial<PRListItem> = {}): PRListItem {
  return {
    number: 128,
    title: '统一任务中心：PR provider',
    state: 'OPEN',
    author: 'tincopper',
    headRefName: 'feat/pr-provider',
    baseRefName: 'main',
    createdAt: '2026-11-02T10:00:00Z',
    isCrossRepository: false,
    headRepositoryOwner: 'tincopper',
    labels: [{ name: 'enhancement', color: 'a2eeef' }],
    assignees: [{ login: 'tincopper' }],
    ...overrides,
  };
}

function card(name: string): HTMLElement {
  return screen.getByRole('button', { name: `Open work item ${name}` });
}

function column(stage: string): HTMLElement {
  return screen.getByRole('region', { name: `${stage} column` });
}

beforeEach(() => {
  useWorkItemsStore.getState().reset();
  // 视图偏好真的落在 localStorage 上（design §4.5）：不清会让上一条用例的 `list` 漏到下一条，
  // 于是「默认是 Board"在整文件跑时忽然变成「默认是 List"。
  window.localStorage.clear();
  api.getStagePlan.mockReset();
  api.listWorkItems.mockReset();
  api.createWorkItem.mockReset();
  api.updateWorkItem.mockReset();
  api.transitionWorkItem.mockReset();
  api.deleteWorkItem.mockReset();
  api.listWorkItemRuns.mockReset();
  agentApi.listAgents.mockReset();
  agentApi.listAgents.mockResolvedValue([]);
  api.getStagePlan.mockResolvedValue(PLAN);
  api.listWorkItems.mockResolvedValue([]);
  api.deleteWorkItem.mockResolvedValue(undefined);
  api.listWorkItemRuns.mockResolvedValue([]);
  gitApi.isGhInstalled.mockReset();
  gitApi.isGhAuthenticated.mockReset();
  gitApi.listPrs.mockReset();
  gitApi.viewPr.mockReset();
  gitApi.isGhInstalled.mockResolvedValue(true);
  gitApi.isGhAuthenticated.mockResolvedValue(true);
  gitApi.listPrs.mockResolvedValue([]);
  browserApi.openInDefaultBrowser.mockReset();
  browserApi.openInDefaultBrowser.mockResolvedValue(undefined);
});

describe('TasksPanel — 视图', () => {
  it('默认是 Board：列来自 plan，View 开关的 aria-pressed 对得上', async () => {
    api.listWorkItems.mockResolvedValue([item('wi_1', 'Backlog', '修复登录')]);
    render(<TasksPanel projectId="p1" />);

    expect(await screen.findByRole('region', { name: 'Backlog column' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Board' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('切到 List 后行数与工作项数量一致（同一份数据换个排布）', async () => {
    const user = userEvent.setup();
    api.listWorkItems.mockResolvedValue([
      item('wi_1', 'Backlog', '修复登录'),
      item('wi_2', 'Ready', '重构看板'),
      item('wi_3', 'In Progress', '补测试'),
    ]);
    render(<TasksPanel projectId="p1" />);
    await screen.findByRole('region', { name: 'Backlog column' });

    await user.click(screen.getByRole('button', { name: 'List' }));

    expect(screen.getAllByRole('button', { name: /^Open work item/ })).toHaveLength(3);
    expect(screen.queryByRole('region', { name: 'Backlog column' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('搜索按标题过滤；搜不到时说明「没有匹配」而不是「还没有工作项」', async () => {
    const user = userEvent.setup();
    api.listWorkItems.mockResolvedValue([
      item('wi_1', 'Backlog', '修复登录'),
      item('wi_2', 'Ready', '重构看板'),
    ]);
    render(<TasksPanel projectId="p1" />);
    await screen.findByRole('region', { name: 'Backlog column' });

    await user.type(screen.getByLabelText('Search work items'), '看板');
    expect(screen.getAllByRole('button', { name: /^Open work item/ })).toHaveLength(1);
    expect(card('重构看板')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Search work items'), 'zzz');
    expect(screen.getByText('No matching work items')).toBeInTheDocument();
    expect(screen.queryByText('No work items yet')).not.toBeInTheDocument();
  });

  it('没有绑定项目时只显示 Select a project，不发列表请求', async () => {
    render(<TasksPanel projectId={null} />);

    expect(await screen.findByText('Select a project')).toBeInTheDocument();
    expect(api.listWorkItems).not.toHaveBeenCalled();
  });
});

describe('TasksPanel — 创建 / 删除 / 撤销', () => {
  it('创建后卡片出现在对应列；删除后出现 UndoBar；点撤销把那一行放回来', async () => {
    const user = userEvent.setup();
    api.listWorkItems.mockResolvedValue([]);
    api.createWorkItem.mockImplementation((params: CreateWorkItemParams) =>
      Promise.resolve({
        id: 'wi_new',
        projectId: params.projectId,
        title: params.title,
        body: params.body ?? '',
        stage: params.stage ?? 'Backlog',
        priority: null,
        labels: params.labels ?? [],
        assignee: params.assignee ?? null,
        createdAt: 10,
        updatedAt: 10,
      }),
    );

    render(<TasksPanel projectId="p1" />);

    // 空态 → 打开创建对话框（新建时带 stage 选择器）。
    await user.click(await screen.findByRole('button', { name: 'Create your first work item' }));
    await user.type(screen.getByLabelText('Title'), '新工作项');
    await user.selectOptions(screen.getByLabelText('Stage'), 'Ready');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    // 卡片落在 Ready column（`+ 新建` 的预填 stage 经对话框传给 create）。
    const ready = await screen.findByRole('region', { name: 'Ready column' });
    expect(
      within(ready).getByRole('button', { name: 'Open work item 新工作项' }),
    ).toBeInTheDocument();
    expect(api.createWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1', title: '新工作项', stage: 'Ready' }),
    );

    // 打开详情 → 删除 → 撤销条出现。
    await user.click(card('新工作项'));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('Deleted "新工作项"')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Open work item 新工作项' }),
    ).not.toBeInTheDocument();

    // 撤销：命中的是同一个 5 秒窗口，所以 store 里那行还没被真删（`deleteWorkItem` 未发出）。
    await user.click(screen.getByRole('button', { name: 'Undo' }));

    expect(
      await screen.findByRole('button', { name: 'Open work item 新工作项' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Deleted "新工作项"')).not.toBeInTheDocument();
    expect(api.deleteWorkItem).not.toHaveBeenCalled();
  });
});

describe('TasksPanel — 流转失败', () => {
  it('失败时 toast 报原因，卡片回到原列（store 回滚 + UI 提示）', async () => {
    const user = userEvent.setup();
    api.listWorkItems.mockResolvedValue([item('wi_1', 'Backlog', '只该在 Backlog')]);
    api.transitionWorkItem.mockRejectedValue(new Error('cannot jump stages'));
    render(<TasksPanel projectId="p1" />);

    await user.click(await screen.findByRole('button', { name: 'Open work item 只该在 Backlog' }));
    const detail = screen.getByRole('region', { name: 'Work item detail' });
    const rail = within(detail).getByRole('group', { name: 'Stage rail' });
    await user.click(within(rail).getByRole('button', { name: 'Ready' }));

    // `transition` 的失败不写 store.errors ⇒ 调用点必须自己 toast（否则卡片悄悄弹回，一个字都不说）。
    expect(await screen.findByText('Transition failed: cannot jump stages')).toBeInTheDocument();
    expect(
      within(column('Backlog')).getByRole('button', { name: 'Open work item 只该在 Backlog' }),
    ).toBeInTheDocument();
  });
});

describe('TasksPanel — 视图记忆（design §4.5）', () => {
  it('切到 List 后卸载再挂载，仍然是 List（偏好活过面板的挂载期）', async () => {
    const user = userEvent.setup();
    const view = render(<TasksPanel projectId="p1" />);
    expect(await screen.findByRole('button', { name: 'Board' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(screen.getByRole('button', { name: 'List' }));
    expect(window.localStorage.getItem('neeko.work-items.view')).toBe('list');

    view.unmount();
    render(<TasksPanel projectId="p1" />);

    expect(await screen.findByRole('button', { name: 'List' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('存储里的值非法时回落 Board（不因为一个脏值就渲染不出东西）', async () => {
    window.localStorage.setItem('neeko.work-items.view', 'kanban-v2');

    render(<TasksPanel projectId="p1" />);

    expect(await screen.findByRole('button', { name: 'Board' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

describe('TasksPanel — 快捷键（design §11.7）', () => {
  /** 把焦点放进面板内部：快捷键只在**面板获得焦点**时生效（监听器挂在根元素上）。 */
  async function focusPanel(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.click(screen.getByRole('button', { name: 'Board' }));
  }

  it('Cmd+N 打开创建对话框', async () => {
    const user = userEvent.setup();
    api.listWorkItems.mockResolvedValue([item('wi_1', 'Backlog', '已有的')]);
    render(<TasksPanel projectId="p1" />);
    await screen.findByRole('region', { name: 'Backlog column' });
    await focusPanel(user);

    await user.keyboard('{Meta>}n{/Meta}');

    expect(await screen.findByLabelText('Title')).toBeInTheDocument();
  });

  it('Delete 删除选中的那一行（与详情面板的删除是同一个动作）', async () => {
    const user = userEvent.setup();
    api.listWorkItems.mockResolvedValue([item('wi_1', 'Backlog', '要删掉的')]);
    render(<TasksPanel projectId="p1" />);

    await user.click(await screen.findByRole('button', { name: 'Open work item 要删掉的' }));
    await user.keyboard('{Delete}');

    expect(await screen.findByText('Deleted "要删掉的"')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Open work item 要删掉的' }),
    ).not.toBeInTheDocument();
  });

  it('焦点在搜索框里时 Backspace 只是输入，不删行', async () => {
    const user = userEvent.setup();
    api.listWorkItems.mockResolvedValue([item('wi_1', 'Backlog', '别删我')]);
    render(<TasksPanel projectId="p1" />);

    await user.click(await screen.findByRole('button', { name: 'Open work item 别删我' }));
    const searchInput = screen.getByLabelText('Search work items');
    // 用 `focus()` 而不是 `user.click()`：详情岛与看板之间有 `ResizableHandle`，而
    // `react-resizable-panels` 在 document 上挂了 `pointerdown`（capture），按**指针到分隔条的距离**
    // 判定命中。jsdom 里所有 rect 都是 0×0、clientX/Y 都是 0 ⇒ 距离恒为 0 ⇒ 任何点击都会把焦点
    // 抢给分隔条（真实浏览器里距离算得出来，只有贴着分隔条点才会命中）。这是测量缺失，不是
    // 真实行为，所以这里用确定性的 `focus()` 把焦点放进输入框，并在下面**先断言**它真的在那儿。
    searchInput.focus();
    expect(searchInput).toHaveFocus();

    await user.keyboard('{Backspace}');

    expect(screen.getByRole('button', { name: 'Open work item 别删我' })).toBeInTheDocument();
    expect(screen.queryByText(/Deleted/)).not.toBeInTheDocument();
  });

  it('Escape 关闭详情面板', async () => {
    const user = userEvent.setup();
    api.listWorkItems.mockResolvedValue([item('wi_1', 'Backlog', '看一下')]);
    render(<TasksPanel projectId="p1" />);

    await user.click(await screen.findByRole('button', { name: 'Open work item 看一下' }));
    expect(screen.getByRole('region', { name: 'Work item detail' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('region', { name: 'Work item detail' })).not.toBeInTheDocument();
  });

  it('对话框开着时 Escape 只关对话框，不删背后那一行', async () => {
    const user = userEvent.setup();
    api.listWorkItems.mockResolvedValue([item('wi_1', 'Backlog', '别在编辑时删我')]);
    render(<TasksPanel projectId="p1" />);

    await user.click(await screen.findByRole('button', { name: 'Open work item 别在编辑时删我' }));
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(await screen.findByLabelText('Title')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    // 对话框关掉了（Radix Dialog 是 Escape 的唯一所有者），行还在。
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open work item 别在编辑时删我' }),
    ).toBeInTheDocument();
  });
});

describe('TasksPanel — 创建后滚动到新卡片（design §11.7）', () => {
  beforeEach(() => {
    api.createWorkItem.mockImplementation((params: CreateWorkItemParams) =>
      Promise.resolve({
        id: 'wi_new',
        projectId: params.projectId,
        title: params.title,
        body: params.body ?? '',
        stage: params.stage ?? 'Backlog',
        priority: null,
        labels: params.labels ?? [],
        assignee: params.assignee ?? null,
        createdAt: 10,
        updatedAt: 10,
      }),
    );
  });

  it('本面板发起的 create 把新卡片滚进视野（block: nearest）', async () => {
    const user = userEvent.setup();
    // `setup.ts` 里的 `scrollIntoView` 是一个全局 vi.fn：调用记录会**跨用例累积**，
    // 不清空的话上一条用例的 create 会被算进这一条（实测差 1 次）。
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    scrollIntoView.mockClear();
    api.listWorkItems.mockResolvedValue([item('wi_1', 'Backlog', '旧的')]);
    render(<TasksPanel projectId="p1" />);
    await screen.findByRole('region', { name: 'Backlog column' });

    // 按钮的可访问名是「新建"（`+` 是 `aria-hidden` 的图标，不进读屏名称）
    await user.click(screen.getByRole('button', { name: 'New' }));
    await user.type(screen.getByLabelText('Title'), '新的');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await screen.findByRole('button', { name: 'Open work item 新的' });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    // 滚的必须是**新**那一行，不是列表里任意一行。
    expect(scrollIntoView.mock.instances[0]).toBe(
      screen.getByRole('button', { name: 'Open work item 新的' }),
    );
  });

  it('列表自己变了（手动刷新）不滚动：那不是新建', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    scrollIntoView.mockClear();
    api.listWorkItems.mockResolvedValue([item('wi_1', 'Backlog', '旧的')]);
    render(<TasksPanel projectId="p1" />);
    await screen.findByRole('region', { name: 'Backlog column' });

    // 刷新拿回一个**多出来**的行（延迟提交的删除失败时后端仍持有它，就是这个形状）。
    api.listWorkItems.mockResolvedValue([
      item('wi_back', 'Backlog', '回魂的行'),
      item('wi_1', 'Backlog', '旧的'),
    ]);
    await user.click(screen.getByRole('button', { name: 'Refresh work items' }));

    await screen.findByRole('button', { name: 'Open work item 回魂的行' });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('TasksPanel — GitHub PR provider（design §8.3）', () => {
  it('勾上 GitHub PRs：PR 卡片出现在 Review 列；取消勾选后消失且不重拉', async () => {
    const user = userEvent.setup();
    // 至少一条本地工作项：没有数据时面板渲染的是空态，而不是看板列。
    api.listWorkItems.mockResolvedValue([item('wi_1', 'Backlog', '修复登录')]);
    gitApi.listPrs.mockResolvedValue([pr()]);
    render(<TasksPanel projectId="p1" />);
    await screen.findByRole('region', { name: 'Backlog column' });

    const toggle = screen.getByRole('checkbox', { name: 'GitHub PRs' });
    expect(toggle).not.toBeChecked();
    expect(gitApi.listPrs).not.toHaveBeenCalled();

    await user.click(toggle);

    // OPEN ⇒ Review column（不是 In Progress：开着的 PR 是「等 review"，不是「还没开始"）。
    expect(
      await within(column('Review')).findByRole('button', {
        name: 'Open work item 统一任务中心：PR provider',
      }),
    ).toBeInTheDocument();
    expect(gitApi.listPrs).toHaveBeenCalledTimes(1);

    await user.click(toggle);

    expect(
      screen.queryByRole('button', { name: 'Open work item 统一任务中心：PR provider' }),
    ).not.toBeInTheDocument();
    // 关掉再开不重拉（同一 workspace 只拉一次），所以这里仍然只有第一次那一声。
    expect(gitApi.listPrs).toHaveBeenCalledTimes(1);
  });

  it('gh 不可用：勾选框 disabled、原因可见且有 title，且不发任何 PR 请求', async () => {
    api.listWorkItems.mockResolvedValue([item('wi_1', 'Backlog', '修复登录')]);
    gitApi.isGhInstalled.mockResolvedValue(false);
    render(<TasksPanel projectId="p1" />);
    await screen.findByRole('region', { name: 'Backlog column' });

    const toggle = screen.getByRole('checkbox', { name: 'GitHub PRs' });
    await waitFor(() => expect(toggle).toBeDisabled());
    expect(toggle).toHaveAttribute('title', 'GitHub CLI (gh) is not installed');
    // 原因必须**可见**：disabled 控件连 hover 都可能不触发，只挂 title 等于没说。
    expect(screen.getByText('GitHub CLI (gh) is not installed')).toBeInTheDocument();
    expect(gitApi.listPrs).not.toHaveBeenCalled();
  });
});

describe('TasksPanel — PR 详情（只读）', () => {
  async function openPrDetail() {
    const user = userEvent.setup();
    api.listWorkItems.mockResolvedValue([item('wi_1', 'Backlog', '修复登录')]);
    gitApi.listPrs.mockResolvedValue([pr()]);
    gitApi.viewPr.mockResolvedValue({
      number: 128,
      title: '统一任务中心：PR provider',
      state: 'OPEN',
      body: 'PR 正文',
      author: 'tincopper',
      headRefName: 'feat/pr-provider',
      baseRefName: 'main',
      url: 'https://github.com/tincopper/neeko/pull/128',
      createdAt: '2026-11-02T10:00:00Z',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      isDraft: false,
      isCrossRepository: false,
      statusCheckRollup: null,
    });
    render(<TasksPanel projectId="p1" repoLabel="neeko" />);
    await screen.findByRole('region', { name: 'Backlog column' });

    await user.click(screen.getByRole('checkbox', { name: 'GitHub PRs' }));
    await user.click(
      await within(column('Review')).findByRole('button', {
        name: 'Open work item 统一任务中心：PR provider',
      }),
    );
    return user;
  }

  it('显示 base ← head、作者与 #编号，且没有编辑 / 删除（PR 是只读的）', async () => {
    await openPrDetail();

    const detail = screen.getByRole('region', { name: 'Work item detail' });
    expect(detail).toHaveTextContent('main ← feat/pr-provider');
    expect(detail).toHaveTextContent('tincopper');
    expect(detail).toHaveTextContent('neeko#128');
    expect(within(detail).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(within(detail).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('「在浏览器打开」用的是 viewPr 给的 url（不是自己拼的）', async () => {
    const user = await openPrDetail();

    const open = screen.getByRole('button', { name: 'Open in browser' });
    await waitFor(() => expect(open).toBeEnabled());
    await user.click(open);

    expect(browserApi.openInDefaultBrowser).toHaveBeenCalledWith(
      'https://github.com/tincopper/neeko/pull/128',
    );
  });
});

describe('TasksPanel — 岛屿布局（design §4.2b）', () => {
  /**
   * 三层表面必须**互不相同**，这是「看得出岛"的唯一判据。
   *
   * 这次反复了两轮，两轮都「有 Island 元素"却看不出岛，根因是同一类：
   *
   * | 轮次 | 写法 | 为什么看不出 |
   * | --- | --- | --- |
   * | 第一轮 | 面板根 `bg-bg-primary` 被外层 `<Island>` 包住 | 岛被填成海 |
   * | 第二轮 | 根无海面 + 空态岛也是 `bg-bg-secondary` | 岛与海同色、岛与分区同色 |
   *
   * 断言「有 Island 元素"永远抓不到这类问题 —— 它能抓的只有「三个表面 token 是否不同"。
   */
  it('岛 / 岛内分区是两个不同表面（海面由中心区容器给）', async () => {
    api.listWorkItems.mockResolvedValue([item('wi_1', 'Backlog', '修复登录')]);
    render(<TasksPanel projectId="p1" />);
    await screen.findByRole('region', { name: 'Backlog column' });

    // 岛：主岛（`bg-secondary`）
    expect(screen.getByTestId('tasks-main-island')).toHaveClass('bg-bg-secondary');
    // 岛内分区：看板列（`bg-tertiary`）—— 与岛不同表面，否则列与岛同色就等于没有分区
    expect(screen.getByRole('region', { name: 'Backlog column' })).toHaveClass('bg-bg-tertiary');
    // 海面（`bg-bg-primary`）归 `AppCenter` 的中心容器，本面板**不自写** —— 断言由
    // `AppCenter.test.tsx` 的「中心视图共用同一个外层容器」覆盖（那里才有海面）。
  });

  /**
   * 往上找最近的岛屿外壳（判据 = `ISLAND_CLASS` 的 `rounded-lg`）。
   *
   * 这里必须走 `parentElement`：Testing Library 没有「取最近的、匹配某 class 的祖先"的查询，
   * 而这条判据问的正是**结构**（岛壳在不在这一层）。用 `closest()` 也只能拿到元素本身，
   * 判不出「它是不是岛"—— 所以此处直连 DOM 是判据本身的要求，不是图省事。
   */
  // eslint-disable-next-line testing-library/no-node-access
  /**
   * 往上找**岛**（`ISLAND_CLASS` 的宿主）。
   *
   * # 判据不能用 `rounded-lg`（2026-11-03 二次修正）
   *
   * 上一版拿 `rounded-lg` 当「是岛"的判据 —— 用户确认「列变圆角块"后，列**也有**圆角，
   * 于是 `islandOf(列)` 会返回列自己，把「列住在主岛里"误判成「列是另一座岛"。
   *
   * 岛的真实特征是 `ISLAND_CLASS` 那一整套（`flex flex-col` + `overflow-hidden`
   * + `shadow-sm`）。三个都命中才算岛 —— column的圆角块刻意**没有阴影**，正是为了这条判据
   * 能把它与岛分开。
   */
  function islandOf(element: HTMLElement): HTMLElement | null {
    const ISLAND_TOKENS = ['flex-col', 'overflow-hidden', 'shadow-sm'];
    let node: HTMLElement | null = element;
    while (node !== null) {
      const tokens = (node.getAttribute('class') ?? '').split(' ');
      if (ISLAND_TOKENS.every((token) => tokens.includes(token))) return node;
      // eslint-disable-next-line testing-library/no-node-access
      node = node.parentElement;
    }
    return null;
  }

  /**
   * 空态 / 加载中 / 无匹配：**居中 + 正文级字阶**（2026-11-03，对齐全仓惯例）。
   *
   * 全仓面板内的空态形态是 `flex items-center justify-center h-full` + 正文级字号
   * （`PromptListSection`：`text-[var(--font-size)] text-text-secondary text-center`；
   * `PullRequestsPanelWrapper` / `GitControlPanelWrapper`：`items-center justify-center`）。
   *
   * Tasks 曾经是**贴左上角**的 `px-2 py-3 text-micro`：`text-micro` 是 10px（字阶表里
   * 它是「时间戳、快捷键 hint"专用），拿它当空态正文等于把「面板没数据"写成脚注。
   * 而且不居中的空态读起来像「面板没渲染完，漏出一段文字"。
   *
   * 判据两条：① 容器居中（`items-center` + `justify-center`）；② 文案不是 `text-micro`。
   */
  it('四档「无行」状态：居中 + 不用 hint 字阶（10px 当正文等于写成脚注）', async () => {
    // ① 没有绑定项目
    render(<TasksPanel projectId={null} />);
    // 容器（role=status）居中撑满；文案住在里面，用 Testing Library 的角色查询取，
    // 不走 `querySelector`（那会绕过无障碍树，也让「文案是否可读"失去读屏侧的保证）。
    const statusRegion = screen.getByRole('status');
    expect(statusRegion).toHaveClass('items-center', 'justify-center');
    expect(statusRegion).not.toHaveClass('text-micro');

    const selectPrompt = screen.getByText('Select a project');
    expect(selectPrompt).not.toHaveClass('text-micro');
    expect(selectPrompt).toHaveClass('text-meta');
  });

  /**
   * 岛内 header **不自画表面**（2026-11-03，对齐全仓惯例）。
   *
   * 全仓 `<header>` 自带 `bg-bg-*` 的只有两处，都在本 feature（`TasksPanelHeader` 与
   * `WorkItemDetail`）；Library 的 `LibraryToolbar`、Git 的 `GitControlPanel`、
   * 编辑器的 `PaneTabBar`、Library 的 `McpProjectContent` **全都只写
   * `border-b` 而透传岛底**。
   *
   * 判据是「这一层有没有改变表面"：header 与它所在的岛是**同一个平面**，只靠一条
   * `border-b` 划界。给它刷一层 `bg-bg-tertiary` 会让它读起来像「头部是另一块面板"——
   * 而它明明在同一座岛里。
   *
   * `bg-bg-tertiary` 的正确位置是**分区**（看板列 / 列表容器）与**控件**（输入框 / 按钮），
   * 不是「满宽横条"。一条满宽的 tertiary 横条还会与它下面分区同色，两处直接连成一片。
   */
  it('岛内 header 只靠 border 划界，不自画表面（与 Library / Git / 编辑器同款）', async () => {
    api.listWorkItems.mockResolvedValue([item('wi_1', 'Backlog', '修复登录')]);
    render(<TasksPanel projectId="p1" />);
    await screen.findByRole('region', { name: 'Backlog column' });

    const header = screen.getByRole('banner');
    // 分隔靠 border
    expect(header).toHaveClass('border-b', 'border-border');
    // 表面透传岛底：不许自刷背景
    expect(header).not.toHaveClass('bg-bg-tertiary');
    expect(header).not.toHaveClass('bg-bg-secondary');
    expect(header).not.toHaveClass('bg-bg-primary');
  });

  it('本面板**不自写几何**：背景 / 内缩 / 圆角 / 高度都归中心区容器', async () => {
    api.listWorkItems.mockResolvedValue([item('wi_1', 'Backlog', '修复登录')]);
    render(<TasksPanel projectId="p1" />);
    await screen.findByRole('region', { name: 'Backlog column' });

    // 面板根（快捷键容器）：只做布局，不承担海面 / 内缩 / 圆角。
    // 一旦它自写这些，就会比其它中心视图多缩一圈 —— 那正是「对不齐"的直接原因。
    // eslint-disable-next-line testing-library/no-node-access
    const root = screen.getByTestId('tasks-main-island').parentElement;
    const classes = (root?.className ?? '').split(/\s+/);
    expect(classes).not.toContain('p-1.5');
    expect(classes).not.toContain('p-2');
    expect(classes.some((c) => c.startsWith('rounded'))).toBe(false);
    expect(classes).not.toContain('bg-bg-primary');
  });

  it('整块面板是「主岛 | 详情岛」双岛（与 Library 同构），岛内不再套岛', async () => {
    api.listWorkItems.mockResolvedValue([item('wi_1', 'Backlog', '修复登录')]);
    render(<TasksPanel projectId="p1" />);
    await screen.findByRole('region', { name: 'Backlog column' });

    // 主岛：View与看板都在**同一座岛**里（Library 的 detail 岛就是这个形状：
    // toolbar + content 同在岛内，不是各自漂在海面）。
    const main = screen.getByTestId('tasks-main-island');
    expect(main).toHaveClass('rounded-lg', 'bg-bg-secondary');
    expect(within(main).getByRole('group', { name: 'View' })).toBeInTheDocument();
    expect(within(main).getByRole('region', { name: 'Backlog column' })).toBeInTheDocument();

    // 反证：看板列**不是岛**（它曾是 `ISLAND_CLASS`，导致「每列一座浮岛漂在海面"）。
    // 注意它现在**有圆角**（用户确认的圆角块），但**没有阴影** —— 那正是「块"与「浮岛"
    // 的分界，也是 `islandOf` 能区分它们的原因。
    expect(islandOf(screen.getByRole('region', { name: 'Backlog column' }))).toBe(main);
  });

  it('头部与内容都在同一座主岛里（不是各自漂在海面）', async () => {
    api.listWorkItems.mockResolvedValue([item('wi_1', 'Backlog', '修复登录')]);
    render(<TasksPanel projectId="p1" />);
    await screen.findByRole('region', { name: 'Backlog column' });

    // 头部：View按钮住在主岛里（裸 `border-b` 横条不算岛）
    expect(islandOf(screen.getByRole('group', { name: 'View' }))).toBe(
      screen.getByTestId('tasks-main-island'),
    );
    // 看板列也住在主岛里 —— 它**不是**第二座岛（曾经是，导致「一排浮岛漂在海面"）
    expect(islandOf(screen.getByRole('region', { name: 'Backlog column' }))).toBe(
      screen.getByTestId('tasks-main-island'),
    );
    // 反证：列**不是岛**。判据是「无阴影"而不是「无圆角"——
    // 用户 2026-11-03 确认列要圆角块（有圆角），但**不要阴影**（有阴影就退回浮岛形态）。
    const column = screen.getByRole('region', { name: 'Backlog column' });
    expect(column).toHaveClass('rounded-lg');
    expect(column).not.toHaveClass('shadow-sm');
  });

  it('空态住在主岛内的**分区**里（bg-tertiary，不是同色的第二座岛）', async () => {
    // 空项目：最容易被画成「裸 <p> 漂在海面上"的那一档
    api.listWorkItems.mockResolvedValue([]);
    render(<TasksPanel projectId="p1" />);

    const empty = await screen.findByText('No work items yet');
    // 它在主岛里（`islandOf` 找到的是主岛），且自己带一个**不同表面**的分区容器：
    // 若分区也用 `bg-secondary`，与主岛同色叠同色 ⇒ 视觉上仍是一片白（这次反复的根因）。
    expect(islandOf(empty)).toBe(screen.getByTestId('tasks-main-island'));
    expect(screen.getByTestId('tasks-content-region')).toHaveClass('bg-bg-tertiary');
  });

  it('没有绑定项目时占位也住在主岛内的分区里', async () => {
    render(<TasksPanel projectId={null} />);

    const placeholder = await screen.findByText('Select a project');
    expect(islandOf(placeholder)).toBe(screen.getByTestId('tasks-main-island'));
    expect(screen.getByTestId('tasks-content-region')).toHaveClass('bg-bg-tertiary');
  });

  it('搜不到时「没有匹配」也住在主岛内的分区里', async () => {
    const user = userEvent.setup();
    api.listWorkItems.mockResolvedValue([item('wi_1', 'Backlog', '修复登录')]);
    render(<TasksPanel projectId="p1" />);
    await screen.findByRole('region', { name: 'Backlog column' });

    await user.type(screen.getByLabelText('Search work items'), 'zzz');

    expect(islandOf(screen.getByText('No matching work items'))).toBe(
      screen.getByTestId('tasks-main-island'),
    );
  });

  it('详情是第二座岛（不是 absolute 覆盖层），且可拖拽分栏', async () => {
    const user = userEvent.setup();
    api.listWorkItems.mockResolvedValue([item('wi_1', 'Backlog', '修复登录')]);
    render(<TasksPanel projectId="p1" />);

    await user.click(await screen.findByRole('button', { name: 'Open work item 修复登录' }));
    const detail = screen.getByRole('region', { name: 'Work item detail' });

    // 覆盖层会把整座岛换掉：用户丢掉看板与滚动位置，回来时列全重建
    expect(detail).not.toHaveClass('absolute');
    expect(detail).not.toHaveClass('bg-bg-primary');
    // 它住在自己的岛里（ResizablePanel id = work-items-detail）
    expect(screen.getByTestId('work-items-detail-island')).toHaveClass(
      'rounded-lg',
      'bg-bg-secondary',
    );
    // 两座岛之间有可拖拽的分隔条
    expect(screen.getByRole('separator')).toBeInTheDocument();
    // 看板仍然可见（不是被覆盖掉的）
    expect(screen.getByRole('region', { name: 'Backlog column' })).toBeInTheDocument();
  });

  it('List 视图是「列表岛 │ 详情岛」的同一条分栏契约', async () => {
    const user = userEvent.setup();
    api.listWorkItems.mockResolvedValue([item('wi_1', 'Backlog', '修复登录')]);
    render(<TasksPanel projectId="p1" />);
    await screen.findByRole('region', { name: 'Backlog column' });

    await user.click(screen.getByRole('button', { name: 'List' }));
    await user.click(screen.getByRole('button', { name: 'Open work item 修复登录' }));

    expect(screen.getByRole('list', { name: 'Work items' })).toBeInTheDocument();
    expect(screen.getByTestId('work-items-detail-island')).toBeInTheDocument();
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('没有选中项时不渲染详情岛（不留一座空岛白占宽度）', async () => {
    api.listWorkItems.mockResolvedValue([item('wi_1', 'Backlog', '修复登录')]);
    render(<TasksPanel projectId="p1" />);
    await screen.findByRole('region', { name: 'Backlog column' });

    expect(screen.queryByTestId('work-items-detail-island')).not.toBeInTheDocument();
  });
});
