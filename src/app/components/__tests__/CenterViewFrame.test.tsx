import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CENTER_VIEW_FRAME_CLASS, CenterViewFrame } from '../CenterViewFrame';

/**
 * `CenterViewFrame` 是**中心区的唯一框架**（应用统一组件）。
 *
 * # 为什么它必须存在（2026-11-03）
 *
 * 用户反馈：「高度和宽度没有和其他中间内容区域对齐 —— 中间这块应该是应用的一个统一组件，
 * 而不是每创建一个功能其中间的大小需要重新实现，内容只是在这个框架里实现」。
 *
 * 实测当时四个中心视图各自写外壳，几何三种：
 *
 * | 视图 | 自己的外壳 | 结果 |
 * | --- | --- | --- |
 * | ProjectView | `<Island className="flex-1 h-full">` | 满格 |
 * | Library | 根 `bg-bg-primary`（无内缩） | 满格 |
 * | Tasks | 根 `rounded-lg bg-bg-primary p-1.5` | **四周多缩 6px + 双层圆角** |
 * | Settings | `<Island className="flex-1">` | 满格 |
 *
 * 「谁负责外圈内缩」在布局框架里本是唯一的（`DockLayout` 的 `center-area` 面板给
 * `py-0.5 px-px`）。功能面板再各缩一次，就必然对不齐 —— 这不是审美问题，是**几何有两个所有者**。
 *
 * # 职责边界（本文件钉住的东西）
 *
 * | 归框架 | 归功能 |
 * | --- | --- |
 * | 海面（`bg-bg-primary`） | 岛（`<Island>` / `ResizablePanel`） |
 * | 尺寸链（`flex-1 min-h-0 flex-col`） | 岛内的分栏、列表、空态 |
 * | 裁切（`overflow-hidden`） | — |
 * | **不**加 padding / 圆角 | — |
 *
 * **框架绝不加 padding 与圆角**：外圈内缩归 `DockLayout` 的 `center-area`（1px），
 * 圆角归每座岛。框架再给一层就与宿主双重内缩 —— 那正是「对不齐」的形态。
 */
describe('CenterViewFrame — 中心区唯一框架', () => {
  it('提供海面 + 尺寸链 + 裁切，且**不自带** padding / 圆角', () => {
    render(<CenterViewFrame data-testid="frame">content</CenterViewFrame>);
    const frame = screen.getByTestId('frame');

    // 海面：中心视图的背景由框架给，功能不再各画一层
    expect(frame).toHaveClass('bg-bg-primary');
    // 尺寸链：flex-1（占满中心区）+ min-h-0（允许子元素收缩）+ flex-col
    expect(frame).toHaveClass('flex', 'flex-1', 'min-h-0', 'flex-col');
    // 裁切：岛的圆角不被溢出的内容破坏
    expect(frame).toHaveClass('overflow-hidden');

    // 反证（这是「对不齐」的根因）：框架不许自带内缩与圆角 ——
    // 外圈内缩的唯一所有者是 `DockLayout` 的 `center-area`，圆角的唯一所有者是岛本身。
    expect(frame.className).not.toMatch(/(^|\s)p[xytrbl]?-/);
    expect(frame.className).not.toMatch(/(^|\s)rounded/);
    expect(frame.className).not.toMatch(/(^|\s)m[xytrbl]?-/);
  });

  it('导出的类串与组件渲染的完全一致（非 div 宿主也能复用同一份）', () => {
    render(<CenterViewFrame data-testid="frame">content</CenterViewFrame>);
    const frame = screen.getByTestId('frame');

    expect(frame).toHaveClass(...CENTER_VIEW_FRAME_CLASS.split(' '));
  });

  it('`hidden` 时整体隐藏但**不卸载**（切走再回来不重挂载）', () => {
    const { rerender } = render(
      <CenterViewFrame data-testid="frame" hidden>
        content
      </CenterViewFrame>,
    );
    expect(screen.getByTestId('frame')).toHaveClass('hidden');

    rerender(
      <CenterViewFrame data-testid="frame" hidden={false}>
        content
      </CenterViewFrame>,
    );
    expect(screen.getByTestId('frame')).not.toHaveClass('hidden');
    expect(screen.getByText('content')).toBeInTheDocument();
  });
});
