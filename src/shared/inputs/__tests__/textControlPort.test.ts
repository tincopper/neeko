import { afterEach, describe, expect, it, vi } from 'vitest';

import { focusedTextControl, insertIntoTextControl } from '../textControlPort';

/**
 * ③ 焦点文本控件端口（AC4）。
 *
 * 这一级之所以被允许存在，前提是它**真的插入**并且**真的能报失败**：
 * 返回 true 的判据是「值或选区真的变了」，而 `execCommand` 拒绝 / 什么都没变时返回 false
 * 让调用方继续降级。历史上的 `isTextInputElement(activeElement)` 恰好缺这一条 ——
 * 它把「这个元素长得像输入框」当成「文本已经进去了」，于是文本去了零监听者的 DOM 后消失。
 */

type TextControl = HTMLInputElement | HTMLTextAreaElement;

const mounted: HTMLElement[] = [];

function mount<K extends keyof HTMLElementTagNameMap>(tag: K) {
  const el = document.createElement(tag);
  document.body.appendChild(el);
  mounted.push(el);
  return el;
}

/** jsdom 没有 `document.execCommand`（返回 undefined）；用例按需装一个可控的替身。 */
function stubExecCommand(impl: ((el: Element | null, text: string) => boolean) | null) {
  const wrapper = vi.fn((command: string, _ui?: boolean, text?: string) => {
    if (command !== 'insertText' || !impl) return false;
    // 真实浏览器里 `insertText` 会把文本插到当前选区；替身让用例自己决定做什么。
    return impl(document.activeElement, text ?? '');
  });
  (document as unknown as { execCommand: unknown }).execCommand = wrapper;
  return wrapper;
}

/** 模拟浏览器的 `insertText`：在选区处替换并移动光标。 */
function browserInsertAtCaret(el: Element | null, text: string): boolean {
  const control = el as TextControl | null;
  if (!control || typeof control.selectionStart !== 'number') return false;
  const start = control.selectionStart;
  const end = control.selectionEnd ?? start;
  control.value = `${control.value.slice(0, start)}${text}${control.value.slice(end)}`;
  control.setSelectionRange(start + text.length, start + text.length);
  return true;
}

function givenCaret(el: TextControl, value: string, at: number) {
  el.value = value;
  el.focus();
  el.setSelectionRange(at, at);
}

afterEach(() => {
  for (const el of mounted.splice(0)) el.remove();
  delete (document as unknown as { execCommand?: unknown }).execCommand;
  vi.restoreAllMocks();
});

describe('focusedTextControl（③ 命中判据）', () => {
  it('focused_input_receives_text_at_cursor', () => {
    const input = mount('input');
    givenCaret(input, 'abc', 1);
    const exec = stubExecCommand(browserInsertAtCaret);

    const target = focusedTextControl();
    expect(target?.el).toBe(input);
    expect(target?.insert('X ')).toBe(true);

    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0][0]).toBe('insertText');
    expect(input.value).toBe('aX bc');
    expect(input.selectionStart).toBe(3);
  });

  it('focused_textarea_receives_text_at_cursor', () => {
    const box = mount('textarea');
    givenCaret(box, 'line1\nline2', 5);
    stubExecCommand(browserInsertAtCaret);

    const target = focusedTextControl();
    expect(target?.insert('/path/to.txt ')).toBe(true);

    expect(box.value).toBe('line1/path/to.txt \nline2');
  });

  it('focused_button_is_not_a_text_port', () => {
    const button = mount('button');
    button.focus();

    expect(focusedTextControl()).toBeNull();
  });

  it('focused_checkbox_is_not_a_text_port（<input> 也要看 type）', () => {
    const box = mount('input');
    box.type = 'checkbox';
    box.focus();

    expect(focusedTextControl()).toBeNull();
  });

  /**
   * xterm 的输入载体是 `<textarea class="xterm-helper-textarea">` —— 当年正是它让
   * 「焦点是 textarea ⇒ 这就是 agent 输入」恒真。终端有自己的端口，这个载体不是文本控件。
   */
  it('focused_xterm_helper_textarea_is_not_a_text_port', () => {
    const box = mount('textarea');
    box.className = 'xterm-helper-textarea';
    box.focus();

    expect(focusedTextControl()).toBeNull();
  });

  it('nothing_focused_is_null', () => {
    expect(focusedTextControl()).toBeNull();
  });
});

describe('insertIntoTextControl（失败必须可报）', () => {
  it('exec_command_rejected_returns_false', () => {
    const input = mount('input');
    givenCaret(input, 'abc', 3);
    stubExecCommand(null); // 浏览器拒绝执行

    expect(insertIntoTextControl(input, 'x')).toBe(false);
    expect(input.value).toBe('abc');
  });

  it('no_change_reports_false（execCommand 说成功但值/选区都没变）', () => {
    const input = mount('input');
    givenCaret(input, 'abc', 3);
    stubExecCommand(() => true); // 什么都没做

    expect(insertIntoTextControl(input, 'x')).toBe(false);
  });

  it('missing_execCommand_reports_false（非支持内核）', () => {
    const input = mount('input');
    givenCaret(input, 'abc', 3);

    expect(insertIntoTextControl(input, 'x')).toBe(false);
  });

  it('selection_only_change_still_counts（同长替换：值不变但选区变了）', () => {
    const input = mount('input');
    input.value = 'abc';
    input.focus();
    input.setSelectionRange(0, 1);
    stubExecCommand((el, text) => browserInsertAtCaret(el, text));

    expect(insertIntoTextControl(input, 'a')).toBe(true);
    expect(input.value).toBe('abc');
    expect(input.selectionStart).toBe(1);
  });
});
