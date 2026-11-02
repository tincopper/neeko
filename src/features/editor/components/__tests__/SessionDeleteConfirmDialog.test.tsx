import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import SessionDeleteConfirmDialog from '../SessionDeleteConfirmDialog';

describe('SessionDeleteConfirmDialog', () => {
  it('点名要删的会话，并说清活着时会结束进程', () => {
    render(
      <SessionDeleteConfirmDialog
        open
        title="修复登录竞态"
        onDelete={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText('修复登录竞态')).toBeInTheDocument();
    expect(screen.getByText(/the process ends/)).toBeInTheDocument();
  });

  it('两个按钮各回各自的动作', () => {
    const onDelete = vi.fn();
    const onCancel = vi.fn();
    render(<SessionDeleteConfirmDialog open title="A" onDelete={onDelete} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });
});
