import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import JsonPreview from '@/features/editor/components/JsonPreview';

const getPre = (): HTMLElement => screen.getByText((_, el) => el?.tagName === 'PRE') as HTMLElement;

describe('JsonPreview', () => {
  it('渲染格式化后的 JSON（2 空格缩进）并带语法高亮 span', () => {
    render(<JsonPreview tabKey="k" tabId="t" content='{"a":1}' fileName="a.json" />);
    const pre = getPre();
    expect(pre).toHaveTextContent('{\n  "a": 1\n}', { collapseWhitespace: false });
    // 键与值分色渲染
    expect(within(pre).getByText('"a"')).toHaveAttribute('data-token', 'key');
    expect(within(pre).getByText('1')).toHaveAttribute('data-token', 'number');
  });

  it('非法 JSON 显示错误框而非半成品内容', () => {
    render(<JsonPreview tabKey="k" tabId="t" content='{"a": }' fileName="a.json" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText((_, el) => el?.tagName === 'PRE')).not.toBeInTheDocument();
  });

  it('内容变化时格式化结果同步更新', () => {
    const { rerender } = render(
      <JsonPreview tabKey="k" tabId="t" content='{"a":1}' fileName="a.json" />,
    );
    rerender(<JsonPreview tabKey="k" tabId="t" content='{"b":2}' fileName="a.json" />);
    expect(getPre()).toHaveTextContent('"b": 2');
  });

  it('超大 JSON 跳过高亮整块渲染，避免海量 span 卡死 UI', () => {
    const bigValue = 'x'.repeat(300 * 1024);
    render(<JsonPreview tabKey="k" tabId="t" content={`{"a":"${bigValue}"}`} fileName="a.json" />);
    const pre = getPre();
    expect(pre).toHaveTextContent('"a": "xxx');
    // 整块文本节点渲染：无任何 token span 子元素
    expect(within(pre).queryByText('"a"')).not.toBeInTheDocument();
  });
});
