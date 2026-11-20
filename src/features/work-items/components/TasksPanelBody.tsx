import React from 'react';

import { Button } from '@/ui/Button';

import type { StagePlan } from '../types';
import type { TaskItem } from '../viewModel';

import BoardView from './BoardView';
import ListView from './ListView';
import type { TaskView } from './TasksPanelHeader';
import WorkItemsSplitView from './WorkItemsSplitView';

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
 * `loading` 已经把「还没加载过」与「PR 正在拉」都算进来（`useTaskFeed` 的注释），所以这里不能用
 * `items.length === 0` 去猜；`items` 与 `visible`（过滤后）也是两件事：一个决定「有没有数据」，
 * 一个决定「搜索命不命中」。
 *
 * # 为什么 Board / List 都吃 `visible` 而不是 `items`
 *
 * 过滤是「用户当前的检索」，两个视图必须看到同一份结果 —— 一个吃原始列表、另一个吃过滤结果的
 * 症状是「List 里搜到 2 条，切回 Board 却是全部」。
 *
 * # 两个视图共用同一条「主内容 │ 详情」分栏（design §4.2b）
 *
 * 详情曾经是一层覆盖层（`absolute inset-0`），把整座中心岛换掉；现在是右侧**第二座岛**。
 * 分栏宿主是 [`WorkItemsSplitView`](./WorkItemsSplitView.tsx)（尺寸走 `useDefaultLayout`），
 * 所以 Board 与 List 的差别只剩「主内容是什么」：列、还是列表。
 *
 * `detail` 为 `null` 时宿主只渲染一块面板 —— 没有选中项就不该有一座空岛白占 38% 宽度。
 *
 * # 四种状态都住在**同一座内容岛**里（design §4.2b）
 *
 * 它们曾经是裸 `<p>` / 裸 `<div>`：直接画在面板根的海面上，看起来不像「面板的内容」，
 * 而像「面板没渲染完，漏出一段文字」。
 *
 * # 它们是**主岛内的分区**，不是第二座岛（2026-11-03 修正）
 *
 * 上一版给它们套了 `<Island>`（`bg-bg-secondary`）—— 而它们就住在主岛里，主岛也是
 * `bg-bg-secondary`：**同色叠同色**，视觉上仍是一片白，只是多了一层看不见的圆角。
 * 判据不是「有没有 Island 元素」，而是「**海 / 岛 / 岛内分区是三个不同表面**」。
 *
 * 现在的表面：主岛 `bg-secondary`（岛），内容区 `bg-tertiary`（岛内分区）。
 *
 * 唯一例外：**读失败且从未成功**那一档返回 `null` —— 顶部横幅已经解释了原因，
 * 这里再摆一块空分区等于让用户以为「加载成功了，只是没数据」。
 */
interface TasksPanelBodyProps {
  /** `null` = 没有激活项目。 */
  projectId: string | null;
  loading: boolean;
  /** store 的读路径错误（`load` / 延迟提交的删除）。 */
  error: string | null;
  /** 本项目全部工作项（`updatedAt DESC`，不重排）。 */
  items: TaskItem[];
  /** 搜索过滤后的结果（顺序同 `items`）。 */
  visible: TaskItem[];
  view: TaskView;
  plan: StagePlan | null;
  planLoading: boolean;
  onOpen: (id: string) => void;
  /** 卡片右键菜单选中一个 stage（design §11.5 方式三）。 */
  onMove: (id: string, stage: string) => void;
  onNew: () => void;
  /** 详情岛的内容（`null` = 没有选中项）。 */
  detail: React.ReactNode | null;
}

/**
 * 空态容器：**居中 + 撑满**（与全仓面板内空态同款）。
 *
 * 全仓参照：`PromptListSection` 的 `flex items-center justify-center h-full`，
 * `PullRequestsPanelWrapper` / `GitControlPanelWrapper` 的 `items-center justify-center`。
 *
 * 曾经的写法是 `px-2 py-3 text-micro`（贴左上角 + 10px）：读起来像「面板没渲染完，
 * 漏出一段文字」，而不是「这个面板当前没有内容」。而且 `text-micro` 在字阶表里的
 * 用途是「时间戳、快捷键 hint」—— 拿 hint 的字号当空态正文，等于把主要信息写成脚注。
 */
const EMPTY_STATE_CLASS = 'flex h-full flex-col items-center justify-center gap-2 px-6 text-center';

/** 空态文案：正文级字阶（`text-meta` = 次级元数据，不是 hint 的 `text-micro`）。 */
const EMPTY_TEXT_CLASS = 'text-meta text-text-secondary';

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
    onNew,
    detail,
  }) => {
    // 读失败且从未成功：顶部横幅已经解释了原因，这里不再补一句「还没有工作项」（那是谎报），
    // 也不摆一座空岛（那会让人以为「加载成功了，只是没数据」）。
    if (error !== null && items.length === 0 && projectId !== null && !loading) return null;

    /** 内容：四种「没有可渲染的行」的状态各自一句话，有数据时才是 Board / List。 */
    let content: React.ReactNode;

    if (projectId === null) {
      content = (
        <div role="status" className={EMPTY_STATE_CLASS}>
          <p className={EMPTY_TEXT_CLASS}>Select a project</p>
        </div>
      );
    } else if (loading && items.length === 0) {
      content = (
        <div role="status" className={EMPTY_STATE_CLASS}>
          <p className={EMPTY_TEXT_CLASS}>Loading work items…</p>
        </div>
      );
    } else if (items.length === 0) {
      content = (
        <div className={EMPTY_STATE_CLASS}>
          <p className={EMPTY_TEXT_CLASS}>No work items yet</p>
          <Button variant="secondary" size="sm" onClick={onNew}>
            Create your first work item
          </Button>
        </div>
      );
    } else if (visible.length === 0) {
      content = (
        <div role="status" className={EMPTY_STATE_CLASS}>
          <p className={EMPTY_TEXT_CLASS}>No matching work items</p>
        </div>
      );
    } else if (view === 'board') {
      // 看板 / 列表自带分栏与岛屿（列岛、列表岛、详情岛），它们自己就是「内容」，
      // 不再套一层岛（否则就是岛中岛 —— 看板会变成「岛里的海」）。
      return (
        <WorkItemsSplitView
          detail={detail}
          main={
            <BoardView
              plan={plan}
              planLoading={planLoading}
              items={visible}
              onOpen={onOpen}
              onMove={onMove}
            />
          }
        />
      );
    } else {
      return (
        <WorkItemsSplitView detail={detail} main={<ListView items={visible} onOpen={onOpen} />} />
      );
    }

    // 四种「无行」状态统一住在**主岛内的分区**里（`bg-tertiary`，与看板列 / 列表同一层）。
    // 不套 `<Island>`：主岛已经是 `bg-secondary`，同色叠同色等于没分层（见文件头）。
    return (
      <div
        data-testid="tasks-content-region"
        className="flex min-h-0 flex-1 flex-col bg-bg-tertiary"
      >
        {content}
      </div>
    );
  },
);
TasksPanelBody.displayName = 'TasksPanelBody';

export default TasksPanelBody;
