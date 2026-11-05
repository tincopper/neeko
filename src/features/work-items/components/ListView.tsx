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
 *
 * # 列表是**主岛里的分区**，行是分区里的**圆角块**（2026-11-03 二次修订）
 *
 * 岛的判据是「一块面板就是一座岛」：主岛（`TasksPanel` 的 `tasks-main-island`）包住头部与
 * 内容，列表只是主岛内部的分区。旁边的详情是**第二座岛**（由 `WorkItemsSplitView` 分栏给出）。
 *
 * 行与看板列/卡片共用同一套语汇：**圆角块 + 更亮的底色 + 块间 6px 空隙**，不画分隔线。
 * 曾经行是「`border-b` 的表格行」—— 与看板的圆角块并列时，两个视图读起来像两个产品。
 */
/**
 * 列表行正文的**可读宽度上限**（≈80 字符）。
 *
 * 列表行是 `w-full`：在中心全宽视图里，一个 1600px 宽的窗口会把标题拉到一整行
 * —— 截断点遥不可及，文字变成「一条长条」，用户的眼睛要横扫整个屏幕才能读完一行。
 * `truncate` 仍然保留（超过 80ch 才截），只是截断点不再跟着窗口宽度跑。
 */
const ROW_TEXT_MEASURE_CLASS = 'max-w-[80ch]';

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
    // 行是**圆角块**，与看板列同一套语汇（2026-11-03 二次）。
    // 判据与看板一致：圆角 + 底色（列/分区之上更亮的一层），但**不加阴影** ——
    // 一屏 20 行的阴影会让列表看起来在抖。行之间靠 6px 空隙分开（`ISLAND_GAP_CLASS`
    // 在 `<ul>` 上），所以这里**不再画 `border-b`**：块之间画线就退回「表格行」。
    <li>
      <button
        type="button"
        data-work-item-id={item.id}
        aria-label={`Open work item ${item.title}`}
        onClick={handleOpen}
        className="flex w-full flex-col gap-1 rounded-lg border border-border bg-bg-secondary px-3 py-2.5 text-left transition-colors hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <TaskSourceBadge source={item.source} />
          <StageChip stage={item.stage} />
          <PriorityChip priority={item.priority} />
          <span
            className={`min-w-0 flex-1 truncate ${ROW_TEXT_MEASURE_CLASS} text-meta text-text-primary`}
          >
            {item.title}
          </span>
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
      <div className="flex min-h-0 flex-1 flex-col bg-bg-tertiary">
        <p role="status" className="px-2 py-3 text-meta text-text-muted">
          No work items yet
        </p>
      </div>
    );
  }

  return (
    // 列表**不是**一座独立的岛（2026-11-03 修订）：它住在主岛里，是主岛内的一个分区。
    // 岛壳由宿主（`WorkItemsSplitView` / `TasksPanel`）给。
    //
    // # 为什么这一层必须自刷 `bg-bg-tertiary`（2026-11-03 三次修正）
    //
    // 行的底色是 `bg-bg-secondary`（列表分区之上更亮的一层，与看板卡片同一档）。
    // 而**岛**也是 `bg-bg-secondary`。上一版这一层是裸 `flex-1`（无底色），于是
    // 行直接叠在岛上：`secondary` 对 `secondary` 在五个主题里对比度恒为 **1.00**，
    // 行只剩下 `border` 描出的方框 —— 正是 `surfaceContrast.test.ts` 钉住的那个事故形态，
    // 只是换到了列表这一侧（那个文件只钉「卡片 vs 列」这一对，钉不到「行 vs 岛」）。
    //
    // 看板侧天然是对的：列自带 `bg-bg-tertiary`，卡片才落在 tertiary 之上。
    // 列表侧缺的正是这个中间层 —— 补上它，两个视图的表面阶梯才同构：
    // 岛(secondary) → 分区(tertiary) → 行(secondary)。
    <div
      data-testid="work-items-list-region"
      className="flex min-h-0 flex-1 flex-col bg-bg-tertiary"
    >
      <ul
        aria-label="Work items"
        // 块之间 6px 空隙（`ISLAND_GAP_CLASS`），不画分隔线：行是块，不是表格行。
        className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-1.5"
      >
        {items.map((item) => (
          <ListRow key={item.id} item={item} onOpen={onOpen} />
        ))}
      </ul>
    </div>
  );
});
ListView.displayName = 'ListView';

export default ListView;
