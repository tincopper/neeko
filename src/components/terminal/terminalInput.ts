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

/**
 * Intercept Ctrl+Enter and Alt+Enter, sending a newline character (\n, LF)
 * to the PTY instead of the default carriage return (\r) that xterm.js would
 * emit for a plain Enter. This allows CLI programs (e.g. Pi Agent) that treat
 * \n as "insert a new line" and \r as "execute" to support multi-line input.
 *
 * Returns a cleanup function that removes the handler.
 */
function setupNewlineEnterHandler(
  term: Terminal,
  sendInput: (text: string) => void,
): () => void {
  // attachCustomKeyEventHandler returns boolean:
  //   true  → let xterm.js process the key normally
  //   false → suppress xterm.js default handling
  term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
    if (event.type !== "keydown" || event.key !== "Enter") {
      return true;
    }

    const ctrl = event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey;
    const alt = event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey;

    if (ctrl || alt) {
      sendInput("\n");
      return false;
    }
    return true;
  });

  // xterm.js does not expose a direct "detach" API for
  // attachCustomKeyEventHandler — the handler is replaced on each call.
  // We install a pass-through handler on dispose to neutralise our hook.
  return () => {
    term.attachCustomKeyEventHandler(() => true);
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
  const disposeCtrlEnter = setupNewlineEnterHandler(term, sendInput);

  return {
    dispose: () => {
      disposeCtrlEnter();
      disposeImeFallback();
      disposable.dispose();
    },
  };
}
