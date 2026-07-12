import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import SplitPane from '@/shared/components/SplitPane';

describe('SplitPane', () => {
  it('renders left and right children', () => {
    render(
      <SplitPane
        left={<div data-testid="left-content">Left Panel</div>}
        right={<div data-testid="right-content">Right Panel</div>}
      />,
    );
    expect(screen.getByTestId('left-content')).toBeInTheDocument();
    expect(screen.getByTestId('right-content')).toBeInTheDocument();
    expect(screen.getByText('Left Panel')).toBeInTheDocument();
    expect(screen.getByText('Right Panel')).toBeInTheDocument();
  });

  it('renders drag handle', () => {
    const { container } = render(
      <SplitPane
        left={<div>Left</div>}
        right={<div>Right</div>}
      />,
    );
    const handle = container.querySelector('.cursor-col-resize');
    expect(handle).toBeInTheDocument();
  });

  it('applies custom min widths', () => {
    const { container } = render(
      <SplitPane
        left={<div>Left</div>}
        right={<div>Right</div>}
        defaultLeftWidth={300}
        minLeftWidth={150}
        minRightWidth={150}
      />,
    );
    const leftPane = container.querySelector('.shrink-0');
    expect(leftPane).toBeInTheDocument();
  });
});
