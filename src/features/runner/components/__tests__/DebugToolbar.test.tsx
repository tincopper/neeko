import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import DebugToolbar, { type DebugToolbarAction } from '../DebugToolbar';

function renderToolbar(props: Partial<React.ComponentProps<typeof DebugToolbar>> = {}) {
  const onAction = vi.fn<(action: DebugToolbarAction) => void>();
  const onToggleMute = vi.fn();
  const view = render(
    <DebugToolbar
      isStopped={false}
      isRunning={false}
      onAction={onAction}
      onToggleMute={onToggleMute}
      {...props}
    />,
  );
  return { onAction, onToggleMute, ...view };
}

describe('DebugToolbar — Rerun', () => {
  it('无 intent 时禁用；title 带上次启动名', () => {
    renderToolbar({ canRerun: false, rerunLabel: 'Debug test: test1' });
    const btn = screen.getByTitle('Rerun Debug test: test1') as HTMLButtonElement;
    expect(btn).toBeDisabled();
  });

  it('可重跑时启用并触发 rerun action', () => {
    const { onAction } = renderToolbar({ canRerun: true, rerunLabel: 'cfg' });
    const btn = screen.getByTitle('Rerun cfg');
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onAction).toHaveBeenCalledWith('rerun');
  });
});

describe('DebugToolbar — Mute（评审 P5）', () => {
  it('未静音：aria-pressed=false，title 为 Mute all breakpoints', () => {
    renderToolbar({ muted: false, total: 2 });
    const btn = screen.getByTitle('Mute all breakpoints');
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(btn).toBeEnabled();
  });

  it('静音：aria-pressed=true，title 为 Unmute breakpoints，点击触发 onToggleMute', () => {
    const { onToggleMute } = renderToolbar({ muted: true, total: 2 });
    const btn = screen.getByTitle('Unmute breakpoints');
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(btn);
    expect(onToggleMute).toHaveBeenCalledTimes(1);
  });

  it('零断点禁用，但 muted 残留仍显示 active 态（aria-pressed 不随 disabled 消失）', () => {
    renderToolbar({ muted: true, total: 0 });
    const btn = screen.getByTitle('Unmute breakpoints') as HTMLButtonElement;
    expect(btn).toBeDisabled();
    // 评审 P5：mute 后删光断点 → 按钮 disabled，但静音态仍可见（否则用户无从察觉）。
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  it('零断点且未静音：禁用且非 active', () => {
    renderToolbar({ muted: false, total: 0 });
    const btn = screen.getByTitle('Mute all breakpoints') as HTMLButtonElement;
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('DebugToolbar — 既有按钮不变', () => {
  it('continue 仅在 stopped 时启用', () => {
    renderToolbar({ isStopped: true });
    expect(screen.getByTitle('Continue (F5)')).toBeEnabled();
  });
});
