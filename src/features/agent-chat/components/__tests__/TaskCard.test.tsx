import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ToolCard } from '../../types';
import TaskCard from '../TaskCard';

function makeTool(overrides: Partial<ToolCard> = {}): ToolCard {
  return {
    callId: 'task1',
    name: 'task',
    title: 'general Task: 扫描代码库并总结模块边界',
    status: 'running',
    ...overrides,
  };
}

describe('TaskCard', () => {
  it('renders task name from title', () => {
    render(<TaskCard tool={makeTool()} />);
    expect(screen.getByTestId('task-card')).toBeInTheDocument();
    expect(screen.getByText('general Task: 扫描代码库并总结模块边界')).toBeInTheDocument();
  });

  it('shows running status by default', () => {
    render(<TaskCard tool={makeTool({ status: 'running' })} />);
    expect(screen.getByTestId('task-card')).toHaveClass('running');
    expect(screen.getByText('running')).toBeInTheDocument();
  });

  it('does not show output by default (collapsed)', () => {
    render(<TaskCard tool={makeTool({ output: 'task output content' })} />);
    expect(screen.queryByTestId('task-body')).not.toBeInTheDocument();
  });

  it('expands to show output when header is clicked', () => {
    render(<TaskCard tool={makeTool({ output: 'task output content' })} />);
    fireEvent.click(screen.getByTestId('task-card-header'));
    expect(screen.getByTestId('task-body')).toBeInTheDocument();
    expect(screen.getByTestId('task-body')).toHaveTextContent('task output content');
  });

  it('collapses when header is clicked again', () => {
    render(<TaskCard tool={makeTool({ output: 'task output content' })} />);
    const header = screen.getByTestId('task-card-header');
    fireEvent.click(header);
    expect(screen.getByTestId('task-body')).toBeInTheDocument();
    fireEvent.click(header);
    expect(screen.queryByTestId('task-body')).not.toBeInTheDocument();
  });

  it('shows done status with correct class', () => {
    render(<TaskCard tool={makeTool({ status: 'done' })} />);
    expect(screen.getByTestId('task-card')).toHaveClass('done');
    expect(screen.getByText('done')).toBeInTheDocument();
  });

  it('shows failed status with correct class', () => {
    render(<TaskCard tool={makeTool({ status: 'failed' })} />);
    expect(screen.getByTestId('task-card')).toHaveClass('failed');
    expect(screen.getByText('failed')).toBeInTheDocument();
  });
});
