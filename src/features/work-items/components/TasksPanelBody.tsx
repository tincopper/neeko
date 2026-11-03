import React from 'react';

import { Button } from '@/ui/Button';

import type { StagePlan, WorkItem } from '../types';

import BoardView from './BoardView';
import ListView from './ListView';
import type { TaskView } from './TasksPanelHeader';

/**
 * Tasks 面板的内容区：**读状态的唯一分派点**（空 / 加载中 / 读失败 / 有数据 → Board 或 List）。
 *
 * # 四种状态不许合并
 *
 * | 状态 | 判据 | 呈现 | 合并后的症状 |
 * | --- | --- | --- | --- |
 * | 没有绑定项目 | `projectId === null` | 「Select a project」 | 空态里转圈，或假装「一条都没有」|
 * | 首帧加载中 | `loading && items.length === 0` | 「正在读取工作项…」 | 先闪一下空态，再蹦出列表（闪烁即谎报）|
 * | 读失败且从未成功 | `error !== null && items.length === 0` | 什么都不画（横幅已解释） | 补一句「还没有工作项」= 谎报数据 |
 * | 真的没有 / 被搜索过滤光 | `items.length === 0` / `visible.length === 0` | 欢迎提示 / 「没有匹配的工作项」 | 用户分不清「没数据」与「搜不到」|
 *
 * `loading` 已经把「还没加载过」算进来（`useWorkItems` 的注释），所以这里不能用
 * `items.length === 0` 去猜；`items` 与 `visible`（过滤后）也是两件事：一个决定「有没有数据」，
 * 一个决定「搜索命不命中」。
 *
 * # 为什么 Board / List 都吃 `visible` 而不是 `items`
 *
 * 过滤是「用户当前的检索」，两个视图必须看到同一份结果 —— 一个吃原始列表、另一个吃过滤结果的
 * 症状是「List 里搜到 2 条，切回 Board 却是全部」。
 */
interface TasksPanelBodyProps {
  /** `null` = 没有激活项目。 */
  projectId: string | null;
  loading: boolean;
  /** store 的读路径错误（`load` / 延迟提交的删除）。 */
  error: string | null;
  /** 本项目全部工作项（`updatedAt DESC`，不重排）。 */
  items: WorkItem[];
  /** 搜索过滤后的结果（顺序同 `items`）。 */
  visible: WorkItem[];
  view: TaskView;
  plan: StagePlan | null;
  planLoading: boolean;
  onOpen: (id: string) => void;
  /** 卡片右键菜单选中一个 stage（design §11.5 方式三）。 */
  onMove: (id: string, stage: string) => void;
  onAdd: (stage: string) => void;
  onNew: () => void;
}

const TasksPanelBody: React.FC<TasksPanelBodyProps> = React.memo(
  ({
    projectId,
    loading,
    error,
    items,
    visible,
    view,
    plan,
    planLoading,
    onOpen,
    onMove,
    onAdd,
    onNew,
  }) => {
    if (projectId === null) {
      return (
        <p role="status" className="px-2 py-3 text-micro text-text-muted">
          Select a project
        </p>
      );
    }

    if (loading && items.length === 0) {
      return (
        <p role="status" className="px-2 py-3 text-micro text-text-muted">
          正在读取工作项…
        </p>
      );
    }

    // 读失败且从未成功：顶部横幅已经解释了原因，这里不再补一句「还没有工作项」（那是谎报）。
    if (error !== null && items.length === 0) return null;

    if (items.length === 0) {
      return (
        <div className="flex flex-col items-start gap-1 px-2 py-3">
          <p className="text-meta text-text-secondary">还没有工作项</p>
          <Button variant="secondary" size="sm" onClick={onNew}>
            创建第一条工作项
          </Button>
        </div>
      );
    }

    if (visible.length === 0) {
      return (
        <p role="status" className="px-2 py-3 text-micro text-text-muted">
          没有匹配的工作项
        </p>
      );
    }

    if (view === 'board') {
      return (
        <BoardView
          plan={plan}
          planLoading={planLoading}
          items={visible}
          onOpen={onOpen}
          onMove={onMove}
          onAdd={onAdd}
        />
      );
    }

    return <ListView items={visible} onOpen={onOpen} />;
  },
);
TasksPanelBody.displayName = 'TasksPanelBody';

export default TasksPanelBody;
