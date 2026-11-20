import React from 'react';

import { Button } from '@/ui/Button';

import type { ShowToast } from '../hooks/useRunSingleWorkItem';
import type { StagePlan } from '../types';
import type { TaskItem } from '../viewModel';

import PrTaskSection from './PrTaskSection';
import StageRail from './StageRail';
import TaskSourceBadge from './TaskSourceBadge';
import { LabelChips, PriorityChip } from './WorkItemChips';
import WorkItemRunsSection from './WorkItemRunsSection';

/**
 * 工作项详情（design §11.3 + §4.6）：字段区 → 阶段轨 → 执行区 → 动作条。
 *
 * # 字段是「外部平台的真相」，执行是「本机的行为」
 *
 * 两块的归属不同，所以执行区（[`WorkItemRunsSection`](./WorkItemRunsSection.tsx)）自带数据副作用，
 * 本组件只管布局：字段读的是 `item`，执行记录不属于它，也不该让它去拉。
 *
 * # 两档来源，两套字段（不是一套挡板）
 *
 * | 块 | local | github |
 * | --- | --- | --- |
 * | 阶段轨 | ✅（可流转） | ❌ —— PR 的状态在 GitHub 上，我们改不了 |
 * | 编辑 / 删除 | ✅ | ❌ —— 写的是本地库 |
 * | 执行区 | ✅ | ❌ —— 执行要在本机起终端，PR 只读 |
 * | PR 摘要 | ❌ | ✅（[`PrTaskSection`](./PrTaskSection.tsx)：分支 / 作者 / 浏览器打开） |
 *
 * 把不适用的块**置灰**而不是隐藏，只对「同一能力暂时不可用」成立（如 team/flow 执行档）。
 * 这里不同：PR 根本没有那个字段/那个写路径，摆一个灰按钮等于承诺「以后能改 GitHub」。
 * 所以 PR 详情只保留事实 + 一个出口，动作条整块不渲染。
 *
 * # 它是**一座岛的内容**，不是覆盖层
 *
 * 2026-11-03 修订（用户反馈「应该使用岛屿布局」）：原来的详情是一层
 * `absolute inset-0 bg-bg-primary` 覆盖层 —— 它把整座中心岛换掉，用户丢掉看板与滚动位置，
 * 关掉详情回来时列全重建（而那正好违背「5 秒后延迟提交失败的删除会让那一行自己回到列表」
 * 那条纪律）。现在详情是**右侧第二座岛**（宿主 [`WorkItemsSplitView`](./WorkItemsSplitView.tsx)
 * 提供岛壳与可拖分栏），看板始终在左边。
 *
 * 所以本组件只排内部结构：`h-full` + `flex-col`，**不写** `absolute inset-0`，也**不写**
 * `bg-bg-primary`（那是海面，会把岛挖穿）。岛内 header / footer **不刷表面**，只靠
 * `border-b` / `border-t` 划界（与 `TasksPanelHeader` 同款）。
 *
 * # 为什么是 `region` 而不是 `dialog`
 *
 * 它没有焦点陷阱、也没有 `aria-modal`，承诺成对话框会让读屏用户以为 Tab 出不去。关闭入口是
 * 一个真的按钮；`Escape` 由**面板**统一处理（`utils/shortcuts.ts` 的 `close`）—— 快捷键只在
 * 焦点位于面板内部时生效，本组件不需要再捕获一次（两处都监听就是同一次按键两个所有者）。
 */
interface WorkItemDetailProps {
  item: TaskItem;
  /** `null` = 阶段轨还没拿到（轨道整块不渲染，不画假轨道）。 */
  plan: StagePlan | null;
  /** 宿主注入的激活项目（执行区要靠它开终端 / 定位 tab，`null` = 没绑定）。 */
  projectId: string | null;
  /**
   * 动作失败的提示通道（toast 状态住在面板里）。
   *
   * 透传而不是在子组件里 `useToast()`：那样写下的消息没有任何人渲染。
   */
  showToast: ShowToast;
  /** 点中可流转 stage：宿主负责 `transition` + 失败 toast（本组件不发 IPC）。 */
  onMove: (stage: string) => void;
  onEdit: () => void;
  /** 删除由宿主执行（`actions.remove` + 撤销窗口）；本组件只发信号。 */
  onDelete: () => void;
  onClose: () => void;
}

const WorkItemDetail: React.FC<WorkItemDetailProps> = React.memo(
  ({ item, plan, projectId, showToast, onMove, onEdit, onDelete, onClose }) => {
    const isLocal = item.source === 'local';

    return (
      <section
        aria-label="Work item detail"
        data-work-item-detail={item.id}
        data-task-source={item.source}
        className="flex h-full min-h-0 flex-col"
      >
        <header className="flex shrink-0 items-start gap-2 border-b border-border px-2.5 py-1.5">
          <TaskSourceBadge source={item.source} />
          <h3 className="min-w-0 flex-1 text-meta font-semibold break-words text-text-primary">
            {item.title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close work item detail"
            className="shrink-0 rounded px-1.5 py-0.5 text-micro text-text-secondary hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
          >
            Close
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto px-2.5 py-2">
          {isLocal ? (
            <>
              <StageRail plan={plan} current={item.stage} onMove={onMove} />

              <dl className="mt-2 grid grid-cols-[auto_1fr] items-start gap-x-2 gap-y-1 text-meta">
                <dt className="text-text-muted">Priority</dt>
                <dd className="min-w-0">
                  {item.priority === null ? (
                    <span className="text-text-muted">Not set</span>
                  ) : (
                    <PriorityChip priority={item.priority} />
                  )}
                </dd>
                <dt className="text-text-muted">Assignee</dt>
                <dd className="min-w-0 break-words text-text-primary">
                  {item.assignee === null ? (
                    <span className="text-text-muted">Unassigned</span>
                  ) : (
                    item.assignee
                  )}
                </dd>
                <dt className="text-text-muted">Labels</dt>
                <dd className="flex min-w-0 flex-wrap gap-1">
                  {item.labels.length === 0 ? (
                    <span className="text-text-muted">None</span>
                  ) : (
                    <LabelChips labels={item.labels} />
                  )}
                </dd>
              </dl>

              <h4 className="mt-3 text-micro font-semibold text-text-secondary">Description</h4>
              {/* 纯文本按行渲染（`pre-wrap`）：不引 markdown 库，也不把用户的正文魔法成 HTML。 */}
              <p className="mt-0.5 text-meta break-words whitespace-pre-wrap text-text-primary">
                {item.body.trim() === '' ? (
                  <span className="text-text-muted">(no description)</span>
                ) : (
                  item.body
                )}
              </p>

              <WorkItemRunsSection item={item} projectId={projectId} showToast={showToast} />
            </>
          ) : (
            <PrTaskSection item={item} projectId={projectId} showToast={showToast} />
          )}
        </div>

        {isLocal ? (
          <footer className="flex shrink-0 items-center gap-1 border-t border-border px-2.5 py-1.5">
            <Button variant="secondary" size="sm" onClick={onEdit}>
              Edit
            </Button>
            <Button variant="destructive" size="sm" onClick={onDelete}>
              Delete
            </Button>
          </footer>
        ) : null}
      </section>
    );
  },
);
WorkItemDetail.displayName = 'WorkItemDetail';

export default WorkItemDetail;
