import type { Terminal } from "@xterm/xterm";
import { describe, expect, it, vi } from "vitest";
import { setupTerminalInput } from "../terminalInput";

type DataHandler = (data: string) => void;

type CustomKeyHandler = (event: KeyboardEvent) => boolean;

class MockTerminal {
  readonly textarea = document.createElement("textarea");
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
  return new InputEvent("beforeinput", {
    data,
    inputType: "insertText",
    bubbles: true,
    cancelable: true,
    composed: true,
  });
}

function createKeyboardEvent(
  type: "keydown" | "keyup",
  init: KeyboardEventInit,
): KeyboardEvent {
  return new KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    ...init,
  });
}

describe("setupTerminalInput", () => {
  it("转发 xterm onData 输入", () => {
    const term = new MockTerminal();
    const sendInput = vi.fn();

    setupTerminalInput({
      term: term as unknown as Terminal,
      sendInput,
    });

    term.emitData("abc");

    expect(sendInput).toHaveBeenCalledWith("abc");
  });

  it("dispose 后不再转发 xterm onData 输入", () => {
    const term = new MockTerminal();
    const sendInput = vi.fn();
    const controller = setupTerminalInput({
      term: term as unknown as Terminal,
      sendInput,
    });

    controller.dispose();
    term.emitData("abc");

    expect(sendInput).not.toHaveBeenCalled();
  });

  it("在中文 IME 的 Shift 符号 beforeinput 早于真实 keydown 时补发一次 input", () => {
    const term = new MockTerminal();
    const inputEvents: InputEvent[] = [];
    term.textarea.addEventListener("input", (event) => {
      inputEvents.push(event as InputEvent);
    });

    setupTerminalInput({
      term: term as unknown as Terminal,
      sendInput: vi.fn(),
    });

    term.textarea.dispatchEvent(
      createKeyboardEvent("keydown", {
        key: "Shift",
        code: "ShiftLeft",
        keyCode: 16,
        shiftKey: true,
      }),
    );
    term.textarea.dispatchEvent(createInputEvent("？"));

    expect(inputEvents).toHaveLength(1);
    expect(inputEvents[0].data).toBe("？");
    expect(inputEvents[0].inputType).toBe("insertText");
    expect(inputEvents[0].composed).toBe(false);
  });

  it("补发 Shift+数字产生的中文标点和 ASCII 符号", () => {
    const term = new MockTerminal();
    const inputEvents: InputEvent[] = [];
    term.textarea.addEventListener("input", (event) => {
      inputEvents.push(event as InputEvent);
    });

    setupTerminalInput({
      term: term as unknown as Terminal,
      sendInput: vi.fn(),
    });

    term.textarea.dispatchEvent(
      createKeyboardEvent("keydown", {
        key: "Shift",
        code: "ShiftLeft",
        keyCode: 16,
        shiftKey: true,
      }),
    );
    term.textarea.dispatchEvent(createInputEvent("！"));
    term.textarea.dispatchEvent(createInputEvent("@"));
    term.textarea.dispatchEvent(createInputEvent("……"));

    expect(inputEvents.map((event) => event.data)).toEqual(["！", "@", "……"]);
  });

  it("不补发 Shift 输入的字母、数字或中文文本", () => {
    const term = new MockTerminal();
    const inputEvents: InputEvent[] = [];
    term.textarea.addEventListener("input", (event) => {
      inputEvents.push(event as InputEvent);
    });

    setupTerminalInput({
      term: term as unknown as Terminal,
      sendInput: vi.fn(),
    });

    term.textarea.dispatchEvent(
      createKeyboardEvent("keydown", {
        key: "Shift",
        code: "ShiftLeft",
        keyCode: 16,
        shiftKey: true,
      }),
    );
    term.textarea.dispatchEvent(createInputEvent("A"));
    term.textarea.dispatchEvent(createInputEvent("1"));
    term.textarea.dispatchEvent(createInputEvent("中文"));

    expect(inputEvents).toHaveLength(0);
  });

  it("Slash keydown 已经发生时不补发，避免普通 Shift+/ 重复输入", () => {
    const term = new MockTerminal();
    const inputEvents: InputEvent[] = [];
    term.textarea.addEventListener("input", (event) => {
      inputEvents.push(event as InputEvent);
    });

    setupTerminalInput({
      term: term as unknown as Terminal,
      sendInput: vi.fn(),
    });

    term.textarea.dispatchEvent(
      createKeyboardEvent("keydown", {
        key: "Shift",
        code: "ShiftLeft",
        keyCode: 16,
        shiftKey: true,
      }),
    );
    term.textarea.dispatchEvent(
      createKeyboardEvent("keydown", {
        key: "?",
        code: "Slash",
        keyCode: 191,
        shiftKey: true,
      }),
    );
    term.textarea.dispatchEvent(createInputEvent("?"));

    expect(inputEvents).toHaveLength(0);
  });

  it("Ctrl+Enter 发送换行符 \\n 并阻止默认处理", () => {
    const term = new MockTerminal();
    const sendInput = vi.fn();

    setupTerminalInput({
      term: term as unknown as Terminal,
      sendInput,
    });

    const handled = term.simulateKeyEvent(
      createKeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        ctrlKey: true,
      }),
    );

    expect(handled).toBe(false);
    expect(sendInput).toHaveBeenCalledWith("\n");
  });

  it("Alt+Enter 发送换行符 \\n 并阻止默认处理", () => {
    const term = new MockTerminal();
    const sendInput = vi.fn();

    setupTerminalInput({
      term: term as unknown as Terminal,
      sendInput,
    });

    const handled = term.simulateKeyEvent(
      createKeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        altKey: true,
      }),
    );

    expect(handled).toBe(false);
    expect(sendInput).toHaveBeenCalledWith("\n");
  });

  it("Alt+Shift+Enter 不被拦截，只处理纯 Alt+Enter", () => {
    const term = new MockTerminal();
    const sendInput = vi.fn();

    setupTerminalInput({
      term: term as unknown as Terminal,
      sendInput,
    });

    const handled = term.simulateKeyEvent(
      createKeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        altKey: true,
        shiftKey: true,
      }),
    );

    expect(handled).toBe(true);
    expect(sendInput).not.toHaveBeenCalled();
  });

  it("普通 Enter 不被拦截，由 xterm 正常处理", () => {
    const term = new MockTerminal();
    const sendInput = vi.fn();

    setupTerminalInput({
      term: term as unknown as Terminal,
      sendInput,
    });

    const handled = term.simulateKeyEvent(
      createKeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
      }),
    );

    expect(handled).toBe(true);
    expect(sendInput).not.toHaveBeenCalled();
  });

  it("Ctrl+Shift+Enter 不被拦截，只处理纯 Ctrl+Enter", () => {
    const term = new MockTerminal();
    const sendInput = vi.fn();

    setupTerminalInput({
      term: term as unknown as Terminal,
      sendInput,
    });

    const handled = term.simulateKeyEvent(
      createKeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        ctrlKey: true,
        shiftKey: true,
      }),
    );

    expect(handled).toBe(true);
    expect(sendInput).not.toHaveBeenCalled();
  });

  it("keyup 事件中的 Ctrl+Enter 不触发发送", () => {
    const term = new MockTerminal();
    const sendInput = vi.fn();

    setupTerminalInput({
      term: term as unknown as Terminal,
      sendInput,
    });

    const handled = term.simulateKeyEvent(
      createKeyboardEvent("keyup", {
        key: "Enter",
        code: "Enter",
        ctrlKey: true,
      }),
    );

    expect(handled).toBe(true);
    expect(sendInput).not.toHaveBeenCalled();
  });

  it("dispose 后 Ctrl+Enter 不再拦截", () => {
    const term = new MockTerminal();
    const sendInput = vi.fn();

    const controller = setupTerminalInput({
      term: term as unknown as Terminal,
      sendInput,
    });

    controller.dispose();

    const handled = term.simulateKeyEvent(
      createKeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        ctrlKey: true,
      }),
    );

    // After dispose, the pass-through handler returns true (no interception)
    expect(handled).toBe(true);
    expect(sendInput).not.toHaveBeenCalled();
  });
});
