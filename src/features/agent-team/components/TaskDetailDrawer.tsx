import React from 'react';

import type { TaskDetail } from '@/shared/types/team';

import { useDrawerFocus } from '../hooks/useDrawerFocus';
import { taskStateLabel } from '../utils/taskBoard';
import { workspaceLabel } from '../utils/workspaceLabel';

/**
 * 任务详情抽屉（**正文唯一出现的界面**）。
 *
 * 红线 4 的两半在这里合流：列路径不带 `body`（后端类型层面就没有），正文只在用户点开
 * 一张卡片时走一次 `team_task_detail`。抽屉是浮层而非跳转 —— 看完正文要能一眼回到板上，
 * 跳走再回来会丢掉「刚才在看哪个任务」的上下文。
 *
 * # 它是一层对话框
 *
 * 卡片按钮还在 DOM 里（被抽屉盖住），所以焦点必须进抽屉、Esc 能关、关闭后回到那张卡片。
 * 一份实现两个抽屉共用（[`useDrawerFocus`]），理由见该 hook 的模块注释。
 */
interface TaskDetailDrawerProps {
  detail: TaskDetail;
  onClose: () => void;
}

const TaskDetailDrawer: React.FC<TaskDetailDrawerProps> = React.memo(({ detail, onClose }) => {
  const drawerRef = useDrawerFocus<HTMLElement>(onClose);

  return (
    <aside
      ref={drawerRef}
      role="dialog"
      aria-modal="true"
      aria-label={`任务详情 ${detail.id}`}
      // 加载态之外也可能出现「一个可聚焦元素都没有」的瞬间：焦点仍要有落点。
      tabIndex={-1}
      className="absolute inset-x-0 bottom-0 z-10 flex max-h-[70%] flex-col rounded-t-lg border-t border-border bg-bg-primary shadow-lg focus:outline-none"
    >
      <header className="flex items-start gap-2 border-b border-border px-2 py-1.5">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-meta font-semibold text-text-primary">{detail.title}</span>
          <span className="text-micro text-text-muted">
            <span className="font-mono">{detail.id}</span> · {taskStateLabel(detail.state)} ·{' '}
            {workspaceLabel(detail.workspace)}
            {detail.reclaimCount > 0 ? ` · 被回收 ${detail.reclaimCount} 次` : ''}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭任务详情"
          className="shrink-0 rounded px-1.5 py-0.5 text-micro text-text-secondary hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
        >
          关闭
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-2 py-1.5">
        {detail.summary ? (
          <section className="mb-2">
            <h4 className="text-micro font-semibold text-text-secondary">
              结果摘要{detail.summaryTruncated ? '（已截断）' : ''}
            </h4>
            <p className="mt-0.5 text-meta whitespace-pre-wrap text-text-primary">
              {detail.summary}
            </p>
          </section>
        ) : null}
        <section>
          <h4 className="text-micro font-semibold text-text-secondary">派活正文</h4>
          {detail.body.trim() === '' ? (
            <p className="mt-0.5 text-meta text-text-muted">（无正文）</p>
          ) : (
            <pre className="mt-0.5 text-meta font-mono whitespace-pre-wrap break-words text-text-primary">
              {detail.body}
            </pre>
          )}
        </section>
      </div>
    </aside>
  );
});
TaskDetailDrawer.displayName = 'TaskDetailDrawer';

export default TaskDetailDrawer;
