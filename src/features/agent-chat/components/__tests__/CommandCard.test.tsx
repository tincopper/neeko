import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ToolCard } from '../../types';
import CommandCard from '../CommandCard';

function makeTool(overrides: Partial<ToolCard> = {}): ToolCard {
  return {
    callId: 'cmd1',
    name: 'run_command',
    title: 'cargo check --message-format=json',
    status: 'done',
    ...overrides,
  };
}

describe('CommandCard', () => {
  it('渲染 bash + 脚本名称 + 脚本路径 + 状态', () => {
    render(
      <CommandCard
        tool={makeTool()}
        scriptName="cargo-check.sh"
        scriptPath="/scripts/cargo-check.sh"
      />,
    );
    expect(screen.getByTestId('command-card')).toBeInTheDocument();
    expect(screen.getByText('bash')).toBeInTheDocument();
    expect(screen.getByText('cargo-check.sh')).toBeInTheDocument();
    expect(screen.getByText('/scripts/cargo-check.sh')).toBeInTheDocument();
    expect(screen.getByText('done')).toBeInTheDocument();
  });

  it('无脚本名称/路径时只显示 bash + 状态', () => {
    render(<CommandCard tool={makeTool()} />);
    expect(screen.getByText('bash')).toBeInTheDocument();
    expect(screen.getByText('done')).toBeInTheDocument();
  });

  it('折叠态 header 展示执行的命令（命令 + 结果同时可见）', () => {
    render(<CommandCard tool={makeTool()} />);
    // header 直接显示完整命令，即使默认折叠也能看到「执行了什么」
    expect(screen.getByText('cargo check --message-format=json')).toBeInTheDocument();
  });

  it('title 为工具名兜底时，从输出终端回显提取命令', () => {
    render(
      <CommandCard
        tool={makeTool({
          name: 'bash',
          title: 'bash',
          output: '$ wc -l src/a.rs\n   172 src/a.rs\n',
        })}
      />,
    );
    // 命令从 `$ wc -l src/a.rs` 回显提取，而非显示裸 "bash"
    expect(screen.getByText('wc -l src/a.rs')).toBeInTheDocument();
  });

  it('有输出时默认折叠，点击展开显示输出', () => {
    render(
      <CommandCard
        tool={makeTool({ output: 'Compiling neeko v1.0.6\nFinished in 8.99s' })}
        scriptName="cargo-check.sh"
        scriptPath="/scripts/cargo-check.sh"
      />,
    );
    // 默认折叠
    expect(screen.queryByTestId('command-output')).not.toBeInTheDocument();
    // 点击展开
    fireEvent.click(screen.getByTestId('command-card-header'));
    const output = screen.getByTestId('command-output');
    expect(output).toBeInTheDocument();
    expect(output).toHaveTextContent('Compiling neeko v1.0.6');
    expect(output).toHaveTextContent('Finished in 8.99s');
  });

  it('展开后可再次折叠', () => {
    render(
      <CommandCard
        tool={makeTool({ output: 'output text' })}
        scriptName="test.sh"
        scriptPath="/scripts/test.sh"
      />,
    );
    const header = screen.getByTestId('command-card-header');
    fireEvent.click(header);
    expect(screen.getByTestId('command-output')).toBeInTheDocument();
    fireEvent.click(header);
    expect(screen.queryByTestId('command-output')).not.toBeInTheDocument();
  });

  it('无输出时不显示展开按钮', () => {
    render(<CommandCard tool={makeTool({ output: undefined })} />);
    expect(screen.queryByTestId('command-card-header')).not.toBeInTheDocument();
  });

  it('按状态打 running / done / failed 类', () => {
    const { rerender } = render(<CommandCard tool={makeTool({ status: 'running' })} />);
    expect(screen.getByTestId('command-card')).toHaveClass('running');

    rerender(<CommandCard tool={makeTool({ status: 'done' })} />);
    expect(screen.getByTestId('command-card')).toHaveClass('done');

    rerender(<CommandCard tool={makeTool({ status: 'failed' })} />);
    expect(screen.getByTestId('command-card')).toHaveClass('failed');
  });
});
