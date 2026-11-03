/**
 * `TasksPanel`：视图切换、搜索、快捷键、以及四条**跨层**链路。
 *
 * 只 mock **api 层**（`../../api/workItemsApi` 与 `../../../git/api/gitApi`），让 store 与
 * provider hook 真实跑 —— 这样乐观流转、失败回滚、删除的撤销窗口、PR 开关的去重在用例里都是
 * 真行为，而不是被 mock 掉的假设（`workItemsStore.test.ts` 钉的是 store 的状态迁移、
 * `useGithubPrs.test.tsx` 钉的是开关的因果链，这里钉的是「用户点下去会看到什么」）。
 *
 * 覆盖：
 * 1. 默认 Board；切 List 行数一致；视图选择**活过卸载**（design §4.5）；
 * 2. 搜索过滤；
 * 3. 创建 → 卡片出现（并把新卡片滚进视野）→ 删除 → UndoBar → 撤销恢复；
 * 4. `transition` 失败 → 错误 toast + 卡片回到原列；
 * 5. 快捷键：按键 → 对应的动作被调（判据本身由 `utils/__tests__/shortcuts.test.ts` 钉）；
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
 * 不去 mock `invoke`。默认「gh 已装且已登录、没有 PR」，各用例按需覆盖。
 */
const gitApi = vi.hoisted(() => ({
  isGhInstalled: vi.fn(),
  isGhAuthenticated: vi.fn(),
  listPrs: vi.fn(),
  viewPr: vi.fn(),
}));

/**
 * 「在浏览器打开」走 `features/browser/api/browserApi`（既有 api 层）：真调会 `invoke`，
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

/** 一条开着等 review 的 PR（`state: 'OPEN'` ⇒ 必须落在 Review 列）。 */
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
  return screen.getByRole('button', { name: `打开工作项 ${name}` });
}

function column(stage: string): HTMLElement {
  return screen.getByRole('region', { name: `${stage} 列` });
}

