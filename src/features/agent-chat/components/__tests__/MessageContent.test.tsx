import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import MessageContent from '../MessageContent';

// 包装 react-markdown 以统计实际渲染次数：验证 React.memo 在 props 不变时
// 跳过重渲染（不触发 markdown 解析），text 变化时才放行。
let markdownParseCount = 0;
vi.mock('react-markdown', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-markdown')>();
  return {
    default: (props: ComponentProps<typeof actual.default>) => {
      markdownParseCount += 1;
      return actual.default(props);
    },
  };
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

  it('标题 / 链接 / 引用 / 表格 / 有序列表（完整 markdown）', () => {
    render(
      <MessageContent
        text={
          '# 标题一\n\n> 引用内容\n\n[链接](https://example.com)\n\n1. 第一\n2. 第二\n\n| A | B |\n|---|---|\n| 1 | 2 |'
        }
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: '标题一' })).toBeInTheDocument();
    expect(screen.getByText('引用内容')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '链接' })).toHaveAttribute(
      'href',
      'https://example.com',
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '1' })).toBeInTheDocument();
  });

  it('围栏代码块渲染为 <pre><code>', () => {
    render(<MessageContent text={'```\nfn main() {}\n```'} />);
    expect(screen.getByText('fn main() {}').tagName).toBe('CODE');
  });

  it('带语言围栏代码块渲染 cb-head + <pre><code>（语法高亮拆分后按 textContent 断言）', () => {
    render(<MessageContent text={'```rust\nfn main() {}\n```'} />);
    expect(screen.getByText('rust')).toBeInTheDocument();
    // 语法高亮会把 code children 拆成 hljs span，getByText 无法整段匹配；
    // 用 textContent 聚合断言内容完整（cb-head 已由上方断言覆盖）。
    expect(screen.getByText('fn', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText(/main/)).toBeInTheDocument();
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

  it('props 不变时 React.memo 跳过重渲染（text 变化才触发 markdown 解析）', () => {
    const { rerender } = render(<MessageContent text="hello world" />);
    const parseCountAfterFirst = markdownParseCount;
    expect(parseCountAfterFirst).toBeGreaterThan(0);

    // 相同 text 重渲染 → memo 命中，react-markdown 不再执行
    rerender(<MessageContent text="hello world" />);
    expect(markdownParseCount).toBe(parseCountAfterFirst);

    // text 变化 → memo 放行，重新解析并渲染新内容
    rerender(<MessageContent text="hello world!" />);
    expect(markdownParseCount).toBeGreaterThan(parseCountAfterFirst);
    expect(screen.getByText('hello world!')).toBeInTheDocument();
    expect(screen.queryByText('hello world')).not.toBeInTheDocument();
  });
});
