import React, { useMemo } from 'react';

import { ISLAND_GAP_CLASS } from '@/layout/islands';

import type { StagePlan } from '../types';
import type { TaskItem } from '../viewModel';

import WorkItemCard from './WorkItemCard';

/**
 * 看板视图（design §4.5）：列 = `plan.stages`，卡片 = 工作项。
 *
 * # 列**来自 plan**，不是写死的五列
 *
 * `stages` 是后端下发的数据（`StagePlan::default()`，将来可以是自定义阶段集）。写死
 * `['Backlog','Ready','In Progress','Review','Done']` 会让「后端换了阶段集」变成「卡片全部
 * 消失」—— 因为没有一列认领它们，而界面看起来只是「空了」。所以 `plan === null` 时不画列，
 * 显示一句占位（加载中 / 不可用）。
 *
 * # 渲染里**不排序**
 *
 * 列表顺序的唯一契约是 `updatedAt DESC`（与后端 `ORDER BY updated_at DESC, id` 一致），由
 * store 维护。这里按 store 给的顺序逐个入桶，不在渲染期再排一次 —— 两处排序一旦不同口径
 * （比如这里按 `createdAt`），页面顺序与后端顺序就会在刷新后跳变。
 *
 * # 阶段不在当前 plan 里的工作项
 *
 * 它们没有列可放。这里**不猜**位置（不塞进第一列/最后一列），而是在底部报一句「N 条工作项的
 * 阶段不在阶段轨中」—— 这是真实的数据不一致，用户需要看见它，而不是被静默吞掉。
 */
interface BoardViewProps {
  /** `null` = 阶段轨还没拿到。 */
  plan: StagePlan | null;
  /** 阶段轨是否还在拉（决定占位文案是「加载中」还是「不可用」）。 */
  planLoading: boolean;
  /** 已按 store 顺序排好的工作项（本组件不重排）。 */
  items: TaskItem[];
  onOpen: (id: string) => void;
  /** 卡片右键菜单选中一个 stage（design §11.5 方式三）：宿主做 `transition` + 失败 toast。 */
  onMove: (id: string, stage: string) => void;
}

/**
 * 看板列的宽度策略：**可伸展 + 有下限**。
 *
 * - `flex-1 basis-0`：列等分中心区宽度。看板现在是**中心全宽视图**（tab 面板），
 *   3~5 列在 1200px 的窗口里如果按固定 168px 渲染，右边会空一大片，
 *   看起来像「没渲染完」而不是「看板」。
 * - `min-w-[168px]`：下限仍是原来那个为窄面板标定的可读宽度 —— 列数多 / 窗口窄时
 *   列不再压缩，而是由外层 `overflow-x-auto` 横向滚动（保留原来的行为）。
 * - 不再 `shrink-0`：`flex-1` 已含 `flex-shrink: 1`，而 `min-w` 已是收缩下限，
 *   再写 `shrink-0` 会让「窄窗口横向滚动」变成「列把容器撑破」。
 */
const BOARD_COLUMN_WIDTH_CLASS = 'flex-1 basis-0 min-w-[168px]';

/**
 * 一列 = **主岛里的一个分区**，不是一座独立的岛。
 *
 * # 列是**圆角块**，但不是岛（2026-11-03 二次裁决）
 *
 * 历史：曾把每列写成 `ISLAND_CLASS`（`rounded-lg shadow-sm bg-bg-secondary`），看板变成
 * 「一排浮岛漂在海面上」被否决 —— 那时的结论是「列是分区，没有圆角/阴影」。
 *
 * 看过参考图后用户确认要走**中间态**：圆角 + 可见空隙，但**不加阴影**、**底层 token 不变**。
 * 三条特征必须分开判（缺一条就退回到被否决的形态或退回紧贴的表格）：
 *
 * | 特征 | 取值 | 为什么 |
 * | --- | --- | --- |
 * | 圆角 | `rounded-lg` | 列是一块有边界的块，不是紧贴的分区条 |
 * | 阴影 | **无** | 有阴影就是「浮岛」，即当初被否决的形态 |
 * | 底色 | `bg-bg-tertiary` | 底层不变（用户明确要求）；换 token 会连带影响全仓表面阶梯 |
 * | 间距 | `ISLAND_GAP_CLASS`（6px） | 圆角在 1px 缝里读成表格线（见 `islands.ts`） |
 *
 * 现在的层级：
 *
 * ```
 * 海面（`AppCenter` 的中心容器给）
 * └ 主岛（<Island data-testid="tasks-main-island">：头部 + 内容都在岛内）
 *   └ 看板横向区（列之间 6px 空隙）
 *     └ 列（rounded-lg 块，bg-bg-tertiary，无阴影）
 *       └ 卡片（bg-bg-primary，自己适配底层）
 * ```
 */
const BOARD_COLUMN_CLASS = `flex min-h-0 flex-col overflow-hidden rounded-lg bg-bg-tertiary ${BOARD_COLUMN_WIDTH_CLASS}`;

interface BoardColumnProps {
  stage: string;
  plan: StagePlan | null;
  items: TaskItem[];
  onOpen: (id: string) => void;
  onMove: (id: string, stage: string) => void;
}

