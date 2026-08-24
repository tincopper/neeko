import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import WorkingIndicator from '../WorkingIndicator';

describe('WorkingIndicator', () => {
  it('渲染 Working… 文本', () => {
    render(<WorkingIndicator durationMs={5000} activeTool={null} />);

    expect(screen.getByText(/Working/)).toBeInTheDocument();
  });

  it('显示格式化后的持续时间', () => {
    render(<WorkingIndicator durationMs={12_000} activeTool={null} />);

    expect(screen.getByText(/12s/)).toBeInTheDocument();
  });

  it('有活动工具时显示工具名', () => {
    render(<WorkingIndicator durationMs={3000} activeTool="Running tests..." />);

    expect(screen.getByText('Running tests...')).toBeInTheDocument();
  });

  it('无活动工具时不显示工具名', () => {
    render(<WorkingIndicator durationMs={3000} activeTool={null} />);

    expect(screen.queryByClassName?.('working-tool')).toBeFalsy();
  });

  it('显示旋转动画图标', () => {
    render(<WorkingIndicator durationMs={1000} activeTool={null} />);

    // spin 类名表示旋转动画（组件根节点 data-testid=working-indicator）
    expect(screen.getByTestId('working-indicator')).toContainHTML('spin working-spinner');
  });
});
