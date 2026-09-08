import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import InlineNameInput from '../InlineNameInput';

function ControlledHarness() {
  const [value, setValue] = useState('');
  return <InlineNameInput kind="file" value={value} onChange={setValue} />;
}

describe('InlineNameInput', () => {
  it('关闭 WebKit 自动大写 / 自动纠错 / 拼写检查', () => {
    render(<InlineNameInput kind="file" />);
    const el = screen.getByPlaceholderText('filename');
    expect(el).toHaveAttribute('autocapitalize', 'off');
    expect(el).toHaveAttribute('autocorrect', 'off');
    expect(el).toHaveAttribute('spellcheck', 'false');
  });

  it('compositionEnd 时剥离被放弃拼音缓冲区的分词空格并同步受控 state', () => {
    render(<ControlledHarness />);
    const el = screen.getByPlaceholderText('filename') as HTMLInputElement;

    // 模拟 IME 放弃组字：WebKit 提交 "hai hao"（分词空格）
    el.focus();
    fireEvent.input(el, { target: { value: 'hai hao' } });
    fireEvent.compositionEnd(el, { data: 'hai hao' });

    // guard 修正 DOM value 并派发 input 事件 → React onChange 同步
    expect(el.value).toBe('haihao');
  });
});
