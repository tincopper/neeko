import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import ContextWindowMeter from '../ContextWindowMeter';

describe('ContextWindowMeter', () => {
  it('渲染上下文窗口百分比', () => {
    render(<ContextWindowMeter used={68} total={100} model="claude-sonnet" />);

    expect(screen.getByText('68%')).toBeInTheDocument();
  });

  it('计算正确的百分比', () => {
    render(<ContextWindowMeter used={50} total={200} model="claude-sonnet" />);

    expect(screen.getByText('25%')).toBeInTheDocument();
  });

  it('total 为 0 时不崩溃，显示 0%', () => {
    render(<ContextWindowMeter used={0} total={0} model="claude-sonnet" />);

    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('hover 时显示详细 token 信息', () => {
    render(<ContextWindowMeter used={68} total={100} model="claude-sonnet" />);

    // title 属性包含详细使用情况（含模型名）；title 位于 .ctx-meter 根节点
    const meter = screen.getByTitle('68% used · 68k/100k tokens · claude-sonnet');
    expect(meter).toHaveClass('ctx-meter');
  });

  it('高使用率时显示警告色', () => {
    render(<ContextWindowMeter used={95} total={100} model="claude-sonnet" />);

    expect(screen.getByText('95%')).toBeInTheDocument();
  });
});
