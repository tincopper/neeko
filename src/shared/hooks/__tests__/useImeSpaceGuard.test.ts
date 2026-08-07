import { fireEvent, render, renderHook } from '@testing-library/react';
import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useImeSpaceGuard } from '@/shared/hooks/useImeSpaceGuard';

/** 构造一个仅包含 hook 所需字段的伪 React 合成事件。 */
function makeFakeEvent<T extends HTMLInputElement | HTMLTextAreaElement>(
  currentTarget: T,
  data: string,
): React.CompositionEvent<T> {
  return { currentTarget, data } as unknown as React.CompositionEvent<T>;
}

/** 设定光标位置：IME 提交总是发生在光标处，guard 以 selectionStart 为锚点定位。 */
function setCaret(el: HTMLInputElement | HTMLTextAreaElement, pos: number) {
  el.setSelectionRange(pos, pos);
}

describe('useImeSpaceGuard', () => {
  it("textarea value='hai hao'、光标在末尾、data='hai hao' 时剥离空格为 'haihao' 并派发 input 事件", () => {
    const { result } = renderHook(() => useImeSpaceGuard<HTMLTextAreaElement>());
    const textarea = document.createElement('textarea');
    textarea.value = 'hai hao';
    setCaret(textarea, 7);
    const inputSpy = vi.fn();
    textarea.addEventListener('input', inputSpy);

    result.current.onCompositionEnd(makeFakeEvent(textarea, 'hai hao'));

    expect(textarea.value).toBe('haihao');
    expect(inputSpy).toHaveBeenCalledTimes(1);
  });

  it("textarea value='你好'、data='你好' 时 value 不变且不派发 input 事件", () => {
    const { result } = renderHook(() => useImeSpaceGuard<HTMLTextAreaElement>());
    const textarea = document.createElement('textarea');
    textarea.value = '你好';
    const inputSpy = vi.fn();
    textarea.addEventListener('input', inputSpy);

    result.current.onCompositionEnd(makeFakeEvent(textarea, '你好'));

    expect(textarea.value).toBe('你好');
    expect(inputSpy).not.toHaveBeenCalled();
  });

  it("textarea value='hello'、data='hai hao'（光标前文本不匹配）时 value 不变", () => {
    const { result } = renderHook(() => useImeSpaceGuard<HTMLTextAreaElement>());
    const textarea = document.createElement('textarea');
    textarea.value = 'hello';
    setCaret(textarea, 5);
    const inputSpy = vi.fn();
    textarea.addEventListener('input', inputSpy);

    result.current.onCompositionEnd(makeFakeEvent(textarea, 'hai hao'));

    expect(textarea.value).toBe('hello');
    expect(inputSpy).not.toHaveBeenCalled();
  });

  it("textarea value='hai hao'、data='hai'（无空格）时 value 不变", () => {
    const { result } = renderHook(() => useImeSpaceGuard<HTMLTextAreaElement>());
    const textarea = document.createElement('textarea');
    textarea.value = 'hai hao';
    const inputSpy = vi.fn();
    textarea.addEventListener('input', inputSpy);

    result.current.onCompositionEnd(makeFakeEvent(textarea, 'hai'));

    expect(textarea.value).toBe('hai hao');
    expect(inputSpy).not.toHaveBeenCalled();
  });

  it("textarea value='hello'、data='   '（纯空格）时 value 不变", () => {
    const { result } = renderHook(() => useImeSpaceGuard<HTMLTextAreaElement>());
    const textarea = document.createElement('textarea');
    textarea.value = 'hello';
    const inputSpy = vi.fn();
    textarea.addEventListener('input', inputSpy);

    result.current.onCompositionEnd(makeFakeEvent(textarea, '   '));

    expect(textarea.value).toBe('hello');
    expect(inputSpy).not.toHaveBeenCalled();
  });

  it("textarea value='hai hao 你好'、光标在缓冲区之后、data='hai hao' 时只替换命中段", () => {
    const { result } = renderHook(() => useImeSpaceGuard<HTMLTextAreaElement>());
    const textarea = document.createElement('textarea');
    textarea.value = 'hai hao 你好';
    setCaret(textarea, 7);

    result.current.onCompositionEnd(makeFakeEvent(textarea, 'hai hao'));

    expect(textarea.value).toBe('haihao 你好');
  });

  it('data 为空时 value 不变', () => {
    const { result } = renderHook(() => useImeSpaceGuard<HTMLTextAreaElement>());
    const textarea = document.createElement('textarea');
    textarea.value = 'hai hao';

    result.current.onCompositionEnd(makeFakeEvent(textarea, ''));

    expect(textarea.value).toBe('hai hao');
  });

  it('对 input 元素同样生效', () => {
    const { result } = renderHook(() => useImeSpaceGuard<HTMLInputElement>());
    const input = document.createElement('input');
    input.value = 'hai hao';
    setCaret(input, 7);
    const inputSpy = vi.fn();
    input.addEventListener('input', inputSpy);

    result.current.onCompositionEnd(makeFakeEvent(input, 'hai hao'));

    expect(input.value).toBe('haihao');
    expect(inputSpy).toHaveBeenCalledTimes(1);
  });

  it('值中同文本出现两次、光标在末尾时只修正光标处的末尾段', () => {
    const { result } = renderHook(() => useImeSpaceGuard<HTMLTextAreaElement>());
    const textarea = document.createElement('textarea');
    textarea.value = 'x hai hao y hai hao';
    setCaret(textarea, textarea.value.length); // 光标在末尾，'hai hao' 已多次出现

    result.current.onCompositionEnd(makeFakeEvent(textarea, 'hai hao'));

    expect(textarea.value).toBe('x hai hao y haihao');
  });

  it('光标在中间且光标前恰为缓冲区时仅替换该段', () => {
    const { result } = renderHook(() => useImeSpaceGuard<HTMLTextAreaElement>());
    const textarea = document.createElement('textarea');
    textarea.value = 'prefix hai hao suffix';
    setCaret(textarea, 'prefix hai hao'.length);

    result.current.onCompositionEnd(makeFakeEvent(textarea, 'hai hao'));

    expect(textarea.value).toBe('prefix haihao suffix');
  });

  it('值中同文本位于光标之后时不误伤（锚点回退不命中）', () => {
    const { result } = renderHook(() => useImeSpaceGuard<HTMLTextAreaElement>());
    const textarea = document.createElement('textarea');
    textarea.value = 'abc hai hao';
    setCaret(textarea, 3); // 光标在 'abc' 后，'hai hao' 在光标之后

    result.current.onCompositionEnd(makeFakeEvent(textarea, 'hai hao'));

    expect(textarea.value).toBe('abc hai hao');
  });

  it('受控组件：compositionend 剥离后 React state 与 DOM 同步为剥离值', () => {
    function ControlledTextarea() {
      const [value, setValue] = useState('hai hao');
      const guard = useImeSpaceGuard<HTMLTextAreaElement>();
      return React.createElement('textarea', {
        value,
        onChange: (e) => setValue(e.target.value),
        onCompositionEnd: guard.onCompositionEnd,
      });
    }

    const { container } = render(React.createElement(ControlledTextarea));
    const textarea = container.querySelector('textarea')!;
    textarea.setSelectionRange(7, 7);

    fireEvent.compositionEnd(textarea, { data: 'hai hao' });

    expect(textarea.value).toBe('haihao');
  });

  it('受控组件：真实 CJK 提交（data=你好）时 state 不变', () => {
    function ControlledTextarea() {
      const [value, setValue] = useState('你好');
      const guard = useImeSpaceGuard<HTMLTextAreaElement>();
      return React.createElement('textarea', {
        value,
        onChange: (e) => setValue(e.target.value),
        onCompositionEnd: guard.onCompositionEnd,
      });
    }

    const { container } = render(React.createElement(ControlledTextarea));
    const textarea = container.querySelector('textarea')!;

    fireEvent.compositionEnd(textarea, { data: '你好' });

    expect(textarea.value).toBe('你好');
  });
});
