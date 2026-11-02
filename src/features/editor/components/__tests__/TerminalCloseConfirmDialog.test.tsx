import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import TerminalCloseConfirmDialog from '../TerminalCloseConfirmDialog';

function setup() {
  const onBackground = vi.fn();
  const onExit = vi.fn();
  const onCancel = vi.fn();
  render(
    <TerminalCloseConfirmDialog
      open
      title="修复登录竞态"
      onBackground={onBackground}
      onExit={onExit}
      onCancel={onCancel}
    />,
  );
  return { onBackground, onExit, onCancel };
}

describe('TerminalCloseConfirmDialog', () => {
  it('三个选项都在，且点名了会话（用户要能确认关的是哪一条）', () => {
    setup();
    expect(screen.getByText('修复登录竞态')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exit Process' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run in Background' })).toBeInTheDocument();
  });

  it('每个按钮只回调它自己那一个动作', () => {
    const handlers = setup();

    fireEvent.click(screen.getByRole('button', { name: 'Run in Background' }));
    expect(handlers.onBackground).toHaveBeenCalledTimes(1);
    expect(handlers.onExit).not.toHaveBeenCalled();
    expect(handlers.onCancel).not.toHaveBeenCalled();
  });
});
