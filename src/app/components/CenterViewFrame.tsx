import React from 'react';

import { cn } from '@/lib/utils';

/**
 * 中心视图的**唯一框架**（应用统一组件，2026-11-03）。
 *
 * # 为什么它必须存在
 *
 * 用户反馈：「高度和宽度没有和其他中间内容区域对齐 —— 中间这块应该是应用的一个统一组件，
 * 而不是每创建一个功能其中间的大小需要重新实现，内容只是在这个框架里实现」。
 *
 * 实测当时四个中心视图各自写外壳，几何**三种**：
 *
 * | 视图 | 自己的外壳 | 结果 |
 * | --- | --- | --- |
 * | ProjectView | `<Island className="flex-1 h-full">` | 满格 |
 * | Library | 根 `bg-bg-primary`（无内缩） | 满格 |
 * | Tasks | 根 `rounded-lg bg-bg-primary p-1.5` | **四周多缩 6px + 双层圆角** |
 * | Settings | `<Island className="flex-1">` | 满格 |
 *
 * 根因不是审美：**外圈内缩有两个所有者**。布局框架里这件事本是唯一的 ——
 * `DockLayout` 的 `center-area` 面板给 `py-0.5 px-px`（1px）。功能面板再各缩一次，
 * 就必然对不齐。
 *
 * # 职责边界（框架做这些，功能**只填内容**）
 *
 * | 归框架 | 归功能 |
 * | --- | --- |
 * | 海面（`bg-bg-primary`） | 岛（`<Island>` / `ResizablePanel` + `ISLAND_CLASS`） |
 * | 尺寸链（`flex-1 min-h-0 flex-col`） | 岛内的分栏、列表、空态、表格 |
 * | 裁切（`overflow-hidden`） | — |
 * | 显隐（`hidden`，**不卸载**） | — |
 *
 * **框架绝不加 padding / 圆角 / margin**：
 *
 * - 内缩的唯一所有者是 `DockLayout` 的 `center-area`（1px）—— 框架再加一层就是双重内缩，
 *   那正是「对不齐」的形态；
 * - 圆角的唯一所有者是**岛本身**（`ISLAND_CLASS`）—— 框架给圆角，岛就没法贴边，
 *   而且会与岛的圆角形成双层描边。
 *
 * # 为什么用 `hidden` 而不是条件渲染
 *
 * 中心视图常驻（`ProjectView` / `Library` / `Tasks`）：切走再回来若重新挂载，会重拉列表、
 * 丢滚动位置、闪一帧空态。`hidden` 保留 DOM 与组件状态，切换是纯 CSS。
 *
 * 例外：`Settings` 是条件渲染（它没有需要保留的列表状态，且常驻会拖住一批设置面板的数据）。
 * 那是**视图自己的选择**，不是框架的强制 —— 所以 `hidden` 是可选 prop。
 */
export const CENTER_VIEW_FRAME_CLASS = 'flex flex-1 min-h-0 flex-col overflow-hidden bg-bg-primary';

interface CenterViewFrameProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'hidden'> {
  /** 切走时只隐藏、不卸载（保留滚动位置与组件状态）。 */
  hidden?: boolean;
}

/**
 * 中心视图外壳。功能组件把它当根节点，内部只放岛：
 *
 * ```tsx
 * <CenterViewFrame>
 *   <Island className="flex-1">…</Island>
 * </CenterViewFrame>
 * ```
 *
 * 非 div 宿主（如未来的 tab 容器）可直接用 `CENTER_VIEW_FRAME_CLASS` 字符串。
 */
const CenterViewFrame = React.forwardRef<HTMLDivElement, CenterViewFrameProps>(
  function CenterViewFrame({ className, hidden = false, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(CENTER_VIEW_FRAME_CLASS, hidden && 'hidden', className)}
        {...props}
      />
    );
  },
);

export { CenterViewFrame };
