import React, { useCallback, useMemo } from 'react';

import type { StagePlan, WorkItem } from '../types';

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
  items: WorkItem[];
  onOpen: (id: string) => void;
  /** 卡片右键菜单选中一个 stage（design §11.5 方式三）：宿主做 `transition` + 失败 toast。 */
  onMove: (id: string, stage: string) => void;
  /** 该列底部的 `+ Add`：用该 stage 预填创建对话框。 */
  onAdd: (stage: string) => void;
}

interface BoardColumnProps {
  stage: string;
  plan: StagePlan | null;
  items: WorkItem[];
  onOpen: (id: string) => void;
  onMove: (id: string, stage: string) => void;
  onAdd: (stage: string) => void;
}

const BoardColumn: React.FC<BoardColumnProps> = React.memo(
  ({ stage, plan, items, onOpen, onMove, onAdd }) => {
    const handleAdd = useCallback(() => onAdd(stage), [onAdd, stage]);

    return (
      <section
        aria-label={`${stage} 列`}
        data-stage-column={stage}
        className="flex min-h-0 w-[168px] shrink-0 flex-col rounded-md border border-border bg-bg-secondary"
      >
        {/* 列头：`aria-label` 带上数量，读屏不必自己去数卡片；`h3` 让「列」在标题导航里可跳。 */}
        <h3
          aria-label={`${stage} 阶段，共 ${items.length} 条`}
          className="flex items-center justify-between gap-1 border-b border-border px-2 py-1 text-micro font-semibold text-text-secondary"
        >
          <span className="truncate">{stage}</span>
          <span aria-hidden="true" data-column-count={items.length} className="text-text-muted">
            {items.length}
          </span>
        </h3>

        <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-1">
          {items.length === 0 ? (
            <li className="px-1 py-2 text-micro text-text-muted">暂无工作项</li>
          ) : (
            items.map((item) => (
              <WorkItemCard key={item.id} item={item} plan={plan} onOpen={onOpen} onMove={onMove} />
            ))
          )}
        </ul>

        <button
          type="button"
          onClick={handleAdd}
          aria-label={`在 ${stage} 新建工作项`}
          className="border-t border-border px-2 py-1 text-left text-micro text-text-secondary hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
        >
          + Add
        </button>
      </section>
    );
  },
);
BoardColumn.displayName = 'BoardColumn';

interface GroupedBoard {
  /** stage → 该列的工作项（顺序 = store 顺序）。 */
  groups: Map<string, WorkItem[]>;
  /** 阶段不在 `plan.stages` 里的工作项条数（报告用，不猜位置）。 */
  orphans: number;
}

function groupByStage(plan: StagePlan, items: WorkItem[]): GroupedBoard {
  const groups = new Map<string, WorkItem[]>();
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
  ({ plan, planLoading, items, onOpen, onMove, onAdd }) => {
    const { groups, orphans } = useMemo(
      () => (plan === null ? EMPTY_GROUPS : groupByStage(plan, items)),
      [plan, items],
    );

    if (plan === null) {
      return (
        <div role="status" className="px-2 py-3 text-micro text-text-muted">
          {planLoading ? '阶段轨加载中…' : '阶段轨不可用'}
        </div>
      );
    }

    return (
      <div className="flex h-full min-h-0 flex-col">
        <div
          role="group"
          aria-label="工作项看板"
          className="flex min-h-0 flex-1 gap-2 overflow-x-auto p-2"
        >
          {plan.stages.map((stage) => (
            <BoardColumn
              key={stage}
              stage={stage}
              plan={plan}
              items={groups.get(stage) ?? []}
              onOpen={onOpen}
              onMove={onMove}
              onAdd={onAdd}
            />
          ))}
        </div>
        {orphans === 0 ? null : (
          <p className="shrink-0 border-t border-border px-2 py-1 text-micro text-accent-yellow">
            {`${orphans} 条工作项的阶段不在阶段轨中`}
          </p>
        )}
      </div>
    );
  },
);
BoardView.displayName = 'BoardView';

export default BoardView;
