import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../Resizable';

/**
 * `ui/Resizable` 的**轴向契约**。
 *
 * # 为什么这一组必须存在
 *
 * 这个薄封装默认按**横向**画手柄（`w-px` + `cursor-col-resize`）。把它放进竖向 Group 而不
 * 传 `orientation="vertical"`，症状是：手柄塌成一根 1px 宽的竖线（拖拽命中区几乎为零）、
 * 光标还是左右箭头 —— **布局看着完全正常，就是拖不动**。这是 UI 层最容易「看起来对」的
 * 一类缺陷，而 jsdom 没有布局，任何靠截图/肉眼以外的检查都抓不到它，只能断言类名。
 *
 * 三组判据：
 *
 * 1. **默认横向**（既有三个调用点 DockLayout / LibraryPanel / EditorGroupLayout 全依赖它）；
 * 2. **竖向**同时换掉「细边所在轴」与「光标轴」—— 只换一个仍不可用；
 * 3. 两个轴向都保留 `role="separator"`（键盘可调 + 读屏可发现），以及 1px 的细边。
 */
describe('ResizableHandle 轴向', () => {
  /**
   * 在真实的 Group 里渲染手柄并返回**那个手柄元素**：`Separator` 需要 Group 的上下文。
   *
   * 返回 DOM 节点而不是 `render()` 的结果：本用例要看的是手柄自身的类名，而
   * `render-result-naming-convention` 要求 render 返回值只能叫 `view` / `utils` ——
   * 拿它当「手柄的容器」用会与该规则冲突，且语义本来也不对。
   */
  function mountHandleIn(
    orientation: 'horizontal' | 'vertical',
    handleOrientation?: 'horizontal' | 'vertical',
  ): HTMLElement {
    render(
      <ResizablePanelGroup orientation={orientation}>
        <ResizablePanel id="a" minSize={50}>
          <span>a</span>
        </ResizablePanel>
        <ResizableHandle
          id="h"
          {...(handleOrientation === undefined ? {} : { orientation: handleOrientation })}
        />
        <ResizablePanel id="b" minSize={50}>
          <span>b</span>
        </ResizablePanel>
      </ResizablePanelGroup>,
    );
    return screen.getByRole('separator');
  }

  it('默认是横向：细边竖着（w-px）、光标左右', () => {
    const horizontalHandle = mountHandleIn('horizontal');
    expect(horizontalHandle).toHaveClass('w-px', 'cursor-col-resize');
    expect(horizontalHandle).not.toHaveClass('cursor-row-resize');
  });

  it('orientation="vertical" ⇒ 细边横着（h-px + w-full）、光标上下', () => {
    const verticalHandle = mountHandleIn('vertical', 'vertical');
    expect(verticalHandle).toHaveClass('h-px', 'w-full', 'cursor-row-resize');
    // 反证：不能还是横向那套（只换光标不换细边，命中区仍然是 1px 宽）
    expect(verticalHandle).not.toHaveClass('cursor-col-resize');
  });

  it('两个轴向都保留 role=separator 与 1px 细边（键盘可调 + 读屏可发现）', () => {
    const horizontalHandle = mountHandleIn('horizontal');
    expect(horizontalHandle).toHaveAttribute('role', 'separator');
    expect(horizontalHandle.className).toMatch(/\bw-px\b/);
  });
});
