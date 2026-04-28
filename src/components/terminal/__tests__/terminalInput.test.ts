import type { Terminal } from "@xterm/xterm";
import { describe, expect, it, vi } from "vitest";
import { setupTerminalInput } from "../terminalInput";

type DataHandler = (data: string) => void;

class MockTerminal {
  readonly textarea = document.createElement("textarea");
  private dataHandler: DataHandler | null = null;

  onData(handler: DataHandler) {
    this.dataHandler = handler;
    return {
      dispose: () => {
        this.dataHandler = null;
      },
    };
  }

  emitData(data: string) {
    this.dataHandler?.(data);
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
});
