import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import { Input, Textarea } from '../Input';

describe('Input', () => {
  it('默认关闭 WebKit 自动大写 / 自动纠错 / 拼写检查', () => {
    render(<Input placeholder="test" />);
    const el = screen.getByPlaceholderText('test');
    expect(el).toHaveAttribute('autocapitalize', 'off');
    expect(el).toHaveAttribute('autocorrect', 'off');
    expect(el).toHaveAttribute('spellcheck', 'false');
  });

  it('调用方可以覆盖默认属性', () => {
    render(<Input autoCapitalize="sentences" />);
    const el = screen.getByRole('textbox');
    expect(el).toHaveAttribute('autocapitalize', 'sentences');
  });

  /**
   * 行内编辑类输入框（`InlineRenameInput`）必须能在挂载时自己 focus + select，
   * 而它们复用本组件 —— 所以 `ref` 必须真的落到原生 `<input>` 上。
   */
  it('should forward ref to the native input', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} placeholder="rename" />);
    expect(ref.current).toBe(screen.getByPlaceholderText('rename'));
  });
});

describe('Textarea', () => {
  it('默认关闭 WebKit 自动大写 / 自动纠错 / 拼写检查', () => {
    render(<Textarea placeholder="test" />);
    const el = screen.getByPlaceholderText('test');
    expect(el).toHaveAttribute('autocapitalize', 'off');
    expect(el).toHaveAttribute('autocorrect', 'off');
    expect(el).toHaveAttribute('spellcheck', 'false');
  });
});

/**
 * `size="sm"` —— 设置页里大量内联编辑输入框需要的紧凑尺寸。
 *
 * 加这个变体是为了让「尺寸不同的输入框」也有**一个**复用入口：此前各页面
 * 绕开 `ui/Input` 裸写 `<input className="h-7 …">`，顺带丢掉了本组件内部的
 * 三重保护（IME 空格守卫、`noAutocorrectProps`、统一 focus ring）。
 */
describe('Input size variants', () => {
  it('should be the comfortable default size', () => {
    render(<Input data-testid="el" />);
    const el = screen.getByTestId('el');
    expect(el).toHaveClass('py-2.5');
    expect(el).not.toHaveClass('h-7');
  });

  it('should be compact for size="sm"', () => {
    render(<Input size="sm" data-testid="el" />);
    const el = screen.getByTestId('el');
    expect(el).toHaveClass('h-7', 'py-0');
    expect(el).not.toHaveClass('py-2.5');
  });

  it('should let a caller override the size with a class', () => {
    render(<Input size="sm" className="h-9" data-testid="el" />);
    expect(screen.getByTestId('el')).toHaveClass('h-9');
  });

  /** 每个尺寸都必须保留 IME 守卫与 WebKit 关断属性 —— 这正是复用它的理由。 */
  it.each(['sm', 'default'] as const)('should keep the IME + WebKit guards for %s', (size) => {
    render(<Input size={size} data-testid="el" />);
    const el = screen.getByTestId('el');
    expect(el).toHaveAttribute('autocapitalize', 'off');
    expect(el).toHaveAttribute('spellcheck', 'false');
  });
});

/**
 * IME 守卫必须**真的接线**，而不只是 import。
 *
 * 用一个精确可控的 composition 事件验证：hook 只在 `data` 命中「被放弃的拼音
 * 缓冲区」时才改写值。这里构造「值里已含该 data 且光标紧邻其后」的布局，
 * 使 hook 的修正分支必然命中，从而能观测到它是否被调用。
 *
 * 变异验证：把 `onCompositionEnd` 换回直接透传 → 本用例红。
 */
describe('Input IME guard is wired', () => {
  it('should rewrite the value when an abandoned pinyin buffer is committed', () => {
    render(<Input defaultValue="foo bar" data-testid="el" />);
    const el = screen.getByTestId('el') as HTMLInputElement;

    // 光标置于缓冲区末尾，data 与紧邻文本一致 —— hook 的修正分支条件全部满足。
    el.setSelectionRange('foo bar'.length, 'foo bar'.length);
    el.dispatchEvent(new CompositionEvent('compositionend', { data: 'foo bar', bubbles: true }));

    // 修正后分词空格被剥离。
    expect(el.value).toBe('foobar');
  });
});
