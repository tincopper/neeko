import React, { useCallback, useMemo } from 'react';

import { ContextMenu, ContextMenuTrigger } from '@/ui/ContextMenu';

import type { StagePlan } from '../types';
import { stageNodes } from '../utils/stageRail';
import type { TaskItem } from '../viewModel';

import StageMoveMenu from './StageMoveMenu';
import TaskSourceBadge from './TaskSourceBadge';
import { LabelChips, PriorityChip } from './WorkItemChips';

/**
 * 看板列里的一张卡片（右键菜单见 [`StageMoveMenu`](./StageMoveMenu.tsx)，design §11.5 方式三）。
 *
 * # 卡片刻意不显示 stage
 *
 * 卡片所在的列**就是**它的 stage（列头已写明）。在卡片上再贴一枚 stage chip，等于同一事实
 * 有两个表示点，而它们会漂移 —— 乐观流转的那一帧里，列已经换了、卡片上的 chip 还在旧值。
 * 列表行没有列，所以由 [`ListView`](./ListView.tsx) 自己补 stage chip。
 *
 * # 只有本地工作项有右键 [Move to]
 *
 * 流转写的是**本地库**的 stage；GitHub PR 的状态在 GitHub 上，这一版只读（design §8.2），
 * 对 PR 右键弹一个「没有可流转的阶段」的菜单是在承诺一个不存在的操作。所以 PR 卡片根本不接
 * 菜单 —— 右键不接管，浏览器/系统的默认菜单照旧（那才是它该有的行为）。
 *
 * # 右键的「可去哪些 stage」复用 `stageNodes`，不另写判据
 *
 * 菜单里出现的目标必须与阶段轨**同一条规则**（相邻才可流转，且 transitions 由后端下发）。
 * 所以这里调的是 `utils/stageRail.ts` 的 `stageNodes`，只取 `reachable` —— 若菜单自己比较
 * 「阶段序里隔几个」，就会出现「菜单里能点、后端拒绝」的第二个口径。
 *
 * # 没有入场动画、没有自动滚动
 *
 * 删除是「延迟提交 + 撤销窗口」：5 秒后提交失败时那一行会**自己回到列表**
 * （见 `store/workItemsStore.ts` 的 `commitDelete`）。若卡片带入场动画或列表自动滚到
 * 「新建的那张」，这一行回魂时会被当成新建项高亮/滚动 —— 事实是「它一直没删掉」。
 * 唯一的例外在宿主侧：**本面板发起的 create** 会把新卡片滚进视野（design §11.7），
 * 那条路径由 `TasksPanel` 的 `revealId` 显式驱动，与本组件无关。
 */
interface WorkItemCardProps {
  item: TaskItem;
  /** `null` = 阶段轨还没拿到：右键菜单里没有可去目标（不猜一条假轨道）。 */
  plan: StagePlan | null;
  onOpen: (id: string) => void;
  /** 右键菜单选中一个 stage：宿主负责 `transition` + 失败 toast。 */
  onMove: (id: string, stage: string) => void;
}

const WorkItemCard: React.FC<WorkItemCardProps> = React.memo(({ item, plan, onOpen, onMove }) => {
  const handleOpen = useCallback(() => onOpen(item.id), [onOpen, item.id]);
  const handleMove = useCallback((stage: string) => onMove(item.id, stage), [onMove, item.id]);

  // `plan` 的引用来自 store（稳定），`item.stage` 是字符串 ⇒ 这里不会每次渲染都重建数组，
  // 卡片与菜单的 `memo` 才站得住。
  const moveTargets = useMemo(
    () =>
      plan === null || item.source !== 'local'
        ? []
        : stageNodes(plan, item.stage)
            .filter((node) => node.status === 'reachable')
            .map((node) => node.stage),
    [plan, item.stage, item.source],
  );

  const card = (
    <button
      type="button"
      data-work-item-id={item.id}
      aria-label={`打开工作项 ${item.title}`}
      onClick={handleOpen}
      className="w-full rounded-md border border-border bg-bg-primary px-2 py-1.5 text-left transition-colors hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
    >
      <span className="flex min-w-0 items-start gap-1">
        <TaskSourceBadge source={item.source} />
        <span className="min-w-0 flex-1 text-meta font-medium break-words text-text-primary">
          {item.title}
        </span>
      </span>
      {item.priority === null && item.labels.length === 0 && item.assignee === null ? null : (
        <span className="mt-1 flex flex-wrap items-center gap-1">
          <PriorityChip priority={item.priority} />
          <LabelChips labels={item.labels} />
          {item.assignee === null ? null : (
            <span className="text-micro text-text-muted">@{item.assignee}</span>
          )}
        </span>
      )}
    </button>
  );

  return (
    <li>
      {item.source === 'local' ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
          <StageMoveMenu stages={moveTargets} onMove={handleMove} />
        </ContextMenu>
      ) : (
        card
      )}
    </li>
  );
});
WorkItemCard.displayName = 'WorkItemCard';

export default WorkItemCard;
