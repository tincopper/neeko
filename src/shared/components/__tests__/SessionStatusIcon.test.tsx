import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import SessionStatusIcon from '@/shared/components/SessionStatusIcon';
import type { SessionState } from '@/shared/types/liveSessions';

/**
 * 状态 → 视觉的**唯一表**：每个状态都有确定输出（穷举 5 态）。
 *
 * 断言的是「表格的行存在且可区分」而不是某个类名好看 —— 颜色 / 形状是实现的表达，
 * 但**五个状态必须各不相同**才是契约（否则侧栏与 tab 会读到不同的第二个真相）。
 */
const ALL_STATES: SessionState[] = ['running', 'awaitingApproval', 'failed', 'ready', 'stopped'];

describe('SessionStatusIcon', () => {
  it.each(ALL_STATES)('%s 有确定视觉（含 aria-label 与 data 标记）', (state) => {
    render(<SessionStatusIcon status={state} />);
    const dot = screen.getByRole('img');
    expect(dot).toHaveAttribute('data-session-state', state);
    expect(dot.getAttribute('aria-label')).not.toBe('');
  });

  it('五个状态的视觉两两不同（颜色 + 形状共同构成判据）', () => {
    const signatures = ALL_STATES.map((state) => {
      const { unmount } = render(<SessionStatusIcon status={state} />);
      const dot = screen.getByRole('img');
      // 类名 + 内联尺寸共同构成视觉签名（`toHaveClass` 只判包含，无法判「两两不同」）
      const signature = `${dot.getAttribute('class')}|${dot.getAttribute('style') ?? ''}`;
      unmount();
      return signature;
    });

    expect(new Set(signatures).size).toBe(ALL_STATES.length);
  });

  it('running 带呼吸动画（「还活着」的第二个通道），其它状态不带', () => {
    const { unmount } = render(<SessionStatusIcon status="running" />);
    expect(screen.getByRole('img')).toHaveClass('live-dot-running');
    unmount();

    for (const state of ALL_STATES.filter((s) => s !== 'running')) {
      const { unmount: done } = render(<SessionStatusIcon status={state} />);
      expect(screen.getByRole('img')).not.toHaveClass('live-dot-running');
      done();
    }
  });

  it('无状态（null / undefined）渲染 null —— 不是灰点', () => {
    const { unmount } = render(<SessionStatusIcon status={null} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    unmount();

    render(<SessionStatusIcon />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('size 生效，且等待审批的菱形在内部缩 1px 做光学修正', () => {
    const { unmount } = render(<SessionStatusIcon status="ready" size={10} />);
    expect(screen.getByRole('img')).toHaveStyle({ width: '10px', height: '10px' });
    unmount();

    render(<SessionStatusIcon status="awaitingApproval" size={10} />);
    expect(screen.getByRole('img')).toHaveStyle({ width: '9px', height: '9px' });
  });
});
