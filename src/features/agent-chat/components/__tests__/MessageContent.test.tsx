import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import * as messageContent from '@/features/agent-chat/utils/messageContent';

import MessageContent from '../MessageContent';

// 包装 parseMessageBlocks 以统计调用次数：验证 React.memo + useMemo 的缓存行为。
vi.mock('@/features/agent-chat/utils/messageContent', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, parseMessageBlocks: vi.fn(actual.parseMessageBlocks) };
});

describe('MessageContent', () => {
  it('纯文本渲染为单个 <p>', () => {
    render(<MessageContent text="hello" />);
    expect(screen.getByText('hello').tagName).toBe('P');
  });

  it('空白行分段渲染多个 <p>', () => {
    render(<MessageContent text={'第一段\n\n第二段'} />);
    expect(screen.getByText('第一段')).toBeInTheDocument();
    expect(screen.getByText('第二段')).toBeInTheDocument();
    expect(screen.getAllByRole('paragraph')).toHaveLength(2);
  });

  it('行内 code 渲染为 <code>', () => {
    render(<MessageContent text="运行 `pnpm install` 安装依赖" />);
    expect(screen.getByText('pnpm install').tagName).toBe('CODE');
  });

  it('**加粗** 渲染为 <strong>', () => {
    render(<MessageContent text="**完成** 了" />);
    expect(screen.getByText('完成').tagName).toBe('STRONG');
  });

  it('- 列表渲染为 <ul><li>', () => {
    render(<MessageContent text={'- 甲\n- 乙'} />);
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('围栏代码块渲染为 <pre><code>', () => {
    render(<MessageContent text={'```\nfn main() {}\n```'} />);
    expect(screen.getByText('fn main() {}').tagName).toBe('CODE');
  });

  it('空内容围栏不渲染 <pre>（流式切块/异常中断留下的空壳不再显示为空白盒）', () => {
    const { container } = render(<MessageContent text={'```bash\n```'} />);
    expect(container).not.toContainHTML('<pre>');
  });

  it('正文代码块与工具输出重复时不渲染（CommandCard 已展示同一份内容）', () => {
    const output = [
      'total 2352',
      'drwxr-xr-x@ 65 tomgs staff   2080 Aug 22 18:05 .',
      'drwxr-xr-x@ 14 tomgs staff    448 Aug 21 13:29 ..',
      '-rw-r--r--@  1 tomgs staff  27224 Aug 16 11:32 AGENTS.md',
      '-rw-r--r--@  1 tomgs staff   4571 Aug 20 10:39 package.json',
    ].join('\n');
    const text = [
      '命令结果：',
      '',
      '```',
      'total 2352',
      'drwxr-xr-x@ 65 tomgs staff   2080 Aug 22 18:05 .',
      'drwxr-xr-x@ 14 tomgs staff    448 Aug 21 13:29 ..',
      '-rw-r--r--@  1 tomgs staff  27224 Aug 16 11:32 AGENTS.md',
      '...',
    ].join('\n');

    // 有工具输出 → 正文重复代码块被隐藏，段落保留
    const { rerender } = render(<MessageContent text={text} toolOutputs={[output]} />);
    expect(screen.queryByText(/total 2352/)).not.toBeInTheDocument();
    expect(screen.getByText('命令结果：').tagName).toBe('P');

    // 无工具输出 → 正常渲染
    rerender(<MessageContent text={text} />);
    expect(screen.getByText(/total 2352/)).toBeInTheDocument();
  });

  it('空文本返回 null', () => {
    const { container } = render(<MessageContent text="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('props 不变时 React.memo 跳过重渲染（parseMessageBlocks 不重复执行）', () => {
    const spy = vi.mocked(messageContent.parseMessageBlocks);
    spy.mockClear();

    const { rerender } = render(<MessageContent text="hello world" />);
    const callsAfterFirst = spy.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    // 相同 text 重渲染 → memo 命中，不再解析
    rerender(<MessageContent text="hello world" />);
    expect(spy.mock.calls.length).toBe(callsAfterFirst);

    // text 变化 → memo 放行，重新解析
    rerender(<MessageContent text="hello world!" />);
    expect(spy.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });
});
