import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import DiffToolbar from '../DiffToolbar';

const baseProps = {
  title: 'a.ts',
  additions: 3,
  deletions: 1,
  viewMode: 'unified' as const,
  onViewModeChange: vi.fn(),
};

describe('DiffToolbar — Open File 按钮', () => {
  it('传入 onOpenFile 时渲染按钮，点击触发回调', () => {
    const onOpenFile = vi.fn();
    render(<DiffToolbar {...baseProps} onOpenFile={onOpenFile} />);

    const btn = screen.getByTitle('Open File');
    fireEvent.click(btn);

    expect(onOpenFile).toHaveBeenCalledTimes(1);
  });

  it('未传 onOpenFile 时不渲染按钮', () => {
    render(<DiffToolbar {...baseProps} />);

    expect(screen.queryByTitle('Open File')).not.toBeInTheDocument();
  });
});
