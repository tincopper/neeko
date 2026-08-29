import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// mock registry：注入跨 placement 的假清单，测试过滤行为本身
// （真实 registry 当前全为 bottom，用它测过滤会因「恰好没有 left 项」而假绿）。
vi.mock('../registry', () => ({
  fixedPanelRegistry: [
    {
      id: 'task-console',
      placement: 'bottom',
      Component: () => <div data-testid="task-console-panel" />,
    },
    { id: 'debug', placement: 'bottom', Component: () => <div data-testid="debug-panel" /> },
    { id: 'left-fake', placement: 'left', Component: () => <div data-testid="left-fake-panel" /> },
  ],
}));

import PanelHost from '../PanelHost';

describe('PanelHost placement 过滤', () => {
  it('bottom 只渲染 bottom 面板，不渲染其他 placement', () => {
    render(<PanelHost placement="bottom" />);
    expect(screen.getByTestId('task-console-panel')).toBeInTheDocument();
    expect(screen.getByTestId('debug-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('left-fake-panel')).not.toBeInTheDocument();
  });

  it('left 只渲染 left 面板', () => {
    render(<PanelHost placement="left" />);
    expect(screen.getByTestId('left-fake-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('task-console-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('debug-panel')).not.toBeInTheDocument();
  });

  it('无对应 placement 的面板时渲染 null', () => {
    const { container } = render(<PanelHost placement="right" />);
    expect(container).toBeEmptyDOMElement();
  });
});
