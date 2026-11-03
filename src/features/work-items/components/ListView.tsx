import React, { useCallback } from 'react';

import type { TaskItem } from '../viewModel';

import TaskSourceBadge from './TaskSourceBadge';
import { LabelChips, PriorityChip, StageChip } from './WorkItemChips';

/**
 * 列表视图：一行一条工作项（窄 dock 列里的主视图）。
 *
 * # 与看板的分工
 *
 * 看板用「列」表达 stage，所以卡片不贴 stage chip；列表没有列，所以这里**必须**补上
 * —— 否则切换视图后唯一丢掉的正是「它在哪个阶段」。
 *
 * # 顺序仍然来自 store
 *
 * 本组件按传入顺序渲染，不排序、不分组：`updatedAt DESC` 是 store 与后端共用的唯一契约，
 * 在渲染层再分一次组就是第二个口径。
 *
 * # 行是按钮，不是可点击的 `<li>`
 *
 * `onClick` 挂在 `<li>` 上会让键盘用户无法到达（`<li>` 不在 tab 序里）。整行一个
 * `<button>` 同时拿到焦点环与读屏名称。
 *
 * # 列表行**没有**右键 [Move to] 菜单
 *
 * 那个菜单位于看板卡片（[`WorkItemCard`](./WorkItemCard.tsx)，design §11.5 方式三）：看板以「列」
 * 表达 stage，卡片上没有任何 stage 控件，右键是它在原位换列的捷径。列表行一点就打开详情，
 * 而详情本来就有完整的 Stage Rail —— 再加一份菜单就是同一件事的第三条入口。
 */
interface ListViewProps {
  items: TaskItem[];
  onOpen: (id: string) => void;
}

interface ListRowProps {
  item: TaskItem;
  onOpen: (id: string) => void;
}

const ListRow: React.FC<ListRowProps> = React.memo(({ item, onOpen }) => {
  const handleOpen = useCallback(() => onOpen(item.id), [onOpen, item.id]);

  return (
    <li className="border-b border-border-subtle last:border-b-0">
      <button
        type="button"
        data-work-item-id={item.id}
        aria-label={`打开工作项 ${item.title}`}
        onClick={handleOpen}
        className="flex w-full flex-col gap-0.5 px-2 py-1.5 text-left transition-colors hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <TaskSourceBadge source={item.source} />
          <StageChip stage={item.stage} />
          <PriorityChip priority={item.priority} />
          <span className="min-w-0 flex-1 truncate text-meta text-text-primary">{item.title}</span>
        </span>
        {item.labels.length === 0 && item.assignee === null ? null : (
          <span className="flex flex-wrap items-center gap-1 pl-0.5">
            <LabelChips labels={item.labels} />
            {item.assignee === null ? null : (
              <span className="text-micro text-text-muted">@{item.assignee}</span>
            )}
          </span>
        )}
      </button>
    </li>
  );
});
ListRow.displayName = 'ListRow';

const ListView: React.FC<ListViewProps> = React.memo(({ items, onOpen }) => {
  if (items.length === 0) {
    return (
      <p role="status" className="px-2 py-3 text-micro text-text-muted">
        还没有工作项
      </p>
    );
  }

  return (
    <ul aria-label="工作项列表" className="flex flex-col">
      {items.map((item) => (
        <ListRow key={item.id} item={item} onOpen={onOpen} />
      ))}
    </ul>
  );
});
ListView.displayName = 'ListView';

export default ListView;
