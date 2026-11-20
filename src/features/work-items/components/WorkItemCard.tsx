import React, { useCallback, useMemo } from 'react';

import { ContextMenu, ContextMenuTrigger } from '@/ui/ContextMenu';

import type { StagePlan } from '../types';
import { cardTimeOf } from '../utils/relativeTime';
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
/**
 * 卡片正文的**可读宽度上限**（≈44 字符）。
 *
 * 看板列现在可伸展：宽窗口下 3 列会各占 400px+，而卡片标题 `flex-1` 会把一行拉到列宽
 * —— 一行 60+ 字的标题既难扫也退化成「一条长条」。`ch` 单位跟字号走（`text-meta`），
 * 所以窄列（168px ≈ 24ch）根本不会触发它；它只在宽列上生效。
 */
const CARD_TEXT_MEASURE_CLASS = 'max-w-[44ch]';

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

  // 渲染期取一次 `now`：同一帧内所有卡片共用同一个基准，且**不读全局时钟**
  // （`relativeUpdatedAt` 是纯函数，见它的文件头 —— 内部读 `Date.now()` 会让 memo 全灭）。
  const timeLabel = cardTimeOf(item, Date.now());
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
      aria-label={`Open work item ${item.title}`}
      onClick={handleOpen}
      // # 卡片适配「圆角块列」的底层（2026-11-03 二次裁决）
      //
      // 用户看过参考图后确认：**列变圆角块**、**底层 token 不变**、**卡片自己适配**。
      // 所以这里要同时满足两条约束：
      //
      // 1. 列的底色仍是 `bg-bg-tertiary`（不动底层阶梯）；
      // 2. 卡片必须在这层之上**看得出是更亮的一层**（参考图的核心观感是「卡片浮在列上」）。
      //
      // 取 `bg-bg-secondary`：它在每个主题里都比 `bg-bg-tertiary` 亮（实测
      // dark 1.19 / light 1.09 / claude 1.24 / one-dark 1.10 / classic-dark 1.39）。
      // 上一版用的 `bg-bg-primary` 在 dark 下反而**比列暗**（1.25 是「列更亮」），
      // 观感是「列在发光、卡片是洞」——与参考图相反。
      //
      // | 特征 | 取值 | 理由 |
      // | --- | --- | --- |
      // | 底色 | `bg-bg-secondary` | 列之上更亮的一层 |
      // | 圆角 | `rounded-lg` | 与列同源 |
      // | 描边 | `border border-border` | 卡片小，阴影不可靠（light 的岛/海只有 1.18） |
      // | 阴影 | `shadow-sm` | 轻；参考图的卡片也有极淡的投影 |
      // | 内距 | `p-3`（12px） | 参考图明显更松（上一版 `px-2.5 py-2` = 10/8px） |
      className="w-full rounded-lg border border-border bg-bg-secondary p-3 text-left shadow-sm transition-colors hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
    >
      <span className="flex min-w-0 items-start gap-1">
        <TaskSourceBadge source={item.source} />
        {/* 标题是卡片的**主信息**（参考图里它占 2-3 行、字重最重）。
            上一版是 `text-meta font-medium` + 外层 `truncate`：长标题被压成一行省略号，
            扫视时读不到「这件事是什么」。`line-clamp-3` 给它三行上限 —— 卡片高度仍然有界
            （列是固定宽度的块，无界标题会把一列撑成瀑布）。 */}
        <span
          className={`min-w-0 flex-1 ${CARD_TEXT_MEASURE_CLASS} text-meta font-semibold break-words text-text-primary line-clamp-3`}
        >
          {item.title}
        </span>
      </span>
      {/* 时间单独一行（参考图里它在卡片底部，与 assignee 同一行）。
          判据见 `utils/relativeTime.ts`：取 `updatedAt`（「多久没动过」），空串则不渲染。 */}
      {timeLabel === '' ? null : (
        <span data-testid="work-item-card-time" className="mt-1.5 block text-micro text-text-muted">
          {timeLabel}
        </span>
      )}
      {item.priority === null && item.labels.length === 0 && item.assignee === null ? null : (
        // 行间 6px（原 `mt-1` = 4px）：标题与元数据挤在一起时，卡片读起来像
        // 「一行文本加了一串标签」，而不是「一张有层次的卡片」。
        <span
          data-testid="work-item-card-meta"
          className="mt-1.5 flex flex-wrap items-center gap-1"
        >
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
