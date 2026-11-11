import React from 'react';

import type { ShowToast } from '../hooks/useRunSingleWorkItem';
import type { StagePlan } from '../types';
import type { TaskItem } from '../viewModel';

import WorkItemDetail from './WorkItemDetail';

/**
 * 详情岛的内容（design §4.2b）：把「选中项 + 阶段轨 + 四个动作」接成一块可直接交给分栏的东西。
 *
 * # 为什么抽出来
 *
 * `TasksPanel` 只做**编排**（状态 + 动作 + 组合），而详情岛是「一块已经接好线的 JSX」——
 * 把它写在编排文件里会让那个文件逼近 `check_component_size` 的 300 行红线，而抽出去的判据
 * 不是行数：这块没有任何自己的状态，只是把宿主已经拿到的 props 摆到
 * [`WorkItemDetail`](./WorkItemDetail.tsx) 上。
 *
 * # 「有没有选中项」由**宿主**判定，不由本组件吞掉
 *
 * 没有选中项就不该有一座空岛白占 38% 宽度。而分栏的第二块是否渲染，取决于
 * `detail === null`（见 [`WorkItemsSplitView`](./WorkItemsSplitView.tsx)）—— 那是**宿主**
 * 的判定。本组件若在内部 `return null`，`detail` 仍然是一个非 null 的 React 元素，
 * 分栏照样会渲染面板与分隔条：用户看到一条能拖的缝，右边什么都没有。
 *
 * 所以 `item` 是必填的：调用点先判空，再把「有选中项」这件事交给分栏。
 */
interface WorkItemDetailPaneProps {
  /** 选中的工作项（`TasksPanel` 只在有选中项时才渲染本组件，见文件头）。 */
  item: TaskItem;
  /** `null` = 阶段轨还没拿到（详情里整块不画轨道）。 */
  plan: StagePlan | null;
  projectId: string | null;
  showToast: ShowToast;
  /** 阶段轨上点中的 stage：宿主做 `transition` + 失败 toast。 */
  onMove: (stage: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}

const WorkItemDetailPane: React.FC<WorkItemDetailPaneProps> = React.memo(
  ({ item, plan, projectId, showToast, onMove, onEdit, onDelete, onClose }) => {
    return (
      <WorkItemDetail
        item={item}
        plan={plan}
        projectId={projectId}
        showToast={showToast}
        onMove={onMove}
        onEdit={onEdit}
        onDelete={onDelete}
        onClose={onClose}
      />
    );
  },
);
WorkItemDetailPane.displayName = 'WorkItemDetailPane';

export default WorkItemDetailPane;
