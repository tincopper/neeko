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

    return (
      <header className="flex shrink-0 flex-col gap-1 border-b border-border px-2 py-1.5">
        <div className="flex items-center gap-1">
          <div role="group" aria-label="视图切换" className="flex items-center gap-0.5">
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
          <span className="flex-1" />
          <Button variant="secondary" size="sm" onClick={onNew}>
            + 新建
          </Button>
          <button
            type="button"
            onClick={onRefresh}
            aria-label="刷新工作项"
            className="rounded px-1.5 py-0.5 text-micro text-text-secondary hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
          >
            ↻
          </button>
        </div>
        <Input
          size="sm"
          aria-label="搜索工作项"
          placeholder="搜索标题 / 标签 / 负责人…"
          value={search}
          onChange={handleSearch}
        />
        <div className="flex min-w-0 items-center gap-1">
          <Checkbox
            label="GitHub PRs"
            checked={githubEnabled}
            disabled={githubAvailability !== 'ready'}
            onCheckedChange={(next) => onToggleGithub(next === true)}
            title={githubBlockedReason ?? undefined}
            className="shrink-0 text-micro text-text-secondary"
          />
          {githubBlockedReason === null ? null : (
            <span
              data-github-blocked-reason=""
              title={githubBlockedReason}
              className="min-w-0 truncate text-micro text-text-muted"
            >
              {githubBlockedReason}
            </span>
          )}
        </div>
      </header>
    );
  },
);
TasksPanelHeader.displayName = 'TasksPanelHeader';

export default TasksPanelHeader;
