/**
 * `TasksPanelHeader`：面板工具栏的**结构与对齐全仓惯例**。
 *
 * # 为什么要单独一个文件
 *
 * 工具栏的三处偏离都是「结构/惯例"问题，与业务无关：
 *
 * | # | 偏离 | 全仓惯例 |
 * | --- | --- | --- |
 * | 1 | 用字符 `↻` 当刷新图标 | lucide 图标（`RefreshCw`），全仓 `↻` 只在 work-items 出现 |
 * | 2 | 搜索框没有图标、没有清空按钮 | `LibrarySearchBar`：前置 `Search` 图标 + `X` 清空 |
 * | 3 | GitHub 勾选框挤在工具栏中间 | 它是**Sources开关**，不是每帧都要点的Actions |
 *
 * 塞进 `TasksPanel.test.tsx` 会让那个文件更长（它已经有 30+ items业务用例），而这些判据
 * 只关心「这个 header 长什么样"。分开也更容易在重构工具栏时单独跑。
 *
 * # 判据为什么钉「有图标元素"而不是「长得像图标"
 *
 * 字符图标与 SVG 图标在 DOM 上都只是一个子节点。区分它们的唯一可靠办法是**查询图标组件
 * 的可见特征**：lucide 渲染成 `<svg>`。所以断言「刷新按钮里有一个 svg"——
 * 写成 `↻` 文本时会立刻红。
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import TasksPanelHeader from '../TasksPanelHeader';

const BASE_PROPS: React.ComponentProps<typeof TasksPanelHeader> = {
  view: 'board',
  onSelectView: vi.fn(),
  search: '',
  onSearchChange: vi.fn(),
  onRefresh: vi.fn(),
  onNew: vi.fn(),
  githubEnabled: false,
  githubAvailability: 'ready',
  githubBlockedReason: null,
  onToggleGithub: vi.fn(),
};

function renderHeader(overrides: Partial<typeof BASE_PROPS> = {}): HTMLElement {
  // 返回渲染容器：图标是 `aria-hidden` 装饰元素，Testing Library 的角色查询看不到它，
  // 只能用 `container.querySelectorAll`（官方文档认可的容器入口）。
  return render(<TasksPanelHeader {...BASE_PROPS} {...overrides} />).container;
}

describe('TasksPanelHeader — 图标用 lucide，不用字符', () => {
  it('刷新按钮里是 SVG 图标，不是 `↻` 字符', () => {
    renderHeader();
    const refresh = screen.getByRole('button', { name: 'Refresh work items' });

    // lucide 渲染成 `<svg>`，且**默认 `aria-hidden`**（图标是装饰，名称由按钮的
    // `aria-label` 给）—— 所以不能按 `role="img"` 查，要按元素类型查。
    expect(within(refresh).getByTestId('icon-refresh')).toBeInTheDocument();
    // 反证：不能靠一个字符当图标
    expect(refresh.textContent?.trim()).toBe('');
  });

  it('新建按钮的 `+` 是图标，不是文本前缀', () => {
    renderHeader();
    const newButton = screen.getByRole('button', { name: 'New' });

    // 文本里不含裸 `+`：图标提供那个视觉符号，`aria-hidden` 让它对读屏不可见
    expect(within(newButton).getByTestId('icon-new')).toBeInTheDocument();
    expect(newButton.textContent?.trim()).toBe('New');
  });

  it('搜索框前置放大镜图标', () => {
    renderHeader();
    expect(screen.getByTestId('icon-search')).toBeInTheDocument();
  });

  it('有内容时出现清空按钮，点它把搜索置空', async () => {
    const onSearchChange = vi.fn();
    renderHeader({ search: '看板', onSearchChange });

    const clear = screen.getByRole('button', { name: 'Clear search' });
    await userEvent.click(clear);
    expect(onSearchChange).toHaveBeenCalledWith('');
  });

  it('搜索为空时**不**渲染清空按钮（空框上的叉号是噪声）', () => {
    renderHeader({ search: '' });
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
  });
});

describe('TasksPanelHeader — 分组与布局', () => {
  /**
   * 工具栏的**分组顺序**是契约：`View | 搜索 | Sources开关 | Actions`。
   *
   * 现状把 GitHub 勾选框放在搜索与Actions**之间**，于是 `flex-1` 的搜索框被两侧各挤一次；
   * 窗口窄时先换行的是「GitHub PRs"，把主Actions（新建 / 刷新）推到第二行。
   *
   * 判据是 DOM 顺序：Actions 组必须在 Sources 开关**之后**，且 Actions 组内部按「主 → 次」排。
   *
   * # 为什么必须把 Sources 也放进顺序数组（2026-11-03 三次修正）
   *
   * 首版只断言 `View → 搜索 → 刷新按钮` 三件。把 Sources 与 Actions 两个组**整块对调**
   * 后，首版仍 10 条全绿 —— 因为那三件的相对顺序没变。而 spec 写的契约是
   * **四分**：`[视图切换] [搜索] [数据源开关] [动作]`。漏掉的正是中间那两组的次序，
   * 而那正是这条用例存在的理由（「开关不该夹在搜索与动作之间」）。
   */
  it('四个分区按「View → 搜索 → Sources → Actions」的顺序出现', () => {
    renderHeader();

    const header = screen.getByRole('banner');
    const order = [
      within(header).getByRole('group', { name: 'View' }),
      within(header).getByLabelText('Search work items'),
      within(header).getByRole('group', { name: 'Sources' }),
      within(header).getByRole('group', { name: 'Actions' }),
    ];

    // 用 `compareDocumentPosition` 判顺序，不靠 snapshot（snapshot 会锁死整个 DOM 结构）
    for (let i = 1; i < order.length; i += 1) {
      const relation = order[i - 1].compareDocumentPosition(order[i]);
      expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('GitHub 开关与动作组视觉上分离（开关不是主动作）', () => {
    renderHeader();

    // 按 `aria-label` 取两个组，不靠 `closest` 爬 DOM（那会绕过无障碍树，
    // 且组件结构一变就静默失效）。两个组**都存在且不同**，就是「分离」的证据。
    const dataSourceGroup = screen.getByRole('group', { name: 'Sources' });
    const actionGroup = screen.getByRole('group', { name: 'Actions' });

    expect(dataSourceGroup).not.toBe(actionGroup);
    // 开关住在数据源组，主按钮住在动作组 —— 各归其位
    expect(
      within(dataSourceGroup).getByRole('checkbox', { name: 'GitHub PRs' }),
    ).toBeInTheDocument();
    expect(within(actionGroup).getByRole('button', { name: 'New' })).toBeInTheDocument();
    // 反证：动作组里不该有开关（同一组里既有开关又有主按钮，读屏会把它们当成一件事）
    expect(within(actionGroup).queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('刷新按钮有 aria-label（图标按钮没有可见文字，必须靠它可读）', () => {
    renderHeader();
    expect(screen.getByRole('button', { name: 'Refresh work items' })).toHaveAccessibleName(
      'Refresh work items',
    );
  });
});

describe('TasksPanelHeader — 字阶对齐全仓', () => {
  /**
   * 工具栏里的**Actions**用正文级字阶，不用 hint 的 `text-micro`（10px）。
   *
   * `text-micro` 在字阶表里的用途是「时间戳、快捷键 hint"—— 拿它当按钮字号，
   * 会让「新建 / 刷新"看起来像注释而不是可点的入口。
   */
  it('新建按钮不是 hint 字阶', () => {
    renderHeader();
    const newButton = screen.getByRole('button', { name: 'New' });

    const tokens = new Set(newButton.className.split(/\s+/));
    expect(tokens).not.toContain('text-micro');
    // 反证：它必须**有**一个正文字阶（不能既不是 micro 也不是任何一档）
    expect(tokens.has('text-meta') || newButton.className.includes('text-[13px]')).toBe(true);
  });

  it('刷新按钮不是 hint 字阶', () => {
    renderHeader();
    const refresh = screen.getByRole('button', { name: 'Refresh work items' });

    const tokens = new Set(refresh.className.split(/\s+/));
    expect(tokens).not.toContain('text-micro');
  });
});
