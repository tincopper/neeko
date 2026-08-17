import type { Terminal } from '@xterm/xterm';
import { describe, expect, it, vi } from 'vitest';

import { isAbandonedImeAsciiBuffer, setupTerminalInput } from '../terminalInput';

type DataHandler = (data: string) => void;

type CustomKeyHandler = (event: KeyboardEvent) => boolean;

class MockTerminal {
  readonly textarea = document.createElement('textarea');
  private dataHandler: DataHandler | null = null;
  private customKeyHandler: CustomKeyHandler | null = null;

  onData(handler: DataHandler) {
    this.dataHandler = handler;
    return {
      dispose: () => {
        this.dataHandler = null;
      },
    };
  }

  attachCustomKeyEventHandler(handler: CustomKeyHandler) {
    this.customKeyHandler = handler;
  }

  emitData(data: string) {
    this.dataHandler?.(data);
  }

  /** Simulate a key event through the custom key handler. Returns the handler result. */
  simulateKeyEvent(event: KeyboardEvent): boolean {
    return this.customKeyHandler?.(event) ?? true;
  }
}

function createInputEvent(data: string): InputEvent {
  return new InputEvent('beforeinput', {
    data,
    inputType: 'insertText',
    bubbles: true,
    cancelable: true,
    composed: true,
  });
}

function createKeyboardEvent(type: 'keydown' | 'keyup', init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    ...init,
  });
}

describe('isAbandonedImeAsciiBuffer', () => {
  it("判定 'hai hao' 为被放弃的拼音缓冲区", () => {
    expect(isAbandonedImeAsciiBuffer('hai hao')).toBe(true);
  });

  it("判定 'a b c' 为被放弃的拼音缓冲区", () => {
    expect(isAbandonedImeAsciiBuffer('a b c')).toBe(true);
  });

  it("判定 'haihao' 不是被放弃的拼音缓冲区（无空格）", () => {
    expect(isAbandonedImeAsciiBuffer('haihao')).toBe(false);
  });

  it("判定 '中' 不是被放弃的拼音缓冲区（非 ASCII）", () => {
    expect(isAbandonedImeAsciiBuffer('中')).toBe(false);
  });

  it("判定 ' ' 不是被放弃的拼音缓冲区（纯空格）", () => {
    expect(isAbandonedImeAsciiBuffer(' ')).toBe(false);
  });

  it("判定 '' 不是被放弃的拼音缓冲区（空字符串）", () => {
    expect(isAbandonedImeAsciiBuffer('')).toBe(false);
  });
});

