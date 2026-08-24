import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ProposedPlanCard from '../ProposedPlanCard';

describe('ProposedPlanCard', () => {
  it('渲染计划标题与内容', () => {
    render(<ProposedPlanCard plan="## Summary\nWe'll refactor the auth module." />);

    expect(screen.getByText('Proposed Plan')).toBeInTheDocument();
    expect(screen.getByText(/We'll refactor the auth module/)).toBeInTheDocument();
  });

  it('短计划直接展开，不显示折叠按钮', () => {
    render(<ProposedPlanCard plan="Short plan." />);

    expect(screen.queryByText('Expand')).not.toBeInTheDocument();
    expect(screen.queryByText('Collapse')).not.toBeInTheDocument();
  });

  it('长计划默认折叠，显示 Expand 按钮', () => {
    const longPlan = 'A'.repeat(1000);
    render(<ProposedPlanCard plan={longPlan} />);

    expect(screen.getByText('Expand')).toBeInTheDocument();
  });

  it('点击 Expand 展开长计划，按钮变为 Collapse', () => {
    const longPlan = 'A'.repeat(1000);
    render(<ProposedPlanCard plan={longPlan} />);

    fireEvent.click(screen.getByText('Expand'));
    expect(screen.getByText('Collapse')).toBeInTheDocument();
  });

  it('点击 Copy 复制计划文本', () => {
    // jsdom 不提供 navigator.clipboard，需要手动 mock
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(<ProposedPlanCard plan="Plan to copy." />);

    fireEvent.click(screen.getByText('Copy'));
    expect(writeText).toHaveBeenCalledWith('Plan to copy.');
  });
});