const BoardColumn: React.FC<BoardColumnProps> = React.memo(
  ({ stage, plan, items, onOpen, onMove }) => {
    return (
      <section
        aria-label={`${stage} column`}
        data-stage-column={stage}
        className={BOARD_COLUMN_CLASS}
      >
        {/* 列头：`aria-label` 带上数量，读屏不必自己去数卡片；`h3` 让「列」在标题导航里可跳。 */}
        <h3
          aria-label={`${stage} stage, ${items.length} items`}
          // 分区头：与列体同色（列体是 `bg-bg-tertiary`），靠 `border-b` 分界 ——
          // 它不再是「岛内 header」，因为列本身已经不是岛。
          // 纵向 6px（原 `py-1` = 4px）：列头与列体之间要有一点松紧对比，
          // 否则整列读起来是「上下两条薄横条夹着卡片」= 表格，不是「一叠卡片」。
          // 字号 `text-meta`（原 `text-micro` 是 10px 的 hint 档，列名不是 hint）。
          className="flex shrink-0 items-center gap-1.5 border-b border-border px-2.5 py-1.5 text-meta font-semibold text-text-secondary"
        >
          {/* 阶段圆点：扫视锚点。列头是一行小字，纯文字扫起来很慢，一个点就够了。
              **中性色**（`bg-text-muted`）而不是语义色 —— 阶段不是严重度，
              红黄绿会让用户以为「红的列有问题」。靠形状区分，不靠颜色。 */}
          <span
            data-testid="board-column-dot"
            aria-hidden="true"
            className="size-1.5 shrink-0 rounded-full bg-text-muted"
          />
          <span className="truncate">{stage}</span>
          {/* 数字 pill：与名字**视觉分离**（同字号同行会读成名字的一部分）。
              对读屏是重复信息 —— 数量已经在列头的 `aria-label`（「共 N 条」）里了。 */}
          <span
            data-testid="board-column-count"
            aria-hidden="true"
            data-column-count={items.length}
            className="ml-auto inline-flex shrink-0 items-center rounded-full bg-bg-secondary px-1.5 py-0.5 text-micro tabular-nums text-text-muted"
          >
            {items.length}
          </span>
        </h3>

        {/* 卡间距 6px（`ISLAND_GAP_CLASS` 同值，但这里是**分区内**的呼吸，不是岛间海面 ——
            岛间海面有 1px 手柄/6px 两种语义，卡片之间只需要「看得出是两张」）。
            原来是 `gap-1`（4px）：卡片挨着卡片，扫视时读成一整块。 */}
        <ul className={`flex min-h-0 flex-1 flex-col ${ISLAND_GAP_CLASS} overflow-y-auto p-1.5`}>
          {items.length === 0 ? (
            <li className="px-1 py-2 text-meta text-text-muted">No items</li>
          ) : (
            items.map((item) => (
              <WorkItemCard key={item.id} item={item} plan={plan} onOpen={onOpen} onMove={onMove} />
            ))
          )}
        </ul>
      </section>
    );
  },
);
BoardColumn.displayName = 'BoardColumn';

interface GroupedBoard {
  /** stage → 该列的工作项（顺序 = store 顺序）。 */
  groups: Map<string, TaskItem[]>;
  /** 阶段不在 `plan.stages` 里的工作项条数（报告用，不猜位置）。 */
  orphans: number;
}

function groupByStage(plan: StagePlan, items: TaskItem[]): GroupedBoard {
  const groups = new Map<string, TaskItem[]>();
  for (const stage of plan.stages) groups.set(stage, []);
  let orphans = 0;
  for (const item of items) {
    const bucket = groups.get(item.stage);
    if (bucket === undefined) {
      orphans += 1;
      continue;
    }
    bucket.push(item);
  }
  return { groups, orphans };
}

const EMPTY_GROUPS: GroupedBoard = { groups: new Map(), orphans: 0 };

const BoardView: React.FC<BoardViewProps> = React.memo(
  ({ plan, planLoading, items, onOpen, onMove }) => {
    const { groups, orphans } = useMemo(
      () => (plan === null ? EMPTY_GROUPS : groupByStage(plan, items)),
      [plan, items],
    );

    if (plan === null) {
      return (
        <div role="status" className="px-2 py-3 text-meta text-text-muted">
          {planLoading ? 'Loading stages…' : 'Stages unavailable'}
        </div>
      );
    }

    return (
      <div className="flex h-full min-h-0 flex-col">
        <div
          role="group"
          aria-label="Work items board"
          // 列现在是**圆角块** ⇒ 用 `ISLAND_GAP_CLASS`（6px），不是分栏的 `gap-px`：
          // `gap-px` 是给「两侧各贴一条 ResizableHandle」的分栏用的，圆角块之间只留 1px
          // 会让 `rounded-lg` 的弧线读成表格线（见 `islands.ts` 的说明）。
          className={`flex min-h-0 flex-1 ${ISLAND_GAP_CLASS} overflow-x-auto p-1.5`}
        >
          {plan.stages.map((stage) => (
            <BoardColumn
              key={stage}
              stage={stage}
              plan={plan}
              items={groups.get(stage) ?? []}
              onOpen={onOpen}
              onMove={onMove}
            />
          ))}
        </div>
        {orphans === 0 ? null : (
          <p className="shrink-0 border-t border-border px-2 py-1 text-micro text-accent-yellow">
            {`${orphans} item(s) have a stage outside the stage plan`}
          </p>
        )}
      </div>
    );
  },
);
BoardView.displayName = 'BoardView';

export default BoardView;
