import type { Terminal } from '@xterm/xterm';

import { isAbandonedImeAsciiBuffer, stripImeSegmentationSpaces } from '@/shared/utils/ime';

// re-export 保持既有测试对 '../terminalInput' 的 import 兼容
export { isAbandonedImeAsciiBuffer, stripImeSegmentationSpaces };

export interface TerminalInputController {
  dispose: () => void;
}

function isShiftImeSymbol(text: string): boolean {
  return /^[^\p{L}\p{N}\s]+$/u.test(text);
}

function isModifierKey(event: KeyboardEvent): boolean {
  return (
    event.key === 'Shift' ||
    event.key === 'Control' ||
    event.key === 'Alt' ||
    event.key === 'Meta' ||
    event.key === 'CapsLock'
  );
}

function createSyntheticInputEvent(data: string): InputEvent {
  if (typeof InputEvent === 'function') {
    return new InputEvent('input', {
      data,
      inputType: 'insertText',
      bubbles: true,
      cancelable: true,
      composed: false,
    });
  }

  const event = new Event('input', {
    bubbles: true,
    cancelable: true,
  }) as InputEvent;

  Object.defineProperties(event, {
    data: { value: data },
    inputType: { value: 'insertText' },
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
    if (event.key === 'Shift') {
      shiftDown = true;
      waitingForShiftSymbolKeyDown = true;
      return;
    }

    if (!isModifierKey(event)) {
      waitingForShiftSymbolKeyDown = false;
    }
  };

  const handleKeyUp = (event: KeyboardEvent) => {
    if (event.key === 'Shift') {
      shiftDown = false;
      waitingForShiftSymbolKeyDown = false;
    }
  };

  const handleBeforeInput = (event: InputEvent) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.inputType !== 'insertText' ||
      !event.data ||
      !shiftDown ||
      !waitingForShiftSymbolKeyDown ||
      !isShiftImeSymbol(event.data)
    ) {
      return;
    }

    textarea.dispatchEvent(createSyntheticInputEvent(event.data));
  };

  textarea.addEventListener('keydown', handleKeyDown, true);
  textarea.addEventListener('keyup', handleKeyUp, true);
  textarea.addEventListener('beforeinput', handleBeforeInput, true);

  return () => {
    textarea.removeEventListener('keydown', handleKeyDown, true);
    textarea.removeEventListener('keyup', handleKeyUp, true);
    textarea.removeEventListener('beforeinput', handleBeforeInput, true);
  };
}

/**
 * Intercept keys where we want app-controlled behavior instead of xterm's default:
 *
 * 1. Ctrl+Enter / Alt+Enter → send a newline character (\n, LF) to the PTY instead
 *    of the default carriage return (\r) that xterm.js would emit for a plain Enter.
 *    This allows CLI programs (e.g. Pi Agent) that treat \n as "insert a new line"
 *    and \r as "execute" to support multi-line input.
 *
 * 2. Option/Alt + ←/→ → send Alt+b / Alt+f (`\x1bb` / `\x1bf`) so bash readline and
 *    zsh line editors move the cursor by word — matching macOS text-field behavior.
 *    xterm's default for these is the unbound CSI sequence `\x1b[1;3D` / `\x1b[1;3C`,
 *    which shells echo as literal `;3D` / `;3C` garbage. Only the sole-modifier
 *    combination is remapped, so Ctrl+Alt+方向键 (navigate history) stays intact.
 *
 * Returns a cleanup function that removes the handler.
 */
function setupTerminalKeyHandler(term: Terminal, sendInput: (text: string) => void): () => void {
  // attachCustomKeyEventHandler returns boolean:
  //   true  → let xterm.js process the key normally
  //   false → suppress xterm.js default handling
  term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
    if (event.type !== 'keydown') {
      return true;
    }

    if (event.key === 'Enter') {
      const ctrl = event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey;
      const alt = event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey;

      if (ctrl || alt) {
        sendInput('\n');
        return false;
      }
      return true;
    }

    if (event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey) {
      if (event.code === 'ArrowLeft') {
        sendInput('\x1bb'); // Alt+b → backward-word
        return false;
      }
      if (event.code === 'ArrowRight') {
        sendInput('\x1bf'); // Alt+f → forward-word
        return false;
      }
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
  const textarea = term.textarea;
  let composing = false;
  let compositionPendingText: string | null = null;

  // xterm 将粘贴文本整段通过 onData 发出（shell 未启用 bracketed paste 时）。
  // 为避免粘贴含空格命令被 isAbandonedImeAsciiBuffer 误判为「被放弃的拼音缓冲区」，
  // 用 capture 阶段 paste 事件标记粘贴上下文，onData 消费该标记时原样转发。
  // 仅当粘贴目标是本终端 textarea 时置位，避免多终端共享 document 监听互相污染。
  let pasteInProgress = false;
  const handlePasteCapture = (event: Event) => {
    if (textarea && event.target === textarea) {
      pasteInProgress = true;
    }
  };
  document.addEventListener('paste', handlePasteCapture, true);

  let compositionStartHandler: (() => void) | null = null;
  let compositionEndHandler: ((e: CompositionEvent) => void) | null = null;

  if (textarea) {
    compositionStartHandler = () => {
      composing = true;
      compositionPendingText = null;
    };

    compositionEndHandler = (e: CompositionEvent) => {
      composing = false;
      const text = e.data;
      if (text) {
        compositionPendingText = text;
        if (isAbandonedImeAsciiBuffer(text)) {
          sendInput(stripImeSegmentationSpaces(text));
        } else {
          sendInput(text);
        }
      } else {
        compositionPendingText = null;
      }
    };

    textarea.addEventListener('compositionstart', compositionStartHandler);
    textarea.addEventListener('compositionend', compositionEndHandler);
  }

  const disposable = term.onData((data) => {
    if (composing) return;

    // 粘贴数据原样转发，不剥离空格
    if (pasteInProgress) {
      pasteInProgress = false;
      sendInput(data);
      return;
    }

    if (compositionPendingText !== null) {
      if (data === compositionPendingText) {
        compositionPendingText = null;
        return;
      }
      compositionPendingText = null;
    }

    if (isAbandonedImeAsciiBuffer(data)) {
      sendInput(stripImeSegmentationSpaces(data));
    } else {
      sendInput(data);
    }
  });

  const disposeImeFallback = setupImeShiftSymbolFallback(term);
  const disposeKeyHandler = setupTerminalKeyHandler(term, sendInput);

  return {
    dispose: () => {
      composing = false;
      compositionPendingText = null;
      document.removeEventListener('paste', handlePasteCapture, true);
      if (textarea && compositionStartHandler && compositionEndHandler) {
        textarea.removeEventListener('compositionstart', compositionStartHandler);
        textarea.removeEventListener('compositionend', compositionEndHandler);
      }
      disposeKeyHandler();
      disposeImeFallback();
      disposable.dispose();
    },
  };
}
