/**
 * ReferencesPeekPreview：只读 CodeMirror 预览（语言高亮复用共享语言扩展）。
 * 真实语言包断言高亮 token；未知后缀回落纯文本，不抛错。
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ReferencesPeekPreview } from '../ReferencesPeekPreview';

const GO_PROPS = {
  filePath: '/proj/a.go',
  lines: ['package main', '', 'func myFn() {', '\tfmt.Println(1)', '}'],
  baseLine0: 10,
  matchLineIdx: 2,
  matchStartChar: 5,
  matchEndChar: 9,
};

describe('ReferencesPeekPreview', () => {
  it('should_highlight_syntax_tokens_with_shared_language', async () => {
    render(<ReferencesPeekPreview {...GO_PROPS} />);
    // Go 关键字经真实语言包切分为独立 token（与编辑器同源；纯文本渲染不会切分）
    expect(await screen.findByText('func')).toBeInTheDocument();
  });

  it('should_render_lines_with_offset_numbers_and_match_mark', async () => {
    render(<ReferencesPeekPreview {...GO_PROPS} />);
    // 行号 = baseLine0 + n（1-based）
    expect(await screen.findByText('13')).toBeInTheDocument();
    const preview = await screen.findByTestId('peek-preview');
    expect(preview).toHaveTextContent('fmt.Println(1)');
    expect(await screen.findByTestId('peek-match')).toHaveTextContent('myFn');
    // 单滚动条：宿主只定界，滚动交还 CM 原生 scroller
    expect(preview.className).toMatch(/overflow-hidden/);
    expect(preview.className).not.toMatch(/overflow-y-auto/);
  });

  it('should_render_plain_text_when_language_unknown', async () => {
    render(
      <ReferencesPeekPreview
        filePath="/proj/READMEXYZ"
        lines={['hello world']}
        baseLine0={0}
        matchLineIdx={0}
        matchStartChar={0}
        matchEndChar={5}
      />,
    );
    expect(await screen.findByTestId('peek-preview')).toHaveTextContent('hello world');
    expect(await screen.findByTestId('peek-match')).toHaveTextContent('hello');
  });

  it('should_render_fallback_when_no_lines', () => {
    render(<ReferencesPeekPreview {...GO_PROPS} lines={[]} />);
    expect(screen.getByText('Preview unavailable')).toBeInTheDocument();
  });

  it('should_update_content_when_item_changes', async () => {
    const { rerender } = render(<ReferencesPeekPreview {...GO_PROPS} />);
    expect(await screen.findByTestId('peek-preview')).toHaveTextContent('fmt.Println(1)');
    rerender(
      <ReferencesPeekPreview
        {...GO_PROPS}
        filePath="/proj/c.go"
        lines={['other := call()']}
        baseLine0={10}
        matchLineIdx={0}
        matchStartChar={9}
        matchEndChar={13}
      />,
    );
    expect(await screen.findByTestId('peek-preview')).toHaveTextContent('other := call()');
  });
});
