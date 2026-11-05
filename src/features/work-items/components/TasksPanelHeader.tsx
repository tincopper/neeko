import { Plus, RefreshCw, Search, X } from 'lucide-react';
import React, { useCallback } from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { Input } from '@/ui/Input';

import type { GithubAvailability } from '../hooks/useGithubPrs';
import type { PanelView } from '../utils/viewPreference';

/**
 * Tasks 面板的头部：视图切换 + 新建 + 刷新 + 搜索。
 *
 * # 为什么抽成独立文件
 *
 * 头部是**纯呈现**：它不认识 store、不发 IPC，只把「用户按了什么」交给宿主
 * （[`TasksPanel`](./TasksPanel.tsx) 负责真动作）。抽出去的直接原因是 `check_component_size`
 * 的 300 行红线 —— 但判据不是行数，而是「这块没有任何状态」：抽走后宿主剩下的正好是
 * 「状态 + 动作 + 组合」。
 *
 * # 视图切换用 `aria-pressed` 而不是 tablist
 *
 * Board / List 是同一份数据的两种排布，不是两个内容面板（切过去不会挂载另一棵树）。
 * `tablist` 会向读屏承诺「Tab 键在面板间移动」，而这里只是两个互斥开关。
 *
 * # `TaskView` 的唯一定义点在 `utils/viewPreference.ts`
 *
 * 因为它不只是组件的 prop：它还要被持久化（design §4.5「记忆用户上次选择」）。在这里定义
 * 会让 `utils/` 反过来从 `components/` 取类型（依赖倒挂），所以类型住在 util 里，本文件只做
 * 别名 —— 现有的 `import type { TaskView } from './TasksPanelHeader'` 调用点不用改。
 *
 * # 头部是**主岛内的一条**（不是独立的岛，2026-11-03 修订）
 *
 * 层级是「海面 → 主岛（`TasksPanel` 的 `tasks-main-island`）→ 头部 + 内容」。
 * 头部若自己再套 `<Island>`，就是**岛中岛**：两层圆角阴影之间那条缝没有任何含义，
 * 而且看起来像「头部是另一个面板」。所以它**只给一条底边分割线**，表面透传岛底
 * （与 `LibraryToolbar` / `GitControlPanel` / `PaneTabBar` 同款），岛壳由主岛给。
 *
 * 曾经它是一条裸 `border-b` 横条直接压在海面底色上 —— 那是另一种极端（看起来不像面板的
 * 一部分）。现在两头都对：它在岛里，且不重复岛壳。
 *
 * # 工具栏的三分区（2026-11-03 三次修订）
 *
 * ```
 * [视图切换] [搜索框（flex-1）] [数据源开关] [动作：新建 / 刷新]
 * ```
 *
 * 三条偏离全仓惯例的地方已修正：
 *
 * | # | 旧 | 新 | 为什么 |
 * | --- | --- | --- | --- |
 * | 1 | 字符 `↻` 当刷新图标 | lucide `RefreshCw` | 全仓只有 work-items 用字符图标；字符图标不跟字号、在部分字体下被渲染成方块 |
 * | 2 | 搜索框裸 input | `Search` 前置图标 + `X` 清空 | `LibrarySearchBar` 同款；没有清空按钮时用户只能全选删除 |
 * | 3 | GitHub 勾选框夹在搜索与动作之间 | 独立「数据源」分组 | 它是**数据源开关**，不是每帧都点的动作。夹在中间时 `flex-1` 的搜索框被两侧各挤一次，窄窗口下先换行的是开关，把主动作推到第二行 |
 *
 * # GitHub 勾选框为什么在这个文件里
 *
 * 它是**开关**，不是数据面：本组件仍然不发 IPC、不认识 provider 实现，只把「用户勾了什么」
 * 与「为什么勾不了」交给宿主。勾不了的理由必须**可见**（右侧一行灰字）而不是只挂在 `title`
 * 上：`title` 要悬停才出现，而 `disabled` 的控件往往连 hover 事件都不触发 —— 一个沉默的
 * 灰勾选框与「坏了」在界面上无法区分。`title` 仍然给一份，供读屏/悬停时看到完整原因。
 */
export type TaskView = PanelView;

const VIEWS: { id: TaskView; label: string }[] = [
  { id: 'board', label: 'Board' },
  { id: 'list', label: 'List' },
];

interface ViewButtonProps {
  view: TaskView;
  label: string;
  active: boolean;
  onSelectView: (view: TaskView) => void;
}

const ViewButton: React.FC<ViewButtonProps> = React.memo(
  ({ view, label, active, onSelectView }) => {
    const handleClick = useCallback(() => onSelectView(view), [onSelectView, view]);

    return (
      <button
        type="button"
        aria-pressed={active}
        onClick={handleClick}
        className={cn(
          'rounded px-1.5 py-0.5 text-micro focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none',
          active ? 'bg-bg-selected text-text-primary' : 'text-text-secondary hover:bg-bg-hover',
        )}
      >
        {label}
      </button>
    );
  },
);
ViewButton.displayName = 'ViewButton';

