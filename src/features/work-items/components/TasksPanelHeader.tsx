import React, { useCallback } from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';

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
  /** 调 `workItemsStore.load(projectId)`（同项目在飞会被复用）。 */
  onRefresh: () => void;
  onNew: () => void;
}

const TasksPanelHeader: React.FC<TasksPanelHeaderProps> = React.memo(
  ({ view, onSelectView, search, onSearchChange, onRefresh, onNew }) => {
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
      </header>
    );
  },
);
TasksPanelHeader.displayName = 'TasksPanelHeader';

export default TasksPanelHeader;
