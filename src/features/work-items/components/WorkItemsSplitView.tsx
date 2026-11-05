import React from 'react';
import { useDefaultLayout } from 'react-resizable-panels';

import { ISLAND_SPLIT_GROUP_CLASS } from '@/layout/islands';
import { Island } from '@/ui/Island';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/ui/Resizable';

/**
 * 「主内容岛 │ 详情岛」的横向可拖分栏（design §4.2b）：Board 与 List **共用**这一条契约。
 *
 * # 为什么详情是第二座岛，不是覆盖层
 *
 * 原来的详情是一层 `absolute inset-0 bg-bg-primary` 覆盖：它把整座中心岛换掉，于是
 * 关掉详情要回到**同一个**滚动位置与列 —— 整棵树被替换，回来时列全重建。而「5 秒后延迟
 * 提交失败的删除会让那一行自己回到列表」那条纪律，正依赖用户看着同一个列表。
 * 分栏让看板**始终可见**，用户不用在「看详情」与「看全局」之间二选一。
 *
 * # 主面板不是岛，详情面板是岛（2026-11-03 修订后的层级）
 *
 * 整条层级是「海面 → **主岛**（`TasksPanel` 的 `tasks-main-island`）→ 分栏 → 主格 / 详情岛」：
 *
 * | 位置 | 是不是岛 | 理由 |
 * | --- | --- | --- |
 * | 主岛（`TasksPanel`） | ✅ | 一块面板 = 一座岛（头部 + 内容都在里面） |
 * | 分栏主格（看板 / 列表） | ❌ | 它是主岛内的分区，再套一层就是岛中岛 |
 * | 分栏详情格 | ✅ | **第二座岛**：详情是可以独立打开/关闭的另一块内容 |
 *
 * 曾经主格里的看板是「每列一座岛」，导致「一排浮岛漂在海面」；现在是主岛内的分区。
 *
 * # 尺寸存哪：`useDefaultLayout`，不是 `workItemsStore`
 *
 * 判据是「谁拥有存储格式」（`component-guidelines.md` 的变体节）。`workItemsStore` 是
 * 「这个项目的工作项集合」，且会随 `reset()` 清空（切项目时清）。把布局比例塞进去，会让
 * 「切项目后回到默认宽度」变成一条无解释的行为 —— 用户没有要求重置面板宽度。
 * 而团队域的同款选择（`TeamListPane`）已经踩过这个坑，这里照抄。
 *
 * `onlySaveAfterUserInteractions: true` **不能省**：不传的默认是「每次布局提交都存」
 * （含首次布局与窗口 resize），那样注释里这句「只存用户拖动」就是假的。
 *
 * # 详情不存在时不渲染第二块
 *
 * 没有选中项时组里只有一块面板。`panelIds` 仍然声明两块 —— 这是 `useDefaultLayout` 对
 * 「条件渲染面板」的既定用法（它按当前在场 id 集合分槽存布局），所以「打开详情」不会把
 * 主面板的宽度重置一次。
 */
interface WorkItemsSplitViewProps {
  /** 主内容（Board 的列 / List 的列表岛）。**自己负责自己的岛**，见文件头。 */
  main: React.ReactNode;
  /** 详情内容；`null` = 没有选中项（不渲染第二块，不留一座空岛白占宽度）。 */
  detail: React.ReactNode | null;
}

/**
 * 面板 id：**模块级常量**，JSX 里也只能从这里取。
 *
 * 它们同时是 `<ResizablePanel id>` 的值与 `useDefaultLayout` 存储键的一半 —— JSX 里再手写
 * 一遍就多出两个可以和这里漂移的点，而漂移的症状是「拖过的宽度读不回来」，没有任何报错。
 */
const MAIN_PANEL_ID = 'work-items-main';
const DETAIL_PANEL_ID = 'work-items-detail';
const PANEL_IDS = [MAIN_PANEL_ID, DETAIL_PANEL_ID];
const SPLIT_ID = 'neeko-work-items-split';

/** 默认 62 / 38：看板要宽度，详情只需可读（列表行 + 字段 + 阶段轨）。 */
const DEFAULT_SPLIT: Record<string, number> = { [MAIN_PANEL_ID]: 62, [DETAIL_PANEL_ID]: 38 };

/** 两侧各 220px 下限：低于它看板列挤成半列、详情字段换行成柱状。 */
const PANEL_MIN_PX = 220;

const WorkItemsSplitView: React.FC<WorkItemsSplitViewProps> = React.memo(({ main, detail }) => {
  const layout = useDefaultLayout({
    id: SPLIT_ID,
    panelIds: PANEL_IDS,
    onlySaveAfterUserInteractions: true,
  });

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      id={SPLIT_ID}
      className={`min-h-0 flex-1 ${ISLAND_SPLIT_GROUP_CLASS}`}
      defaultLayout={layout.defaultLayout ?? DEFAULT_SPLIT}
      onLayoutChanged={layout.onLayoutChanged}
    >
      {/* 主面板：主岛内部的分栏左格（透明 —— 岛壳在 `TasksPanel` 那一层，
          内容（看板列 / 列表）是岛内分区，见文件头） */}
      <ResizablePanel id={MAIN_PANEL_ID} minSize={PANEL_MIN_PX} className="min-w-0">
        {main}
      </ResizablePanel>

      {detail === null ? null : (
        <>
          <ResizableHandle id="work-items-detail-handle" />
          <ResizablePanel id={DETAIL_PANEL_ID} minSize={PANEL_MIN_PX} className="min-w-0">
            {/* 岛壳的 testid 刻意与面板 id 不同：`react-resizable-panels` 会给 Panel 自己
                一个 `data-testid={id}`，两处同名会让「取详情岛」变成一次歧义查询。 */}
            <Island data-testid="work-items-detail-island" className="h-full">
              {detail}
            </Island>
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  );
});
WorkItemsSplitView.displayName = 'WorkItemsSplitView';

export default WorkItemsSplitView;