interface TasksPanelHeaderProps {
  view: TaskView;
  onSelectView: (view: TaskView) => void;
  search: string;
  onSearchChange: (value: string) => void;
  /** 调 `workItemsStore.load(projectId)`（同项目在飞会被复用）+ 已启用的 provider 重拉。 */
  onRefresh: () => void;
  onNew: () => void;
  /** GitHub PR provider 的开关状态（design §8.3，默认关闭）。 */
  githubEnabled: boolean;
  /** `checking` / `blocked` 都不可勾：还不知道能不能用，与「确定不行」一样不能承诺。 */
  githubAvailability: GithubAvailability;
  /** 勾不了的原因（`null` = 可用）；两个位置都渲染：可见文字 + `title`。 */
  githubBlockedReason: string | null;
  onToggleGithub: (next: boolean) => void;
}

const TasksPanelHeader: React.FC<TasksPanelHeaderProps> = React.memo(
  ({
    view,
    onSelectView,
    search,
    onSearchChange,
    onRefresh,
    onNew,
    githubEnabled,
    githubAvailability,
    githubBlockedReason,
    onToggleGithub,
  }) => {
    const handleSearch = useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => onSearchChange(event.target.value),
      [onSearchChange],
    );

    const handleClearSearch = useCallback(() => onSearchChange(''), [onSearchChange]);

    return (
      // 一行横排 + `flex-wrap` 兑窄：本面板现在是**中心全宽视图**（tab 面板），
      // 搜索/筛选/视图切换原来竖着堆三行，在 1400px 宽的看板上方就是三条空得很厉害的栏。
      // 不写断点式响应式：同一份标记在窄窗口（用户把窗口拉窄）下靠 `wrap` 自动堆回去，
      // 而搜索框的 `min-w` 决定它什么时候才让位（低于它就不硬撑，而是换行）。
      //
      // 岛内 header：**不套 `<Island>`**（岛壳在主岛那一层，见文件头），
      // 也**不自刷 `bg-bg-*`** —— 表面透传岛底，只靠 `border-b` 划界。
      // 全仓同款：`LibraryToolbar` / `GitControlPanel` / `PaneTabBar` / `McpProjectContent`
      // 都只写 `border-b`。刷一层 `bg-bg-tertiary` 有两个后果：读起来像「头部是另一块面板」
      // （而它明明在同一座岛里），且一条满宽 tertiary 横条会与它下面的分区（也是 tertiary）
      // 直接连成一片、分隔线形同虚设。
      <header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border px-2.5 py-2">
        {/* ① 视图切换：互斥开关，不是 tablist（见文件头） */}
        <div role="group" aria-label="View" className="flex shrink-0 items-center gap-0.5">
          {VIEWS.map((option) => (
            <ViewButton
              key={option.id}
              view={option.id}
              label={option.label}
              active={view === option.id}
              onSelectView={onSelectView}
            />
          ))}
        </div>

        {/* ② 搜索：`flex-1` 吃掉剩余宽度。前置图标 + 有内容才出现的清空按钮
            （`LibrarySearchBar` 同款）—— 没有清空按钮时用户只能全选删除。 */}
        <div className="relative min-w-[140px] flex-1">
          <Search
            aria-hidden="true"
            data-testid="icon-search"
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-text-muted"
          />
          <Input
            size="sm"
            aria-label="Search work items"
            placeholder="Search title / label / assignee…"
            value={search}
            onChange={handleSearch}
            className="pl-7"
          />
          {search === '' ? null : (
            <button
              type="button"
              aria-label="Clear search"
              onClick={handleClearSearch}
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-text-muted transition-colors hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
            >
              <X aria-hidden="true" className="size-3" />
            </button>
          )}
        </div>

        {/* ③ 数据源开关：**独立分组**。它是「拉不拉外部数据」，不是每帧都点的动作。
            夹在搜索与动作之间时，`flex-1` 的搜索框被两侧各挤一次，窄窗口下先换行的
            是开关，把主动作（新建 / 刷新）推到第二行。 */}
        <div role="group" aria-label="Sources" className="flex shrink-0 items-center gap-1.5">
          <Checkbox
            label="GitHub PRs"
            checked={githubEnabled}
            disabled={githubAvailability !== 'ready'}
            onCheckedChange={(next) => onToggleGithub(next === true)}
            title={githubBlockedReason ?? undefined}
            className="shrink-0 text-meta text-text-secondary"
          />
          {githubBlockedReason === null ? null : (
            <span
              data-github-blocked-reason=""
              title={githubBlockedReason}
              // 上限 28ch + `truncate`：理由是**一句话**（「未安装 gh」/「未登录 gh」），
              // 不限制时它会占满剩下的全部宽度，把动作组推到看不见的地方。
              className="min-w-0 max-w-[28ch] truncate text-micro text-text-muted"
            >
              {githubBlockedReason}
            </span>
          )}
        </div>

        {/* ④ 动作：主（新建）在左、次（刷新）在右，与全仓工具栏同序。 */}
        <div role="group" aria-label="Actions" className="flex shrink-0 items-center gap-1">
          <Button variant="secondary" size="sm" onClick={onNew} className="shrink-0">
            <Plus aria-hidden="true" data-testid="icon-new" className="size-3.5" />
            New
          </Button>
          <button
            type="button"
            onClick={onRefresh}
            aria-label="Refresh work items"
            // 图标按钮：`size-7` 与全仓工具栏图标按钮同档；`text-meta` 不是 hint 档
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-meta text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
          >
            <RefreshCw aria-hidden="true" data-testid="icon-refresh" className="size-3.5" />
          </button>
        </div>
      </header>
    );
  },
);
TasksPanelHeader.displayName = 'TasksPanelHeader';

export default TasksPanelHeader;
