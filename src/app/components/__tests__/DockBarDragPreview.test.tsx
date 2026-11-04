import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { panelView } from '@/shared/dock';

import DockBarDragPreview from '../DockBarDragPreview';

/**
 * DragOverlay 的内容本体（纯展示）。状态归属在 `useDockBarDnd`，这里只钉两件事：
 * 尺寸与工具栏图标位一致（否则松手时落点看着会「跳」），以及**没有**交互语义。
 */

describe('DockBarDragPreview — 拖拽跟手预览', () => {
  it('尺寸与 DockBarButton 的图标位一致（外框 44px / chip 32px / 图标 20px）', () => {
    render(<DockBarDragPreview view={panelView('files')} />);

    const preview = screen.getByTestId('dock-bar-drag-preview');
    expect(preview).toHaveClass('w-11', 'h-11');

    // 内层 chip 是装饰性结构，无 Testing Library 等价查询
    // eslint-disable-next-line testing-library/no-node-access
    const chip = preview.firstElementChild as HTMLElement;
    expect(chip).toHaveClass('w-8', 'h-8');
    // eslint-disable-next-line testing-library/no-node-access
    const icon = chip.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon).toHaveClass('h-5');
  });

  it('无交互语义：overlay 由 dnd-kit 移动，任何可点击子元素都会误触', () => {
    render(<DockBarDragPreview view={panelView('files')} />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByTestId('dock-bar-drag-preview')).not.toHaveAttribute('role');
  });

  it('声明表里没有的视图 → 不渲染（不猜图标）', () => {
    render(<DockBarDragPreview view={panelView('ghost')} />);

    expect(screen.queryByTestId('dock-bar-drag-preview')).not.toBeInTheDocument();
  });
});