beforeEach(() => {
  useWorkItemsStore.getState().reset();
  // 视图偏好真的落在 localStorage 上（design §4.5）：不清会让上一条用例的 `list` 漏到下一条，
  // 于是「默认是 Board」在整文件跑时忽然变成「默认是 List」。
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

    expect(await screen.findByRole('region', { name: 'Backlog 列' })).toBeInTheDocument();
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
    await screen.findByRole('region', { name: 'Backlog 列' });

    await user.click(screen.getByRole('button', { name: 'List' }));

    expect(screen.getAllByRole('button', { name: /^打开工作项/ })).toHaveLength(3);
    expect(screen.queryByRole('region', { name: 'Backlog 列' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('搜索按标题过滤；搜不到时说明「没有匹配」而不是「还没有工作项」', async () => {
    const user = userEvent.setup();
    api.listWorkItems.mockResolvedValue([
      item('wi_1', 'Backlog', '修复登录'),
      item('wi_2', 'Ready', '重构看板'),
    ]);
    render(<TasksPanel projectId="p1" />);
    await screen.findByRole('region', { name: 'Backlog 列' });

    await user.type(screen.getByLabelText('搜索工作项'), '看板');
    expect(screen.getAllByRole('button', { name: /^打开工作项/ })).toHaveLength(1);
    expect(card('重构看板')).toBeInTheDocument();

    await user.type(screen.getByLabelText('搜索工作项'), 'zzz');
    expect(screen.getByText('没有匹配的工作项')).toBeInTheDocument();
    expect(screen.queryByText('还没有工作项')).not.toBeInTheDocument();
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
    await user.click(await screen.findByRole('button', { name: '创建第一条工作项' }));
    await user.type(screen.getByLabelText('标题'), '新工作项');
    await user.selectOptions(screen.getByLabelText('阶段'), 'Ready');
    await user.click(screen.getByRole('button', { name: '创建' }));

    // 卡片落在 Ready 列（`+ 新建` 的预填 stage 经对话框传给 create）。
    const ready = await screen.findByRole('region', { name: 'Ready 列' });
    expect(within(ready).getByRole('button', { name: '打开工作项 新工作项' })).toBeInTheDocument();
    expect(api.createWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1', title: '新工作项', stage: 'Ready' }),
    );

    // 打开详情 → 删除 → 撤销条出现。
    await user.click(card('新工作项'));
    await user.click(screen.getByRole('button', { name: '删除' }));

    expect(await screen.findByText('已删除「新工作项」')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '打开工作项 新工作项' })).not.toBeInTheDocument();

    // 撤销：命中的是同一个 5 秒窗口，所以 store 里那行还没被真删（`deleteWorkItem` 未发出）。
    await user.click(screen.getByRole('button', { name: '撤销' }));

    expect(await screen.findByRole('button', { name: '打开工作项 新工作项' })).toBeInTheDocument();
    expect(screen.queryByText('已删除「新工作项」')).not.toBeInTheDocument();
    expect(api.deleteWorkItem).not.toHaveBeenCalled();
  });
});

describe('TasksPanel — 流转失败', () => {
  it('失败时 toast 报原因，卡片回到原列（store 回滚 + UI 提示）', async () => {
    const user = userEvent.setup();
    api.listWorkItems.mockResolvedValue([item('wi_1', 'Backlog', '只该在 Backlog')]);
    api.transitionWorkItem.mockRejectedValue(new Error('cannot jump stages'));
    render(<TasksPanel projectId="p1" />);

    await user.click(await screen.findByRole('button', { name: '打开工作项 只该在 Backlog' }));
    const detail = screen.getByRole('region', { name: '工作项详情' });
    const rail = within(detail).getByRole('group', { name: '阶段轨道' });
    await user.click(within(rail).getByRole('button', { name: 'Ready' }));

    // `transition` 的失败不写 store.errors ⇒ 调用点必须自己 toast（否则卡片悄悄弹回，一个字都不说）。
    expect(await screen.findByText('流转失败：cannot jump stages')).toBeInTheDocument();
    expect(
      within(column('Backlog')).getByRole('button', { name: '打开工作项 只该在 Backlog' }),
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
    await screen.findByRole('region', { name: 'Backlog 列' });
    await focusPanel(user);

    await user.keyboard('{Meta>}n{/Meta}');

    expect(await screen.findByLabelText('标题')).toBeInTheDocument();
  });

  it('Delete 删除选中的那一行（与详情面板的删除是同一个动作）', async () => {
    const user = userEvent.setup();
    api.listWorkItems.mockResolvedValue([item('wi_1', 'Backlog', '要删掉的')]);
    render(<TasksPanel projectId="p1" />);

    await user.click(await screen.findByRole('button', { name: '打开工作项 要删掉的' }));
    await user.keyboard('{Delete}');

    expect(await screen.findByText('已删除「要删掉的」')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '打开工作项 要删掉的' })).not.toBeInTheDocument();
  });

  it('焦点在搜索框里时 Backspace 只是输入，不删行', async () => {
    const user = userEvent.setup();
    api.listWorkItems.mockResolvedValue([item('wi_1', 'Backlog', '别删我')]);
    render(<TasksPanel projectId="p1" />);

    await user.click(await screen.findByRole('button', { name: '打开工作项 别删我' }));
    await user.click(screen.getByLabelText('搜索工作项'));
    await user.keyboard('{Backspace}');

    expect(screen.getByRole('button', { name: '打开工作项 别删我' })).toBeInTheDocument();
    expect(screen.queryByText(/已删除/)).not.toBeInTheDocument();
  });

  it('Escape 关闭详情面板', async () => {
    const user = userEvent.setup();
    api.listWorkItems.mockResolvedValue([item('wi_1', 'Backlog', '看一下')]);
    render(<TasksPanel projectId="p1" />);

    await user.click(await screen.findByRole('button', { name: '打开工作项 看一下' }));
    expect(screen.getByRole('region', { name: '工作项详情' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('region', { name: '工作项详情' })).not.toBeInTheDocument();
  });

  it('对话框开着时 Escape 只关对话框，不删背后那一行', async () => {
    const user = userEvent.setup();
    api.listWorkItems.mockResolvedValue([item('wi_1', 'Backlog', '别在编辑时删我')]);
    render(<TasksPanel projectId="p1" />);

    await user.click(await screen.findByRole('button', { name: '打开工作项 别在编辑时删我' }));
    await user.click(screen.getByRole('button', { name: '编辑' }));
    expect(await screen.findByLabelText('标题')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    // 对话框关掉了（Radix Dialog 是 Escape 的唯一所有者），行还在。
    expect(screen.queryByLabelText('标题')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开工作项 别在编辑时删我' })).toBeInTheDocument();
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
    await screen.findByRole('region', { name: 'Backlog 列' });

    await user.click(screen.getByRole('button', { name: '+ 新建' }));
    await user.type(screen.getByLabelText('标题'), '新的');
    await user.click(screen.getByRole('button', { name: '创建' }));

    await screen.findByRole('button', { name: '打开工作项 新的' });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    // 滚的必须是**新**那一行，不是列表里任意一行。
    expect(scrollIntoView.mock.instances[0]).toBe(
      screen.getByRole('button', { name: '打开工作项 新的' }),
    );
  });

  it('列表自己变了（手动刷新）不滚动：那不是新建', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    scrollIntoView.mockClear();
    api.listWorkItems.mockResolvedValue([item('wi_1', 'Backlog', '旧的')]);
    render(<TasksPanel projectId="p1" />);
    await screen.findByRole('region', { name: 'Backlog 列' });

    // 刷新拿回一个**多出来**的行（延迟提交的删除失败时后端仍持有它，就是这个形状）。
    api.listWorkItems.mockResolvedValue([
      item('wi_back', 'Backlog', '回魂的行'),
      item('wi_1', 'Backlog', '旧的'),
    ]);
    await user.click(screen.getByRole('button', { name: '刷新工作项' }));

    await screen.findByRole('button', { name: '打开工作项 回魂的行' });
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
    await screen.findByRole('region', { name: 'Backlog 列' });

    const toggle = screen.getByRole('checkbox', { name: 'GitHub PRs' });
    expect(toggle).not.toBeChecked();
    expect(gitApi.listPrs).not.toHaveBeenCalled();

    await user.click(toggle);

    // OPEN ⇒ Review 列（不是 In Progress：开着的 PR 是「等 review」，不是「还没开始」）。
    expect(
      await within(column('Review')).findByRole('button', {
        name: '打开工作项 统一任务中心：PR provider',
      }),
    ).toBeInTheDocument();
    expect(gitApi.listPrs).toHaveBeenCalledTimes(1);

    await user.click(toggle);

    expect(
      screen.queryByRole('button', { name: '打开工作项 统一任务中心：PR provider' }),
    ).not.toBeInTheDocument();
    // 关掉再开不重拉（同一 workspace 只拉一次），所以这里仍然只有第一次那一声。
    expect(gitApi.listPrs).toHaveBeenCalledTimes(1);
  });

  it('gh 不可用：勾选框 disabled、原因可见且有 title，且不发任何 PR 请求', async () => {
    api.listWorkItems.mockResolvedValue([item('wi_1', 'Backlog', '修复登录')]);
    gitApi.isGhInstalled.mockResolvedValue(false);
    render(<TasksPanel projectId="p1" />);
    await screen.findByRole('region', { name: 'Backlog 列' });

    const toggle = screen.getByRole('checkbox', { name: 'GitHub PRs' });
    await waitFor(() => expect(toggle).toBeDisabled());
    expect(toggle).toHaveAttribute('title', '未安装 GitHub CLI（gh）');
    // 原因必须**可见**：disabled 控件连 hover 都可能不触发，只挂 title 等于没说。
    expect(screen.getByText('未安装 GitHub CLI（gh）')).toBeInTheDocument();
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
    await screen.findByRole('region', { name: 'Backlog 列' });

    await user.click(screen.getByRole('checkbox', { name: 'GitHub PRs' }));
    await user.click(
      await within(column('Review')).findByRole('button', {
        name: '打开工作项 统一任务中心：PR provider',
      }),
    );
    return user;
  }

  it('显示 base ← head、作者与 #编号，且没有编辑 / 删除（PR 是只读的）', async () => {
    await openPrDetail();

    const detail = screen.getByRole('region', { name: '工作项详情' });
    expect(detail).toHaveTextContent('main ← feat/pr-provider');
    expect(detail).toHaveTextContent('tincopper');
    expect(detail).toHaveTextContent('neeko#128');
    expect(within(detail).queryByRole('button', { name: '编辑' })).not.toBeInTheDocument();
    expect(within(detail).queryByRole('button', { name: '删除' })).not.toBeInTheDocument();
  });

  it('「在浏览器打开」用的是 viewPr 给的 url（不是自己拼的）', async () => {
    const user = await openPrDetail();

    const open = screen.getByRole('button', { name: '在浏览器打开' });
    await waitFor(() => expect(open).toBeEnabled());
    await user.click(open);

    expect(browserApi.openInDefaultBrowser).toHaveBeenCalledWith(
      'https://github.com/tincopper/neeko/pull/128',
    );
  });
});
