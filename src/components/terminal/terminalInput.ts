import type { Terminal } from "@xterm/xterm";

export interface TerminalInputController {
  dispose: () => void;
}

function isShiftImeSymbol(text: string): boolean {
  return /^[^\p{L}\p{N}\s]+$/u.test(text);
}

function isModifierKey(event: KeyboardEvent): boolean {
  return (
    event.key === "Shift" ||
    event.key === "Control" ||
    event.key === "Alt" ||
    event.key === "Meta" ||
    event.key === "CapsLock"
  );
}

function createSyntheticInputEvent(data: string): InputEvent {
  if (typeof InputEvent === "function") {
    return new InputEvent("input", {
      data,
      inputType: "insertText",
      bubbles: true,
      cancelable: true,
      composed: false,
    });
  }

  const event = new Event("input", {
    bubbles: true,
    cancelable: true,
  }) as InputEvent;

  Object.defineProperties(event, {
    data: { value: data },
    inputType: { value: "insertText" },
    composed: { value: false },
  });

  return event;
}

function setupImeShiftSymbolFallback(term: Terminal): () => void {
  const textarea = term.textarea;
  if (!textarea) {
    return () => {};
  }

  let shiftDown = false;
  let waitingForShiftSymbolKeyDown = false;

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Shift") {
      shiftDown = true;
      waitingForShiftSymbolKeyDown = true;
      return;
    }

    if (!isModifierKey(event)) {
      waitingForShiftSymbolKeyDown = false;
    }
  };

  const handleKeyUp = (event: KeyboardEvent) => {
    if (event.key === "Shift") {
      shiftDown = false;
      waitingForShiftSymbolKeyDown = false;
    }
  };

  const handleBeforeInput = (event: InputEvent) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.inputType !== "insertText" ||
      !event.data ||
      !shiftDown ||
      !waitingForShiftSymbolKeyDown ||
      !isShiftImeSymbol(event.data)
    ) {
      return;
    }

    textarea.dispatchEvent(createSyntheticInputEvent(event.data));
  };

  textarea.addEventListener("keydown", handleKeyDown, true);
  textarea.addEventListener("keyup", handleKeyUp, true);
  textarea.addEventListener("beforeinput", handleBeforeInput, true);

  return () => {
    textarea.removeEventListener("keydown", handleKeyDown, true);
    textarea.removeEventListener("keyup", handleKeyUp, true);
    textarea.removeEventListener("beforeinput", handleBeforeInput, true);
  };
}

export function setupTerminalInput({
  term,
  sendInput,
}: {
  term: Terminal;
  sendInput: (text: string) => void;
}): TerminalInputController {
  const disposable = term.onData((data) => {
    sendInput(data);
  });
  const disposeImeFallback = setupImeShiftSymbolFallback(term);

  return {
    dispose: () => {
      disposeImeFallback();
      disposable.dispose();
    },
  };
}
