import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ToolCard } from '../../types';
import ReadCard, { extractReadContent, extractReadPath } from '../ReadCard';

function makeTool(overrides: Partial<ToolCard> = {}): ToolCard {
  return {
    callId: 'tc1',
    name: 'read_file',
    title: 'src-tauri/src/agent/chat/adapter.rs',
    status: 'done',
    ...overrides,
  };
}

describe('ReadCard', () => {
  it('默认折叠：折叠标题显示 read <文件路径>，不渲染内容', () => {
    render(
      <ReadCard
        tool={makeTool({
          output: '<path>src/a.rs</path><type>file</type><content>let x = 1;\n</content>',
        })}
      />,
    );

    expect(screen.getByTestId('read-card')).toBeInTheDocument();
    expect(screen.getByText('read')).toBeInTheDocument();
    expect(screen.getByText('src-tauri/src/agent/chat/adapter.rs')).toBeInTheDocument();
    // 默认折叠：不显示读取内容
    expect(screen.queryByText('let x = 1;')).not.toBeInTheDocument();
  });

  it('展开后显示读取的文件内容（剥离 XML 包装标签）', () => {
    render(
      <ReadCard
        tool={makeTool({
          output: '<path>src/a.rs</path><type>file</type><content>let x = 1;\n</content>',
        })}
      />,
    );

    fireEvent.click(screen.getByTestId('read-card-header'));
    expect(screen.getByText('let x = 1;')).toBeInTheDocument();
    // XML 包装标签不展示
    expect(screen.queryByText(/<path>/)).not.toBeInTheDocument();
  });

  it('title 是工具名兜底时，路径从输出 <path> 提取', () => {
    render(
      <ReadCard
        tool={makeTool({
          name: 'read',
          title: 'read',
          output:
            '<path>/Users/tomgs/neeko/src-tauri/src/agent/chat/adapter/acp.rs</path><type>file</type><content>...</content>',
        })}
      />,
    );

    expect(
      screen.getByText('/Users/tomgs/neeko/src-tauri/src/agent/chat/adapter/acp.rs'),
    ).toBeInTheDocument();
  });

  it('路径为可点击元素，点击触发 onOpenFile(filePath)', () => {
    const onOpenFile = vi.fn();
    render(<ReadCard tool={makeTool()} onOpenFile={onOpenFile} />);

    const link = screen.getByTestId('file-path-link');
    fireEvent.click(link);
    expect(onOpenFile).toHaveBeenCalledWith('src-tauri/src/agent/chat/adapter.rs');
  });

  it('按状态打 running / done / failed 类', () => {
    const { rerender } = render(<ReadCard tool={makeTool({ status: 'running' })} />);
    expect(screen.getByTestId('read-card')).toHaveClass('running');
    rerender(<ReadCard tool={makeTool({ status: 'done' })} />);
    expect(screen.getByTestId('read-card')).toHaveClass('done');
    rerender(<ReadCard tool={makeTool({ status: 'failed' })} />);
    expect(screen.getByTestId('read-card')).toHaveClass('failed');
  });

  it('无输出时仍可折叠/展开，仅显示路径（展开无内容）', () => {
    render(<ReadCard tool={makeTool({ output: undefined })} />);
    fireEvent.click(screen.getByTestId('read-card-header'));
    // 无内容不崩溃
    expect(screen.getByTestId('read-card')).toBeInTheDocument();
  });
});

describe('extractReadPath / extractReadContent', () => {
  it('路径优先取 title（形如路径），否则从输出 <path> 提取', () => {
    expect(extractReadPath(makeTool())).toBe('src-tauri/src/agent/chat/adapter.rs');
    expect(
      extractReadPath(
        makeTool({
          name: 'read',
          title: 'read',
          output: '<path>src/b.rs</path>',
        }),
      ),
    ).toBe('src/b.rs');
  });

  it('内容优先取 <content> 内部，无标签时回退原文', () => {
    expect(extractReadContent('<path>a</path><content>body\n</content>')).toBe('body\n');
    expect(extractReadContent('plain output')).toBe('plain output');
    expect(extractReadContent(undefined)).toBeUndefined();
  });
});
