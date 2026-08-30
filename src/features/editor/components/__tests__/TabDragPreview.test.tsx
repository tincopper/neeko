import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { Tab } from '@/shared/types/tab';

import TabDragPreview from '../TabDragPreview';

describe('TabDragPreview — DragOverlay 跟手预览', () => {
  it('渲染被拖 tab 的标题', () => {
    render(<TabDragPreview tab={{ id: 'tabA', title: 'main.rs' } as unknown as Tab} />);

    expect(screen.getByTestId('tab-drag-preview')).toHaveTextContent('main.rs');
  });

  it('无交互语义：不绑定 click/role=tab（overlay 由 dnd-kit 移动，纯展示）', () => {
    render(<TabDragPreview tab={{ id: 'tabA', title: 'A' } as unknown as Tab} />);

    const el = screen.getByTestId('tab-drag-preview');
    expect(el).not.toHaveAttribute('role');
  });

  it('保留 hover 态之外的禁用交互样式（不可误点击关闭）', () => {
    render(<TabDragPreview tab={{ id: 'tabA', title: 'A' } as unknown as Tab} />);

    // 预览壳不允许包含关闭按钮（TabItem 的 × 会误触发）
    expect(screen.queryByTitle('Close tab')).not.toBeInTheDocument();
  });
});
