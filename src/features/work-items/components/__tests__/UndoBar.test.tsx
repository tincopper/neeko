/**
 * `UndoBar`：5 秒窗口的唯一呈现 + **换一条被删项要重起计时器**。
 *
 * 只钉两件事：
 * 1. 到点调 `onExpire`（宿主据此收起条子）；
 * 2. 5 秒内又删了一条时（宿主换了 `title`，组件没卸载）计时器**重起** ——
 *    继承上一条的起点会让第二条的入口早于它的窗口消失（store 里仍可撤销，界面上没有按钮）。
 *
 * 这里用 fake timers 真推进 5000ms：真时钟下这条用例只能靠「等"，而等待的断言在 CI 上会变成
 * 偶发红（见 `.trellis/spec/unit-test/frontend-testing.md` 的 useToast 先例）。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import UndoBar from '../UndoBar';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('UndoBar', () => {
  it('点名的标题 + 5 秒后自动收起', () => {
    const onExpire = vi.fn();
    render(<UndoBar title="修复登录" onUndo={vi.fn()} onExpire={onExpire} />);

    expect(screen.getByText('Deleted "修复登录"')).toBeInTheDocument();

    vi.advanceTimersByTime(4999);
    expect(onExpire).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('换了一条被删项时计时器重起（不继承上一条的起点）', () => {
    const onExpire = vi.fn();
    const onUndo = vi.fn();
    const { rerender } = render(<UndoBar title="第一条" onUndo={onUndo} onExpire={onExpire} />);

    // 第一条的窗口已经过去 4 秒（旧钟还剩 1 秒）。
    vi.advanceTimersByTime(4000);

    rerender(<UndoBar title="第二条" onUndo={onUndo} onExpire={onExpire} />);
    expect(screen.getByText('Deleted "第二条"')).toBeInTheDocument();

    // 旧钟到点（t=5s）不该收起：第二条自己的窗口从 t=4s 才起算。
    vi.advanceTimersByTime(1000);
    expect(onExpire).not.toHaveBeenCalled();

    // 第二条的完整 5 秒（t=9s）才收起。
    vi.advanceTimersByTime(3999);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('卸载时清掉计时器（不许在别的面板上开火）', () => {
    const onExpire = vi.fn();
    const { unmount } = render(<UndoBar title="x" onUndo={vi.fn()} onExpire={onExpire} />);

    unmount();
    vi.advanceTimersByTime(10_000);

    expect(onExpire).not.toHaveBeenCalled();
  });

  it('点「撤销」转交宿主，本组件不自己结算窗口', () => {
    const onUndo = vi.fn();
    const onExpire = vi.fn();
    render(<UndoBar title="x" onUndo={onUndo} onExpire={onExpire} />);

    // 用 `fireEvent` 而不是 `userEvent`：后者与 fake timers 交互需要额外配置
    // （`advanceTimers`），而这里要钉的只是「点击转发"，不是输入时序。
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(onUndo).toHaveBeenCalledTimes(1);
    // 撤与不撤由宿主按 `undoDelete()` 的返回值决定；本组件只发信号。
    expect(onExpire).not.toHaveBeenCalled();
  });
});

describe('UndoBar — 表面（2026-11-03）', () => {
  /**
   * UndoBar 是**岛内的底条**，不是控件，也不该自刷表面。
   *
   * 判据与 `TasksPanelHeader` 同款：岛内的一条横条与它所在的岛是同一个平面，只靠
   * `border-t` 划界。刷一层 `bg-bg-tertiary` 会与它上面的分区（也是 tertiary）
   * 直接连成一片 —— 用户看不出「这条是可撤销提示"而不是「列表的最后一格"。
   */
  it('只靠 border-t 划界，不自刷表面', () => {
    // `onExpire` 必须给：`setTimeout` 收到 undefined 会抛「Callback must be provided"。
    render(<UndoBar title="修复登录" onUndo={vi.fn()} onExpire={vi.fn()} />);

    // items子本身就是 `role="status"` 容器 —— 直接按角色取，不靠 closest 爬 DOM。
    const bar = screen.getByRole('status');
    expect(bar).toHaveClass('border-t', 'border-border');
    expect(bar).not.toHaveClass('bg-bg-tertiary');
    expect(bar).not.toHaveClass('bg-bg-secondary');
    expect(bar).not.toHaveClass('bg-bg-primary');
  });
});
