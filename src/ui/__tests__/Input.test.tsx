import { render, screen } from '@testing-library/react';
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
