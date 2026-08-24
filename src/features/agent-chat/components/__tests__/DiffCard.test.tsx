import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ToolCard } from '../../types';
import DiffCard from '../DiffCard';

function makeTool(overrides: Partial<ToolCard> = {}): ToolCard {
  return {
    callId: 'tc1',
    name: 'edit_file',
    title: 'src-tauri/src/agent/chat/adapter.rs',
    status: 'done',
    output: '@@ -1,3 +1,3 @@\n-old line\n+new line\n context',
    ...overrides,
  };
}

describe('DiffCard', () => {
  it('默认展开，展示 diff 内容 + 对比高亮（add/rem/hunk class）', () => {
    render(<DiffCard tool={makeTool()} />);

    const card = screen.getByTestId('diff-card');
    expect(card).toBeInTheDocument();
    expect(card).toHaveClass('open');

    const output = screen.getByTestId('diff-output');
    expect(within(output).getByText('+new line')).toHaveClass('dl', 'add');
    expect(within(output).getByText('-old line')).toHaveClass('dl', 'rem');
    expect(within(output).getByText('@@ -1,3 +1,3 @@')).toHaveClass('dl', 'hunk');
  });

  it('头部显示 diff 的文件路径', () => {
    render(<DiffCard tool={makeTool()} />);
    // 路径出现在头部与展开区头部
    expect(screen.getAllByText('src-tauri/src/agent/chat/adapter.rs').length).toBeGreaterThan(0);
    const header = screen.getByTestId('diff-card-header');
    expect(header).toHaveTextContent('src-tauri/src/agent/chat/adapter.rs');
  });

  it('可折叠/再次展开', () => {
    render(<DiffCard tool={makeTool()} />);
    expect(screen.getByTestId('diff-output')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('diff-card-header'));
    expect(screen.queryByTestId('diff-output')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('diff-card-header'));
    expect(screen.getByTestId('diff-output')).toBeInTheDocument();
  });

  it('无输出时不渲染 diff 内容', () => {
    render(<DiffCard tool={makeTool({ output: undefined })} />);
    expect(screen.queryByTestId('diff-output')).not.toBeInTheDocument();
  });

  it('非 diff 输出（错误信息）走 markdown 渲染', () => {
    render(
      <DiffCard
        tool={makeTool({
          output:
            '**Error**: could not find `oldString` in the file.\n\n- check whitespace\n- check indentation',
        })}
      />,
    );
    const output = screen.getByTestId('diff-output');
    // markdown：加粗、行内 code、列表
    expect(within(output).getByText('Error')).toBeInTheDocument();
    expect(within(output).getByText('oldString')).toBeInTheDocument();
    expect(within(output).getByText('check whitespace')).toBeInTheDocument();
    expect(within(output).getByText('check indentation')).toBeInTheDocument();
    // 不渲染 .dl diff 行
    expect(within(output).queryByText(/^@@/)).not.toBeInTheDocument();
  });

  it('按状态打 running / done / failed 类', () => {
    const { rerender } = render(<DiffCard tool={makeTool({ status: 'running' })} />);
    expect(screen.getByTestId('diff-card')).toHaveClass('running');
    rerender(<DiffCard tool={makeTool({ status: 'failed' })} />);
    expect(screen.getByTestId('diff-card')).toHaveClass('failed');
  });
});