describe('setupTerminalInput', () => {
  it('转发 xterm onData 输入', () => {
    const term = new MockTerminal();
    const sendInput = vi.fn();

    setupTerminalInput({
      term: term as unknown as Terminal,
      sendInput,
    });

    term.emitData('abc');

    expect(sendInput).toHaveBeenCalledWith('abc');
  });

  it('转发普通空格输入', () => {
    const term = new MockTerminal();
    const sendInput = vi.fn();

    setupTerminalInput({
      term: term as unknown as Terminal,
      sendInput,
    });

    term.emitData(' ');

    expect(sendInput).toHaveBeenCalledWith(' ');
  });

  it('dispose 后不再转发 xterm onData 输入', () => {
    const term = new MockTerminal();
    const sendInput = vi.fn();
    const controller = setupTerminalInput({
      term: term as unknown as Terminal,
      sendInput,
    });

    controller.dispose();
    term.emitData('abc');

    expect(sendInput).not.toHaveBeenCalled();
  });

  it('在中文 IME 的 Shift 符号 beforeinput 早于真实 keydown 时补发一次 input', () => {
    const term = new MockTerminal();
    const inputEvents: InputEvent[] = [];
    term.textarea.addEventListener('input', (event) => {
      inputEvents.push(event as InputEvent);
    });

    setupTerminalInput({
      term: term as unknown as Terminal,
      sendInput: vi.fn(),
    });

    term.textarea.dispatchEvent(
      createKeyboardEvent('keydown', {
        key: 'Shift',
        code: 'ShiftLeft',
        keyCode: 16,
        shiftKey: true,
      }),
    );
    term.textarea.dispatchEvent(createInputEvent('？'));

    expect(inputEvents).toHaveLength(1);
    expect(inputEvents[0].data).toBe('？');
    expect(inputEvents[0].inputType).toBe('insertText');
    expect(inputEvents[0].composed).toBe(false);
  });

  it('补发 Shift+数字产生的中文标点和 ASCII 符号', () => {
    const term = new MockTerminal();
    const inputEvents: InputEvent[] = [];
    term.textarea.addEventListener('input', (event) => {
      inputEvents.push(event as InputEvent);
    });

    setupTerminalInput({
      term: term as unknown as Terminal,
      sendInput: vi.fn(),
    });

    term.textarea.dispatchEvent(
      createKeyboardEvent('keydown', {
        key: 'Shift',
        code: 'ShiftLeft',
        keyCode: 16,
        shiftKey: true,
      }),
    );
    term.textarea.dispatchEvent(createInputEvent('！'));
    term.textarea.dispatchEvent(createInputEvent('@'));
    term.textarea.dispatchEvent(createInputEvent('……'));

    expect(inputEvents.map((event) => event.data)).toEqual(['！', '@', '……']);
  });

  it('不补发 Shift 输入的字母、数字或中文文本', () => {
    const term = new MockTerminal();
    const inputEvents: InputEvent[] = [];
    term.textarea.addEventListener('input', (event) => {
      inputEvents.push(event as InputEvent);
    });

    setupTerminalInput({
      term: term as unknown as Terminal,
      sendInput: vi.fn(),
    });

    term.textarea.dispatchEvent(
      createKeyboardEvent('keydown', {
        key: 'Shift',
        code: 'ShiftLeft',
        keyCode: 16,
        shiftKey: true,
      }),
    );
    term.textarea.dispatchEvent(createInputEvent('A'));
    term.textarea.dispatchEvent(createInputEvent('1'));
    term.textarea.dispatchEvent(createInputEvent('中文'));

    expect(inputEvents).toHaveLength(0);
  });

  it('Slash keydown 已经发生时不补发，避免普通 Shift+/ 重复输入', () => {
    const term = new MockTerminal();
    const inputEvents: InputEvent[] = [];
    term.textarea.addEventListener('input', (event) => {
      inputEvents.push(event as InputEvent);
    });

    setupTerminalInput({
      term: term as unknown as Terminal,
      sendInput: vi.fn(),
    });

    term.textarea.dispatchEvent(
      createKeyboardEvent('keydown', {
        key: 'Shift',
        code: 'ShiftLeft',
        keyCode: 16,
        shiftKey: true,
      }),
    );
    term.textarea.dispatchEvent(
      createKeyboardEvent('keydown', {
        key: '?',
        code: 'Slash',
        keyCode: 191,
        shiftKey: true,
      }),
    );
    term.textarea.dispatchEvent(createInputEvent('?'));

    expect(inputEvents).toHaveLength(0);
  });

  it('Ctrl+Enter 发送换行符 \\n 并阻止默认处理', () => {
    const term = new MockTerminal();
    const sendInput = vi.fn();

    setupTerminalInput({
      term: term as unknown as Terminal,
      sendInput,
    });

    const handled = term.simulateKeyEvent(
      createKeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        ctrlKey: true,
      }),
    );

    expect(handled).toBe(false);
    expect(sendInput).toHaveBeenCalledWith('\n');
  });

  it('Alt+Enter 发送换行符 \\n 并阻止默认处理', () => {
    const term = new MockTerminal();
    const sendInput = vi.fn();

    setupTerminalInput({
      term: term as unknown as Terminal,
      sendInput,
    });

    const handled = term.simulateKeyEvent(
      createKeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        altKey: true,
      }),
    );

    expect(handled).toBe(false);
    expect(sendInput).toHaveBeenCalledWith('\n');
  });

  it('Alt+Shift+Enter 不被拦截，只处理纯 Alt+Enter', () => {
    const term = new MockTerminal();
    const sendInput = vi.fn();

    setupTerminalInput({
      term: term as unknown as Terminal,
      sendInput,
    });

    const handled = term.simulateKeyEvent(
      createKeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        altKey: true,
        shiftKey: true,
      }),
    );

    expect(handled).toBe(true);
    expect(sendInput).not.toHaveBeenCalled();
  });

  it('普通 Enter 不被拦截，由 xterm 正常处理', () => {
    const term = new MockTerminal();
    const sendInput = vi.fn();

    setupTerminalInput({
      term: term as unknown as Terminal,
      sendInput,
    });

    const handled = term.simulateKeyEvent(
      createKeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
      }),
    );

    expect(handled).toBe(true);
    expect(sendInput).not.toHaveBeenCalled();
  });

  it('Ctrl+Shift+Enter 不被拦截，只处理纯 Ctrl+Enter', () => {
    const term = new MockTerminal();
    const sendInput = vi.fn();

    setupTerminalInput({
      term: term as unknown as Terminal,
      sendInput,
    });

    const handled = term.simulateKeyEvent(
      createKeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        ctrlKey: true,
        shiftKey: true,
      }),
    );

    expect(handled).toBe(true);
    expect(sendInput).not.toHaveBeenCalled();
  });

  it('keyup 事件中的 Ctrl+Enter 不触发发送', () => {
    const term = new MockTerminal();
    const sendInput = vi.fn();

    setupTerminalInput({
      term: term as unknown as Terminal,
      sendInput,
    });

    const handled = term.simulateKeyEvent(
      createKeyboardEvent('keyup', {
        key: 'Enter',
        code: 'Enter',
        ctrlKey: true,
      }),
    );

    expect(handled).toBe(true);
    expect(sendInput).not.toHaveBeenCalled();
  });

  it('dispose 后 Ctrl+Enter 不再拦截', () => {
    const term = new MockTerminal();
    const sendInput = vi.fn();

    const controller = setupTerminalInput({
      term: term as unknown as Terminal,
      sendInput,
    });

    controller.dispose();

    const handled = term.simulateKeyEvent(
      createKeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        ctrlKey: true,
      }),
    );

    // After dispose, the pass-through handler returns true (no interception)
    expect(handled).toBe(true);
    expect(sendInput).not.toHaveBeenCalled();
  });

  describe('Option/Alt + 左右方向键 → 按词移动 (Alt+b / Alt+f)', () => {
    it('Alt+ArrowLeft 发送 \\x1bb 并抑制 xterm 默认处理', () => {
      const term = new MockTerminal();
      const sendInput = vi.fn();

      setupTerminalInput({
        term: term as unknown as Terminal,
        sendInput,
      });

      const handled = term.simulateKeyEvent(
        createKeyboardEvent('keydown', {
          key: 'ArrowLeft',
          code: 'ArrowLeft',
          altKey: true,
        }),
      );

      expect(handled).toBe(false);
      expect(sendInput).toHaveBeenCalledWith('\x1bb');
    });

    it('Alt+ArrowRight 发送 \\x1bf 并抑制 xterm 默认处理', () => {
      const term = new MockTerminal();
      const sendInput = vi.fn();

      setupTerminalInput({
        term: term as unknown as Terminal,
        sendInput,
      });

      const handled = term.simulateKeyEvent(
        createKeyboardEvent('keydown', {
          key: 'ArrowRight',
          code: 'ArrowRight',
          altKey: true,
        }),
      );

      expect(handled).toBe(false);
      expect(sendInput).toHaveBeenCalledWith('\x1bf');
    });

    it('Alt+ArrowUp / Alt+ArrowDown 不拦截', () => {
      const term = new MockTerminal();
      const sendInput = vi.fn();

      setupTerminalInput({
        term: term as unknown as Terminal,
        sendInput,
      });

      for (const code of ['ArrowUp', 'ArrowDown']) {
        const handled = term.simulateKeyEvent(
          createKeyboardEvent('keydown', {
            key: code,
            code,
            altKey: true,
          }),
        );
        expect(handled).toBe(true);
      }
      expect(sendInput).not.toHaveBeenCalled();
    });

    it('Ctrl+Alt+ArrowLeft 不拦截（保留 Ctrl+Alt+方向键导航）', () => {
      const term = new MockTerminal();
      const sendInput = vi.fn();

      setupTerminalInput({
        term: term as unknown as Terminal,
        sendInput,
      });

      const handled = term.simulateKeyEvent(
        createKeyboardEvent('keydown', {
          key: 'ArrowLeft',
          code: 'ArrowLeft',
          altKey: true,
          ctrlKey: true,
        }),
      );

      expect(handled).toBe(true);
      expect(sendInput).not.toHaveBeenCalled();
    });

    it('Shift+Alt+ArrowLeft 不拦截（保留选区相关组合）', () => {
      const term = new MockTerminal();
      const sendInput = vi.fn();

      setupTerminalInput({
        term: term as unknown as Terminal,
        sendInput,
      });

      const handled = term.simulateKeyEvent(
        createKeyboardEvent('keydown', {
          key: 'ArrowLeft',
          code: 'ArrowLeft',
          altKey: true,
          shiftKey: true,
        }),
      );

      expect(handled).toBe(true);
      expect(sendInput).not.toHaveBeenCalled();
    });

    it('keyup 事件中的 Alt+ArrowLeft 不触发发送', () => {
      const term = new MockTerminal();
      const sendInput = vi.fn();

      setupTerminalInput({
        term: term as unknown as Terminal,
        sendInput,
      });

      const handled = term.simulateKeyEvent(
        createKeyboardEvent('keyup', {
          key: 'ArrowLeft',
          code: 'ArrowLeft',
          altKey: true,
        }),
      );

      expect(handled).toBe(true);
      expect(sendInput).not.toHaveBeenCalled();
    });

    it('dispose 后 Alt+ArrowLeft 不再拦截', () => {
      const term = new MockTerminal();
      const sendInput = vi.fn();

      const controller = setupTerminalInput({
        term: term as unknown as Terminal,
        sendInput,
      });

      controller.dispose();

      const handled = term.simulateKeyEvent(
        createKeyboardEvent('keydown', {
          key: 'ArrowLeft',
          code: 'ArrowLeft',
          altKey: true,
        }),
      );

      expect(handled).toBe(true);
      expect(sendInput).not.toHaveBeenCalled();
    });
  });

  describe('IME 组字防重复', () => {
    function fireCompositionStart(textarea: HTMLTextAreaElement) {
      textarea.dispatchEvent(new CompositionEvent('compositionstart'));
    }

    function fireCompositionEnd(textarea: HTMLTextAreaElement, data: string) {
      textarea.dispatchEvent(new CompositionEvent('compositionend', { data }));
    }

    it('组字期间抑制 onData 转发', () => {
      const term = new MockTerminal();
      const sendInput = vi.fn();

      setupTerminalInput({
        term: term as unknown as Terminal,
        sendInput,
      });

      fireCompositionStart(term.textarea);
      term.emitData('zhong');

      expect(sendInput).not.toHaveBeenCalled();
    });

    it('compositionend 手动提交文本', () => {
      const term = new MockTerminal();
      const sendInput = vi.fn();

      setupTerminalInput({
        term: term as unknown as Terminal,
        sendInput,
      });

      fireCompositionStart(term.textarea);
      fireCompositionEnd(term.textarea, '中');

      expect(sendInput).toHaveBeenCalledWith('中');
    });

    it('compositionend 后紧随的 onData 重复被抑制', () => {
      const term = new MockTerminal();
      const sendInput = vi.fn();

      setupTerminalInput({
        term: term as unknown as Terminal,
        sendInput,
      });

      fireCompositionStart(term.textarea);
      fireCompositionEnd(term.textarea, '中');
      // Input event fires synchronously after compositionend → onData("中")
      term.emitData('中');

      expect(sendInput).toHaveBeenCalledTimes(1);
    });

    it('compositionend 后紧随的空格仍然被转发', () => {
      const term = new MockTerminal();
      const sendInput = vi.fn();

      setupTerminalInput({
        term: term as unknown as Terminal,
        sendInput,
      });

      fireCompositionStart(term.textarea);
      fireCompositionEnd(term.textarea, '中');
      term.emitData(' ');

      expect(sendInput).toHaveBeenCalledWith('中');
      expect(sendInput).toHaveBeenLastCalledWith(' ');
      expect(sendInput).toHaveBeenCalledTimes(2);
    });

    it('切换输入法提交的拼音 buffer 空格被剥离', () => {
      const term = new MockTerminal();
      const sendInput = vi.fn();

      setupTerminalInput({
        term: term as unknown as Terminal,
        sendInput,
      });

      fireCompositionStart(term.textarea);
      fireCompositionEnd(term.textarea, 'hai hao');

      expect(sendInput).toHaveBeenCalledWith('haihao');
    });

    it('剥离后紧随 onData 原始文本被去重', () => {
      const term = new MockTerminal();
      const sendInput = vi.fn();

      setupTerminalInput({
        term: term as unknown as Terminal,
        sendInput,
      });

      fireCompositionStart(term.textarea);
      fireCompositionEnd(term.textarea, 'hai hao');
      // xterm 随后从 textarea 提取整段文本触发 onData("hai hao")
      term.emitData('hai hao');

      expect(sendInput).toHaveBeenCalledTimes(1);
    });

    it('无 compositionend 时 onData 收到的拼音 buffer 空格被剥离', () => {
      const term = new MockTerminal();
      const sendInput = vi.fn();

      setupTerminalInput({
        term: term as unknown as Terminal,
        sendInput,
      });

      term.emitData('hai hao');

      expect(sendInput).toHaveBeenCalledWith('haihao');
    });

    it('粘贴含空格的 ASCII 文本不被剥离空格', () => {
      const term = new MockTerminal();
      const sendInput = vi.fn();

      setupTerminalInput({
        term: term as unknown as Terminal,
        sendInput,
      });

      // xterm 粘贴整段文本走 onData；先触发 paste 事件标记粘贴上下文。
      // textarea 需挂载到 DOM 才能让 paste 事件冒泡到 document（capture 监听）。
      document.body.appendChild(term.textarea);
      try {
        term.textarea.dispatchEvent(new Event('paste', { bubbles: true, cancelable: true }));
        term.emitData('git commit -m "hello world"');
      } finally {
        term.textarea.remove();
      }

      expect(sendInput).toHaveBeenCalledWith('git commit -m "hello world"');
    });

    it('粘贴事件后紧随的空格数据不被剥离（无 composition 上下文）', () => {
      const term = new MockTerminal();
      const sendInput = vi.fn();

      setupTerminalInput({
        term: term as unknown as Terminal,
        sendInput,
      });

      document.body.appendChild(term.textarea);
      try {
        term.textarea.dispatchEvent(new Event('paste', { bubbles: true, cancelable: true }));
        term.emitData('a b');
      } finally {
        term.textarea.remove();
      }

      expect(sendInput).toHaveBeenCalledWith('a b');
    });

    it('其他终端的 paste 事件不抑制本终端的拼音剥离', () => {
      const term = new MockTerminal();
      const otherTextarea = document.createElement('textarea');
      const sendInput = vi.fn();

      setupTerminalInput({
        term: term as unknown as Terminal,
        sendInput,
      });

      document.body.appendChild(term.textarea);
      document.body.appendChild(otherTextarea);
      try {
        // 粘贴发生在其他终端的 textarea 上
        otherTextarea.dispatchEvent(new Event('paste', { bubbles: true, cancelable: true }));
        term.emitData('hai hao');

        expect(sendInput).toHaveBeenCalledWith('haihao');
      } finally {
        term.textarea.remove();
        otherTextarea.remove();
      }
    });

    it('compositionend 后无后续 onData 时抑制状态正确清除', () => {
      const term = new MockTerminal();
      const sendInput = vi.fn();

      setupTerminalInput({
        term: term as unknown as Terminal,
        sendInput,
      });

      fireCompositionStart(term.textarea);
      fireCompositionEnd(term.textarea, '中');
      // No immediate onData; pending state should be cleared on the next input
      term.emitData(' ');

      expect(sendInput).toHaveBeenLastCalledWith(' ');
      expect(sendInput).toHaveBeenCalledTimes(2);
    });

    it('取消 IME（空数据）不提交文本', () => {
      const term = new MockTerminal();
      const sendInput = vi.fn();

      setupTerminalInput({
        term: term as unknown as Terminal,
        sendInput,
      });

      fireCompositionStart(term.textarea);
      fireCompositionEnd(term.textarea, '');

      expect(sendInput).not.toHaveBeenCalled();
    });

    it('dispose 后 IME 事件不影响 sendInput', () => {
      const term = new MockTerminal();
      const sendInput = vi.fn();

      const controller = setupTerminalInput({
        term: term as unknown as Terminal,
        sendInput,
      });

      controller.dispose();

      fireCompositionStart(term.textarea);
      fireCompositionEnd(term.textarea, '中');

      // After dispose, neither onData nor compositionend should send
      expect(sendInput).not.toHaveBeenCalled();
    });
  });
});
